import type { FileId } from "@setsquare/element/types";

import type { BinaryFileData, BinaryFiles } from "@setsquare/setsquare/types";

import { emptyDrawingContent } from "../drawingAppState";
import { newDrawingId, newFolderId } from "../types";

import { AccountCache } from "./AccountCache";
import { ApiError } from "./ApiError";
import {
  parseCommand,
  parseDrawing,
  parseFiles,
  parseThumbnails,
  parseWorkspace,
} from "./parse";

import type {
  CommandResponse,
  DrawingData,
  SaveOptions,
  SessionInfo,
  WorkspaceCommand,
  WorkspaceData,
} from "../api";
import type { LocalWorkspaceStore } from "../local/LocalWorkspaceStore";
import type {
  ChangeResult,
  DrawingContent,
  DrawingId,
  DrawingMeta,
  DrawingView,
  FolderId,
  ItemRef,
  ParentId,
  SaveResult,
  Thumbnail,
  WorkspaceSnapshot,
} from "../types";
import type {
  NewDrawing,
  WorkspaceFiles,
  WorkspaceStore,
} from "../WorkspaceStore";

type SignedIn = Extract<SessionInfo, { kind: "signedIn" }>;

/** The account and browser used to open a remote workspace. */
export type RemoteWorkspaceOptions = {
  session: SignedIn;
  ownerWindow: Window;
  onSessionExpired: () => void;
  fetch?: typeof fetch;
};

/** What an import of the browser's drawings copied, and what it left. */
export type ImportResult = { imported: number; skipped: DrawingMeta[] };

const NOT_FOUND = { ok: false, reason: "notFound" } as const;
const OK = { ok: true } as const;

/** An account's server workspace, with device-local recovery images and views. */
export class RemoteWorkspaceStore implements WorkspaceStore {
  static async open(options: RemoteWorkspaceOptions) {
    const cache = await AccountCache.open(
      options.ownerWindow,
      options.session.user.id,
    );
    const store = new RemoteWorkspaceStore(options, cache);
    try {
      await store.refresh();
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  readonly user;
  readonly recoveryKey: string;
  readonly recoveryStorage: Storage;
  readonly recoveryDrafts: NonNullable<WorkspaceStore["recoveryDrafts"]>;
  private readonly fetch: typeof fetch;
  private readonly listeners = new Set<() => void>();
  private readonly confirmedFiles = new Map<FileId, BinaryFileData>();
  private readonly stagedFiles = new Map<
    FileId,
    { dataURL: string; version: number; saved: Promise<void> }
  >();
  private snapshot: WorkspaceSnapshot = {
    folders: new Map(),
    drawings: new Map(),
  };
  private requestsStarted = 0;
  private snapshotShown = 0;
  private closed = false;
  private expired = false;
  private importing: Promise<ImportResult> | null = null;
  private mutations: Promise<void> = Promise.resolve();

  private constructor(
    private readonly options: RemoteWorkspaceOptions,
    private readonly cache: AccountCache,
  ) {
    this.user = options.session.user;
    this.recoveryKey = this.user.id;
    this.recoveryStorage = options.ownerWindow.localStorage;
    this.recoveryDrafts = {
      save: (draft) => cache.saveDraft(draft),
      load: (id) => cache.loadDrafts(id),
      remove: (id, generation) => cache.removeDraft(id, generation),
    };
    this.fetch =
      options.fetch ?? options.ownerWindow.fetch.bind(options.ownerWindow);
  }

  getSnapshot = () => this.snapshot;

  /** Makes image recovery durable before a queued save reaches the network. */
  async stageFiles(files: BinaryFiles) {
    return Promise.all(
      Object.values(files).map((file) => {
        const staged = this.stagedFiles.get(file.id);
        if (staged) {
          if (
            staged.dataURL !== file.dataURL &&
            (file.version ?? 1) === staged.version
          ) {
            throw new Error(
              "An image version cannot be reused for different image data",
            );
          }
          if ((file.version ?? 1) <= staged.version) {
            return staged.saved;
          }
        }
        const saved = this.cache.saveFiles([file]).catch((error) => {
          if (this.stagedFiles.get(file.id)?.saved === saved) {
            this.stagedFiles.delete(file.id);
          }
          throw error;
        });
        this.stagedFiles.set(file.id, {
          dataURL: file.dataURL,
          version: file.version ?? 1,
          saved,
        });
        return saved;
      }),
    ).then(() => {});
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async refresh() {
    await this.mutations;
    const sequence = ++this.requestsStarted;
    const data = parseWorkspace(await this.get("/api/workspace"));
    this.publish(data, sequence);
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    this.cache.close();
  }

  async createFolder(parentId: ParentId, name: string) {
    const { result } = await this.command({
      kind: "createFolder",
      id: newFolderId(),
      parentId,
      name,
    });
    if (result.kind !== "folder") {
      throw new Error("The server returned an invalid folder result");
    }
    return result.folder;
  }

  async renameFolder(id: FolderId, name: string) {
    const { result } = await this.command({ kind: "renameFolder", id, name });
    if (result.kind !== "change") {
      throw new Error("The server returned an invalid rename result");
    }
    return result.result;
  }

  async createDrawing({
    folderId,
    name,
    content = emptyDrawingContent(name),
    fileIds = [],
  }: NewDrawing) {
    const { result } = await this.commandWithFiles(fileIds, {
      kind: "createDrawing",
      id: newDrawingId(),
      folderId,
      name,
      content,
      fileIds,
    });
    if (result.kind !== "drawing" || !result.drawing) {
      throw new Error("The server did not create the drawing");
    }
    return result.drawing;
  }

  async duplicateDrawing(sourceId: DrawingId, name: string | null) {
    const { result } = await this.command({
      kind: "duplicateDrawing",
      sourceId,
      id: newDrawingId(),
      name,
    });
    if (result.kind !== "drawing") {
      throw new Error("The server returned an invalid drawing result");
    }
    return result.drawing;
  }

  async renameDrawing(id: DrawingId, name: string | null): Promise<SaveResult> {
    const meta = this.snapshot.drawings.get(id);
    if (!meta) {
      return NOT_FOUND;
    }
    const { result } = await this.command({
      kind: "renameDrawing",
      id,
      name,
      baseRevision: meta.revision,
    });
    if (result.kind !== "save") {
      throw new Error("The server returned an invalid save result");
    }
    return result.result;
  }

  async openDrawing(id: DrawingId) {
    await this.mutations;
    const sequence = ++this.requestsStarted;
    const drawing = await this.readDrawing(
      `/api/drawings/${encodeURIComponent(id)}`,
    );
    if (!drawing) {
      return null;
    }
    this.publishDrawing(drawing.meta, sequence);
    return { ...drawing, view: await this.cache.getView(id) };
  }

  async getDrawingMeta(id: DrawingId): Promise<DrawingMeta | null> {
    await this.refresh();
    return this.snapshot.drawings.get(id) ?? null;
  }

  async loadDrawingContent(id: DrawingId): Promise<DrawingContent | null> {
    await this.mutations;
    const sequence = ++this.requestsStarted;
    const drawing = await this.readDrawing(
      `/api/drawings/${encodeURIComponent(id)}/content`,
    );
    if (drawing) {
      this.publishDrawing(drawing.meta, sequence);
    }
    return drawing?.content ?? null;
  }

  async saveDrawingContent(
    id: DrawingId,
    content: DrawingContent,
    fileIds: readonly FileId[],
    options?: SaveOptions,
  ): Promise<SaveResult> {
    const baseRevision =
      options?.baseRevision ?? this.snapshot.drawings.get(id)?.revision;
    if (baseRevision === undefined) {
      return NOT_FOUND;
    }
    const { result } = await this.commandWithFiles(
      fileIds,
      { kind: "saveDrawing", id, content, fileIds, baseRevision },
      options?.requestId,
    );
    if (result.kind !== "save") {
      throw new Error("The server returned an invalid save result");
    }
    return result.result;
  }

  async saveDrawingView(
    id: DrawingId,
    view: DrawingView,
  ): Promise<ChangeResult> {
    if (!this.snapshot.drawings.has(id)) {
      return NOT_FOUND;
    }
    await this.cache.saveView(id, view);
    return OK;
  }

  async saveThumbnail(
    id: DrawingId,
    thumbnail: Thumbnail,
  ): Promise<ChangeResult> {
    try {
      const { result } = await this.command({
        kind: "saveThumbnail",
        id,
        thumbnail,
      });
      if (result.kind !== "change") {
        throw new Error("The server returned an invalid thumbnail result");
      }
      return result.result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        return OK;
      }
      throw error;
    }
  }

  async deleteThumbnail(id: DrawingId) {
    await this.command({ kind: "deleteThumbnail", id });
  }

  async getThumbnails(ids: readonly DrawingId[]) {
    const thumbnails = new Map<DrawingId, Thumbnail>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const entries = parseThumbnails(
        await this.get(
          this.withIds("/api/thumbnails", ids.slice(offset, offset + 100)),
        ),
      );
      for (const [id, thumbnail] of entries) {
        thumbnails.set(id, thumbnail);
      }
    }
    return thumbnails;
  }

  async move(item: ItemRef, target: ParentId) {
    const { result } = await this.command({ kind: "move", item, target });
    if (result.kind !== "move") {
      throw new Error("The server returned an invalid move result");
    }
    return result.result;
  }

  trash(item: ItemRef) {
    return this.change({ kind: "trash", item });
  }

  restore(item: ItemRef) {
    return this.change({ kind: "restore", item });
  }

  deleteForever(item: ItemRef) {
    return this.change({ kind: "deleteForever", item });
  }

  async emptyTrash() {
    await this.command({ kind: "emptyTrash" });
  }

  readonly files: WorkspaceFiles = {
    get: async (ids) => {
      if (!ids.length) {
        return { loadedFiles: [], erroredFiles: new Map() };
      }
      let files: BinaryFileData[];
      try {
        files = await this.download(ids);
        const found = new Set(files.map((file) => file.id));
        files.push(
          ...(await this.cache.getFiles(ids.filter((id) => !found.has(id)))),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw error;
        }
        files = await this.cache.getFiles(ids);
      }
      const found = new Set(files.map((file) => file.id));
      return {
        loadedFiles: files,
        erroredFiles: new Map(
          ids.filter((id) => !found.has(id)).map((id) => [id, true as const]),
        ),
      };
    },
    save: async ({ addedFiles }) => {
      const files = [...addedFiles.values()];
      await this.cache.saveFiles(files);
      const savedFiles = new Map<FileId, BinaryFileData>();
      const erroredFiles = new Map<FileId, BinaryFileData>();
      for (const file of files) {
        try {
          await this.upload([file]);
          const saved = this.confirmedFiles.get(file.id);
          if (!saved) {
            throw new Error("The server did not confirm the saved image");
          }
          savedFiles.set(file.id, { ...saved });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            throw error;
          }
          erroredFiles.set(file.id, file);
        }
      }
      return { savedFiles, erroredFiles };
    },
  };

  /** Counts the browser drawings this account has not imported yet. */
  async pendingImports(local: LocalWorkspaceStore) {
    let count = 0;
    for (const id of local.getSnapshot().drawings.keys()) {
      if (!(await this.cache.imported(`drawing:${id}`))) {
        count++;
      }
    }
    return count;
  }

  /**
   * Copies the browser's folders and drawings into the account, skipping
   * what an earlier import copied and drawings the account can't take.
   */
  importLocalWorkspace(local: LocalWorkspaceStore): Promise<ImportResult> {
    this.importing ??= this.importLocal(local).finally(() => {
      this.importing = null;
    });
    return this.importing;
  }

  private async importLocal(local: LocalWorkspaceStore) {
    const snapshot = local.getSnapshot();
    const folders = new Map(snapshot.folders);
    const imported = new Set<FolderId>();
    while (folders.size) {
      let progressed = false;
      for (const [id, folder] of folders) {
        if (
          folder.parentId !== null &&
          !imported.has(folder.parentId) &&
          folders.has(folder.parentId)
        ) {
          continue;
        }
        const command: WorkspaceCommand = {
          kind: "importFolder",
          folder: {
            ...folder,
            parentId:
              folder.parentId !== null && !snapshot.folders.has(folder.parentId)
                ? null
                : folder.parentId,
          },
        };
        await this.importItem(`folder:${id}`, command);
        imported.add(id);
        folders.delete(id);
        progressed = true;
      }
      if (!progressed) {
        throw new Error(
          "The browser workspace has a folder cycle and could not be imported",
        );
      }
    }
    const result: ImportResult = { imported: 0, skipped: [] };
    for (const [id, meta] of snapshot.drawings) {
      const key = `drawing:${id}`;
      if (await this.cache.imported(key)) {
        continue;
      }
      const content = await local.loadDrawingContent(id);
      const { loadedFiles, erroredFiles } = await local.files.get([
        ...meta.fileIds,
      ]);
      if (!content || erroredFiles.size) {
        result.skipped.push(meta);
        continue;
      }
      try {
        await this.cache.saveFiles(loadedFiles);
        await this.upload(loadedFiles);
        await this.importItem(key, {
          kind: "importDrawing",
          drawing: {
            meta: {
              ...meta,
              folderId:
                meta.folderId !== null && !snapshot.folders.has(meta.folderId)
                  ? null
                  : meta.folderId,
            },
            content,
          },
        });
      } catch (error) {
        // the server refused this drawing, which another try won't change
        if (
          !(error instanceof ApiError) ||
          (error.status !== 400 && error.status !== 413)
        ) {
          throw error;
        }
        result.skipped.push(meta);
        continue;
      }
      result.imported++;
    }
    return result;
  }

  private async importItem(key: string, command: WorkspaceCommand) {
    if (await this.cache.imported(key)) {
      return;
    }
    const serialized = JSON.stringify(command);
    const digest = await this.options.ownerWindow.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized),
    );
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const { result } = await this.command(command, `import-${hash}`);
    const imported =
      command.kind === "importFolder"
        ? result.kind === "folder" && result.folder.id === command.folder.id
        : command.kind === "importDrawing" &&
          result.kind === "drawing" &&
          result.drawing?.id === command.drawing.meta.id;
    if (!imported) {
      throw new Error("The server did not confirm the imported item");
    }
    await this.cache.markImported(key);
  }

  // the server collects images no drawing has used for a day, which this
  // tab may still remember uploading
  private async commandWithFiles(
    fileIds: readonly FileId[],
    command: WorkspaceCommand,
    requestId?: string,
  ) {
    await this.ensureFiles(fileIds);
    try {
      return await this.command(command, requestId);
    } catch (error) {
      if (!(error instanceof ApiError) || error.message !== "missing_files") {
        throw error;
      }
      for (const id of fileIds) {
        this.confirmedFiles.delete(id);
      }
      await this.ensureFiles(fileIds);
      return this.command(command, requestId);
    }
  }

  private async ensureFiles(ids: readonly FileId[]) {
    const cached = await this.cache.getFiles(ids);
    const found = new Set(cached.map((file) => file.id));
    const uncached = ids.filter(
      (id) => !found.has(id) && !this.confirmedFiles.has(id),
    );
    if (uncached.length) {
      await this.download(uncached);
      if (uncached.some((id) => !this.confirmedFiles.has(id))) {
        throw new Error("The drawing has images that have not been saved");
      }
    }
    await this.upload(cached);
  }

  private async download(ids: readonly FileId[]) {
    const files: BinaryFileData[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      try {
        const loaded = parseFiles(
          await this.get(this.withIds("/api/files", batch)),
        ).files;
        await this.cache.saveFiles(loaded);
        for (const file of loaded) {
          const confirmed = this.confirmedFiles.get(file.id);
          if (!confirmed || (file.version ?? 1) >= (confirmed.version ?? 1)) {
            this.confirmedFiles.set(file.id, { ...file });
          }
        }
        files.push(...loaded);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) {
          throw error;
        }
        if (batch.length > 1) {
          for (const id of batch) {
            files.push(...(await this.download([id])));
          }
        }
      }
    }
    return files;
  }

  private async upload(files: readonly BinaryFileData[]) {
    for (const file of files) {
      const confirmed = this.confirmedFiles.get(file.id);
      if (confirmed && (file.version ?? 1) < (confirmed.version ?? 1)) {
        continue;
      }
      if (
        confirmed &&
        confirmed.dataURL !== file.dataURL &&
        (file.version ?? 1) <= (confirmed.version ?? 1)
      ) {
        throw new Error(
          "An image version cannot be reused for different image data",
        );
      }
      if (
        confirmed &&
        confirmed.dataURL === file.dataURL &&
        (file.version ?? 1) <= (confirmed.version ?? 1)
      ) {
        continue;
      }
      let data: ReturnType<typeof parseFiles>;
      try {
        data = parseFiles(
          await this.request(
            "/api/files",
            {
              method: "POST",
              body: JSON.stringify({ files: [file] }),
            },
            true,
          ),
        );
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.message === "image_collision"
        ) {
          const [current] = await this.download([file.id]);
          if (current && (current.version ?? 1) > (file.version ?? 1)) {
            continue;
          }
        }
        throw error;
      }
      const saved = data.files.find((saved) => saved.id === file.id);
      if (!saved || saved.dataURL !== file.dataURL) {
        throw new Error("The server did not confirm the saved image");
      }
      this.confirmedFiles.set(file.id, { ...saved });
    }
  }

  private async change(command: WorkspaceCommand): Promise<ChangeResult> {
    const { result } = await this.command(command);
    if (result.kind !== "change") {
      throw new Error("The server returned an invalid change result");
    }
    return result.result;
  }

  private command(
    command: WorkspaceCommand,
    requestId: string = this.requestId(),
  ): Promise<CommandResponse> {
    const saving = this.mutations.then(async () => {
      const sequence = ++this.requestsStarted;
      const response = parseCommand(
        await this.request(
          "/api/commands",
          {
            method: "POST",
            body: JSON.stringify({ requestId, command }),
          },
          true,
        ),
      );
      this.publish(response.snapshot, sequence);
      return response;
    });
    this.mutations = saving.then(
      () => {},
      () => {},
    );
    return saving;
  }

  private requestId() {
    return this.options.ownerWindow.crypto.randomUUID();
  }

  private publish(data: WorkspaceData, sequence: number) {
    if (this.closed || sequence < this.snapshotShown) {
      return;
    }
    this.snapshotShown = sequence;
    this.snapshot = {
      folders: new Map(data.folders.map((folder) => [folder.id, folder])),
      drawings: new Map(data.drawings.map((drawing) => [drawing.id, drawing])),
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private publishDrawing(meta: DrawingMeta, sequence: number) {
    if (this.closed || sequence < this.snapshotShown) {
      return;
    }
    this.snapshotShown = sequence;
    this.snapshot = {
      folders: this.snapshot.folders,
      drawings: new Map(this.snapshot.drawings).set(meta.id, meta),
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private withIds(path: string, ids: readonly string[]) {
    return `${path}?ids=${ids.map(encodeURIComponent).join(",")}`;
  }

  private get(path: string) {
    return this.request(path, { method: "GET" });
  }

  private async readDrawing(path: string): Promise<DrawingData | null> {
    try {
      return parseDrawing(await this.get(path));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    retry = false,
  ): Promise<unknown> {
    if (this.closed) {
      throw new ApiError(0, "This workspace is closed");
    }
    const options: RequestInit = {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": this.options.session.csrfToken,
        "X-Setsquare-Account": this.user.id,
      },
    };
    let response: Response;
    try {
      response = await this.fetch(path, options);
    } catch (error) {
      if (retry && !this.closed) {
        return this.request(path, init);
      }
      throw error;
    }
    if (response.status === 401 && !this.expired) {
      this.expired = true;
      this.options.onSessionExpired();
    }
    if (!response.ok) {
      if (retry && response.status >= 500 && !this.closed) {
        return this.request(path, init);
      }
      let message = `The request failed (${response.status})`;
      try {
        const body: unknown = await response.json();
        if (
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
        ) {
          message = body.error;
        }
      } catch {
        // a proxy can return an error page rather than the API's JSON
      }
      throw new ApiError(response.status, message);
    }
    return response.json();
  }
}
