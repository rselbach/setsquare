import type { FileId } from "@setsquare/element/types";

import type { BinaryFileData, BinaryFiles } from "@setsquare/setsquare/types";

import { ApiError, apiFailureCause, RequestFailure } from "./ApiError";
import { parseFilePage, parseFiles } from "./parse";
import { withIds } from "./transport";

import type { WorkspaceFiles } from "../WorkspaceStore";
import type { AccountCache } from "./AccountCache";
import type { AccountClient } from "./transport";

type FileChange = Parameters<WorkspaceFiles["save"]>[0];

/**
 * Keeps the images a drawing references on the account server, with a device
 * copy for recovery.
 *
 * Version and collision policy:
 *
 * - An image id names the original picture, and its `version` (1 when unset)
 *   rises only when the image itself changes. Other bytes at the same version
 *   are another rendering of that picture, since browsers resize and encode
 *   the same image differently, so they never count as a newer copy.
 * - Staging keeps the first rendering of a version and replaces it only with
 *   a higher version. `AccountCache.saveFiles` applies the same rule on the
 *   device.
 * - The server's bytes are the account's copy. A download replaces the cached
 *   rendering at its version and is confirmed when it is at least as new as
 *   the confirmed copy. Downloads and confirmed uploads mark the device copy
 *   confirmed, which lets `AccountCache.maintain` reclaim it.
 * - An upload is skipped when the server has confirmed the same or a higher
 *   version. When another device uploaded the version first
 *   (`409 image_collision`), its bytes are adopted if they are at least as new.
 * - The device cache is best effort while syncing: a failed write is logged,
 *   and an unreadable cache is a miss. Staging is the exception, because
 *   staging exists to make the device copy durable before a save is queued.
 */
export class FileSync {
  private readonly confirmedFiles = new Map<FileId, BinaryFileData>();
  private readonly stagedFiles = new Map<
    FileId,
    { version: number; saved: Promise<void> }
  >();

  constructor(
    private readonly client: AccountClient,
    private readonly cache: AccountCache,
  ) {}

  /** Makes image recovery durable before a queued save reaches the network. */
  async stage(files: BinaryFiles) {
    return Promise.all(
      Object.values(files).map((file) => {
        const staged = this.stagedFiles.get(file.id);
        // other bytes at a staged version are another rendering of the image
        if (staged && (file.version ?? 1) <= staged.version) {
          return staged.saved;
        }
        const saved = this.cache
          .saveFiles([file], { lease: true })
          .catch((error) => {
            if (this.stagedFiles.get(file.id)?.saved === saved) {
              this.stagedFiles.delete(file.id);
            }
            throw error;
          });
        this.stagedFiles.set(file.id, { version: file.version ?? 1, saved });
        return saved;
      }),
    ).then(() => {});
  }

  async get(ids: readonly FileId[]) {
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
  }

  async save({ addedFiles }: FileChange) {
    const files = [...addedFiles.values()];
    await this.cacheFiles(files);
    const savedFiles = new Map<FileId, BinaryFileData>();
    const erroredFiles = new Map<FileId, BinaryFileData>();
    const errors = new Map<FileId, unknown>();
    for (const file of files) {
      try {
        await this.upload([file]);
        const saved = this.confirmedFiles.get(file.id);
        if (!saved) {
          throw new Error("The server did not confirm the saved image");
        }
        savedFiles.set(file.id, { ...saved });
      } catch (error) {
        erroredFiles.set(file.id, file);
        errors.set(file.id, error);
      }
    }
    return { savedFiles, erroredFiles, errors };
  }

  /**
   * Runs a command that references the images once they are on the server.
   * The server collects images no drawing has used for a day, which this tab
   * may still remember uploading, so `missing_files` uploads them again.
   */
  async withFiles<T>(ids: readonly FileId[], run: () => Promise<T>) {
    await this.ensure(ids);
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof ApiError) || error.message !== "missing_files") {
        throw error;
      }
      for (const id of ids) {
        this.confirmedFiles.delete(id);
      }
      await this.ensure(ids);
      return run();
    }
  }

  async upload(files: readonly BinaryFileData[]) {
    for (const file of files) {
      const confirmed = this.confirmedFiles.get(file.id);
      if (confirmed && (file.version ?? 1) <= (confirmed.version ?? 1)) {
        continue;
      }
      let data: ReturnType<typeof parseFiles>;
      try {
        data = parseFiles(
          await this.client.post("/api/files", { files: [file] }),
        );
      } catch (error) {
        // Image bytes can be uploaded again; only commands need receipts.
        const cause = apiFailureCause(error);
        if (
          cause instanceof ApiError &&
          cause.status === 409 &&
          cause.message === "image_collision"
        ) {
          const [current] = await this.download([file.id]);
          if (current && (current.version ?? 1) >= (file.version ?? 1)) {
            continue;
          }
        }
        throw cause;
      }
      const saved = data.files.find((saved) => saved.id === file.id);
      if (!saved || saved.dataURL !== file.dataURL) {
        throw new Error("The server did not confirm the saved image");
      }
      this.confirmedFiles.set(file.id, { ...saved });
      await this.cacheFiles([saved], { replace: true });
    }
  }

  private async ensure(ids: readonly FileId[]) {
    if (!ids.length) {
      return;
    }
    try {
      const cached = await this.cache.getFiles(ids).catch((error) => {
        console.warn("Could not read the device's cached images", error);
        return [];
      });
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
    } catch (error) {
      // Image requests cannot commit the drawing command they prepare.
      throw new RequestFailure("not-committed", error);
    }
  }

  private async cacheFiles(
    files: readonly BinaryFileData[],
    options?: { replace?: boolean },
  ) {
    try {
      await this.cache.saveFiles(files, options);
    } catch (error) {
      console.warn("Could not keep a device copy of the images", error);
    }
  }

  private async download(ids: readonly FileId[]) {
    const files: BinaryFileData[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      let batch = ids.slice(offset, offset + 100);
      while (batch.length) {
        try {
          const { files: loaded, remaining } = parseFilePage(
            await this.client.get(withIds("/api/files", batch)),
          );
          if (remaining.length >= batch.length) {
            throw new Error("The server returned none of the requested images");
          }
          await this.cacheFiles(loaded, { replace: true });
          for (const file of loaded) {
            const confirmed = this.confirmedFiles.get(file.id);
            if (!confirmed || (file.version ?? 1) >= (confirmed.version ?? 1)) {
              this.confirmedFiles.set(file.id, { ...file });
            }
          }
          files.push(...loaded);
          // the server stops each response at its size budget
          batch = remaining;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) {
            throw error;
          }
          if (batch.length > 1) {
            for (const id of batch) {
              files.push(...(await this.download([id])));
            }
          }
          batch = [];
        }
      }
    }
    return files;
  }
}
