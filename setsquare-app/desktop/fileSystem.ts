// Gives the desktop app the browser's File System Access API, backed by native
// dialogs and real files, so the editor's open and save code runs unchanged.
// browser-fs-access checks for this API once when it loads, so this module
// must be imported before the editor.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

import { MIME_TYPES } from "@setsquare/common";

import type { DialogFilter } from "@tauri-apps/plugin-dialog";

// the subset of the picker options that browser-fs-access passes
type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string | string[]>;
};

type OpenFilePickerOptions = {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
};

type SaveFilePickerOptions = {
  types?: FilePickerAcceptType[];
  suggestedName?: string;
};

const abortError = () =>
  new DOMException("The user aborted a request.", "AbortError");

const notSupportedError = (operation: string) =>
  new DOMException(`${operation} is not supported`, "NotSupportedError");

// browsers infer a file's type from its extension; the editor relies on that
// for SVG files, which it can't detect from their contents
const mimeTypeFor = (name: string) => {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(MIME_TYPES, extension)
    ? MIME_TYPES[extension as keyof typeof MIME_TYPES]
    : "";
};

// native dialogs filter on the last extension only, so ".setsquare.png"
// filters as "png"
const toDialogFilters = (types: FilePickerAcceptType[] = []): DialogFilter[] =>
  types.flatMap(({ description, accept }) => {
    const extensions = Object.values(accept)
      .flat()
      .map((extension) => extension.split(".").pop() ?? "")
      .filter(Boolean);
    return extensions.length
      ? [{ name: description ?? "Files", extensions }]
      : [];
  });

const isWriteParams = (chunk: FileSystemWriteChunkType): chunk is WriteParams =>
  typeof chunk === "object" && !(chunk instanceof Blob) && "type" in chunk;

// header values must be ASCII, so the path travels as a file URL
const fileURL = (path: string) =>
  `file://${path.split("/").map(encodeURIComponent).join("/")}`;

// buffers everything written and replaces the file on close, like the
// browser's own implementation. The app writes a new file and moves it into
// place, so a failed save leaves the old file intact.
class DesktopWritableFileStream
  extends WritableStream<FileSystemWriteChunkType>
  implements FileSystemWritableFileStream
{
  constructor(path: string) {
    const parts: BlobPart[] = [];
    super({
      write(chunk) {
        if (isWriteParams(chunk)) {
          throw notSupportedError("Positioned writing");
        }
        parts.push(chunk);
      },
      async close() {
        const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
        await invoke("save_file", bytes, {
          headers: { url: fileURL(path) },
        });
      },
    });
  }

  async write(data: FileSystemWriteChunkType) {
    const writer = this.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  async seek(): Promise<void> {
    throw notSupportedError("Seeking");
  }

  async truncate(): Promise<void> {
    throw notSupportedError("Truncating");
  }
}

export class DesktopFileHandle implements FileSystemFileHandle {
  readonly kind = "file";
  readonly name: string;

  constructor(readonly path: string) {
    this.name = path.split(/[\\/]/).pop() ?? path;
  }

  async getFile() {
    const bytes = await readFile(this.path);
    return new File([bytes], this.name, { type: mimeTypeFor(this.name) });
  }

  async createWritable() {
    return new DesktopWritableFileStream(this.path);
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other instanceof DesktopFileHandle && other.path === this.path;
  }
}

const showOpenFilePicker = async ({
  types,
  multiple,
}: OpenFilePickerOptions = {}) => {
  const filters = toDialogFilters(types);
  const selected = multiple
    ? await open({ multiple: true, filters })
    : await open({ multiple: false, filters });
  if (!selected) {
    throw abortError();
  }
  return [selected].flat().map((path) => new DesktopFileHandle(path));
};

const showSaveFilePicker = async ({
  types,
  suggestedName,
}: SaveFilePickerOptions = {}) => {
  const path = await save({
    defaultPath: suggestedName,
    filters: toDialogFilters(types),
  });
  if (!path) {
    throw abortError();
  }
  return new DesktopFileHandle(path);
};

if (isTauri()) {
  Object.assign(window, { showOpenFilePicker, showSaveFilePicker });
}
