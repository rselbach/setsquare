import { ApiError } from "./ApiError";

import type { WorkspaceCommand } from "../api";
import type { LocalWorkspaceStore } from "../local/LocalWorkspaceStore";
import type { DrawingMeta } from "../types";
import type { AccountCache } from "./AccountCache";
import type { FileSync } from "./fileSync";
import type { SnapshotState } from "./snapshot";

/** What an import of the browser's drawings copied, and what it left. */
export type ImportResult = { imported: number; skipped: DrawingMeta[] };

/**
 * Copies the browser's workspace into the account. Each item is sent with a
 * request id derived from its content and marked once the server confirms it,
 * so an interrupted import resumes without duplicates.
 */
export class LocalImport {
  private importing: Promise<ImportResult> | null = null;

  constructor(
    private readonly state: SnapshotState,
    private readonly files: FileSync,
    private readonly cache: AccountCache,
    private readonly ownerWindow: Window,
  ) {}

  /** Counts the browser drawings this account has not imported yet. */
  async pending(local: LocalWorkspaceStore) {
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
  run(local: LocalWorkspaceStore): Promise<ImportResult> {
    this.importing ??= this.importLocal(local).finally(() => {
      this.importing = null;
    });
    return this.importing;
  }

  private async importLocal(local: LocalWorkspaceStore) {
    const snapshot = local.getSnapshot();
    const folders = new Map(snapshot.folders);
    while (folders.size) {
      let progressed = false;
      for (const [id, folder] of folders) {
        if (folder.parentId !== null && folders.has(folder.parentId)) {
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
        await this.files.upload(loadedFiles);
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
    const digest = await this.ownerWindow.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized),
    );
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const { result } = await this.state.command(command, `import-${hash}`);
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
}
