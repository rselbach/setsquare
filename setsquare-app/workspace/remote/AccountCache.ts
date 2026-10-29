import type { FileId } from "@setsquare/element/types";

import type { BinaryFileData } from "@setsquare/setsquare/types";

import { request, transact } from "../local/idb";

import { parseAccountDraft, parseFiles, parseView } from "./parse";

import type { AccountDraft, DrawingId, DrawingView } from "../types";

/** Recovery images and views belonging to one account on this device. */
export class AccountCache {
  static async open(ownerWindow: Window, accountId: string) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = ownerWindow.indexedDB.open(
        `setsquare-account-${accountId}`,
        2,
      );
      opening.onupgradeneeded = (event) => {
        if (event.oldVersion < 1) {
          opening.result.createObjectStore("files");
          opening.result.createObjectStore("views");
          opening.result.createObjectStore("imports");
        }
        if (event.oldVersion < 2) {
          opening.result
            .createObjectStore("drafts")
            .createIndex("drawing", "id");
        }
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    return new AccountCache(db);
  }

  private constructor(private readonly db: IDBDatabase) {}

  async getFiles(ids: readonly FileId[]) {
    const values = await transact(this.db, ["files"], "readonly", (tx) =>
      Promise.all(ids.map((id) => request(tx.objectStore("files").get(id)))),
    );
    return parseFiles({ files: values.filter((value) => value !== undefined) })
      .files;
  }

  async saveFiles(files: readonly BinaryFileData[]) {
    await transact(this.db, ["files"], "readwrite", async (tx) => {
      const store = tx.objectStore("files");
      for (const file of files) {
        const previous: unknown = await request(store.get(file.id));
        if (previous !== undefined) {
          const [saved] = parseFiles({ files: [previous] }).files;
          if ((file.version ?? 1) < (saved.version ?? 1)) {
            continue;
          }
          if (
            saved.dataURL !== file.dataURL &&
            (file.version ?? 1) === (saved.version ?? 1)
          ) {
            throw new Error(
              "An image version cannot be reused for different image data",
            );
          }
        }
        await request(store.put(file, file.id));
      }
    });
  }

  async getView(id: DrawingId): Promise<DrawingView | null> {
    const value = await transact(this.db, ["views"], "readonly", (tx) =>
      request(tx.objectStore("views").get(id)),
    );
    return value === undefined ? null : parseView(value);
  }

  async saveView(id: DrawingId, view: DrawingView) {
    await transact(this.db, ["views"], "readwrite", (tx) =>
      request(tx.objectStore("views").put(view, id)),
    );
  }

  async imported(key: string): Promise<boolean> {
    return transact(
      this.db,
      ["imports"],
      "readonly",
      async (tx) =>
        (await request(tx.objectStore("imports").get(key))) === true,
    );
  }

  async markImported(key: string) {
    await transact(this.db, ["imports"], "readwrite", (tx) =>
      request(tx.objectStore("imports").put(true, key)),
    );
  }

  saveDraft(draft: AccountDraft) {
    return transact(this.db, ["drafts"], "readwrite", async (tx) => {
      const value: unknown = JSON.parse(JSON.stringify(draft));
      await request(tx.objectStore("drafts").put(value, draft.draftId));
    });
  }

  async loadDrafts(id: DrawingId) {
    const values = await transact(this.db, ["drafts"], "readonly", (tx) =>
      request<unknown[]>(tx.objectStore("drafts").index("drawing").getAll(id)),
    );
    return values.map(parseAccountDraft);
  }

  removeDraft(draftId: string, generation?: string) {
    return transact(this.db, ["drafts"], "readwrite", async (tx) => {
      const store = tx.objectStore("drafts");
      const value: unknown = await request(store.get(draftId));
      if (
        value !== undefined &&
        (!generation || parseAccountDraft(value).generation === generation)
      ) {
        await request(store.delete(draftId));
      }
    });
  }

  close() {
    this.db.close();
  }
}
