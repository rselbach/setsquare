import { z } from "zod";

import type { FileId } from "@setsquare/element/types";

import type { BinaryFileData } from "@setsquare/setsquare/types";

import { storedAccountDrafts } from "../../web/unsavedJournal";
import { openDatabase, request, transact } from "../local/idb";

import {
  draftFileIds,
  parseAccountDraft,
  parseFiles,
  parseView,
} from "./parse";

import type { UpgradeEvents } from "../local/idb";
import type {
  AccountDraft,
  DrawingId,
  DrawingMeta,
  DrawingView,
} from "../types";

const parseDrafts = (values: unknown[]) =>
  values.flatMap((value) => {
    try {
      return [parseAccountDraft(value)];
    } catch (error) {
      // left in place for a build that can read it
      console.warn("Skipping an unreadable recovery draft", error);
      return [];
    }
  });

const ownerLock = (owner: string) => `setsquare-image-cache:${owner}`;

// leases no lock vouches for, which no tab can show have ended
const UNHELD = "";

/**
 * Holds the lock that tells other tabs this cache's leases are live until
 * the cache closes.
 */
const holdOwner = (locks: LockManager, owner: string) =>
  new Promise<() => void>((resolve, reject) => {
    locks
      .request(
        ownerLock(owner),
        () => new Promise<void>((release) => resolve(() => release())),
      )
      .catch(reject);
  });

/**
 * Recovery images and views belonging to one account on this device.
 *
 * The cache is shared by every tab signed in to the account, so an image is
 * deleted only on evidence those tabs share: the server confirmed the cached
 * bytes, no stored draft or pinned request shows it, no drawing in the
 * snapshot uses it, and every cache that staged it has closed. Staging leases
 * the image to its cache in the same transaction as the bytes, and each cache
 * holds a Web Lock while open, which is how another tab sees it closed.
 */
export class AccountCache {
  static async open(
    ownerWindow: Window,
    accountId: string,
    { onBlocked, onVersionChange }: UpgradeEvents = {},
  ) {
    const db = await openDatabase(
      `setsquare-account-${accountId}`,
      3,
      (db, oldVersion) => {
        if (oldVersion < 1) {
          db.createObjectStore("files");
          db.createObjectStore("views");
          db.createObjectStore("imports");
        }
        if (oldVersion < 2) {
          db.createObjectStore("drafts").createIndex("drawing", "id");
        }
        if (oldVersion < 3) {
          // [owner, image id] keys, one per image a cache staged
          db.createObjectStore("leases");
          // image ids whose cached bytes the server confirmed
          db.createObjectStore("confirmed");
        }
      },
      { factory: ownerWindow.indexedDB, onBlocked, onVersionChange },
    );
    const { locks } = ownerWindow.navigator;
    if (locks) {
      const owner = ownerWindow.crypto.randomUUID();
      try {
        const release = await holdOwner(locks, owner);
        return new AccountCache(db, accountId, ownerWindow, owner, {
          locks,
          release,
        });
      } catch (error) {
        console.warn("Could not lock the account's image cache", error);
      }
    }
    return new AccountCache(db, accountId, ownerWindow, UNHELD, null);
  }

  private constructor(
    private readonly db: IDBDatabase,
    private readonly accountId: string,
    private readonly ownerWindow: Window,
    private readonly owner: string,
    private readonly lock: { locks: LockManager; release: () => void } | null,
  ) {}

  async getFiles(ids: readonly FileId[]) {
    const values = await transact(this.db, ["files"], "readonly", (tx) =>
      Promise.all(ids.map((id) => request(tx.objectStore("files").get(id)))),
    );
    return parseFiles({ files: values.filter((value) => value !== undefined) })
      .files;
  }

  /**
   * Keeps the newest version of each image. Image ids name the original
   * picture, so other bytes at the same version are another rendering of it:
   * the cached copy stays unless `replace` marks the server's confirmed copy.
   * `lease` keeps each image, whether written or already cached, until this
   * cache closes.
   */
  async saveFiles(
    files: readonly BinaryFileData[],
    {
      replace = false,
      lease = false,
    }: { replace?: boolean; lease?: boolean } = {},
  ) {
    const stores = ["files", "confirmed", "leases"];
    await transact(this.db, stores, "readwrite", async (tx) => {
      const store = tx.objectStore("files");
      const confirmed = tx.objectStore("confirmed");
      for (const file of files) {
        if (lease) {
          await request(
            tx.objectStore("leases").put(true, [this.owner, file.id]),
          );
        }
        const previous: unknown = await request(store.get(file.id));
        if (previous !== undefined) {
          const [saved] = parseFiles({ files: [previous] }).files;
          const version = file.version ?? 1;
          const savedVersion = saved.version ?? 1;
          if (
            version < savedVersion ||
            (version === savedVersion && !replace)
          ) {
            continue;
          }
        }
        await request(store.put(file, file.id));
        if (replace) {
          await request(confirmed.put(true, file.id));
        } else {
          await request(confirmed.delete(file.id));
        }
      }
    });
  }

  async getView(id: DrawingId): Promise<DrawingView | null> {
    return transact(this.db, ["views"], "readwrite", async (tx) => {
      const store = tx.objectStore("views");
      const value: unknown = await request(store.get(id));
      if (value === undefined) {
        return null;
      }
      try {
        return parseView(value);
      } catch (error) {
        console.warn("Discarding invalid cached drawing view", id, error);
        await request(store.delete(id));
        return null;
      }
    });
  }

  async saveView(id: DrawingId, view: DrawingView) {
    const value: unknown = JSON.parse(JSON.stringify(view));
    await transact(this.db, ["views"], "readwrite", (tx) =>
      request(tx.objectStore("views").put(value, id)),
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
    return parseDrafts(values);
  }

  async listDrafts() {
    const values = await transact(this.db, ["drafts"], "readonly", (tx) =>
      request<unknown[]>(tx.objectStore("drafts").getAll()),
    );
    return parseDrafts(values);
  }

  /**
   * Deletes a draft, but only a copy last edited at or before `notAfter` when
   * that is given, so a newer copy its editor wrote since stays. The check
   * reads just `updatedAt`, so a record this build cannot parse still goes,
   * and one without a readable `updatedAt` is deleted outright.
   */
  removeDraft(draftId: string, notAfter?: number) {
    return transact(this.db, ["drafts"], "readwrite", async (tx) => {
      const store = tx.objectStore("drafts");
      const value: unknown = await request(store.get(draftId));
      const saved = z.object({ updatedAt: z.number() }).safeParse(value);
      if (
        value !== undefined &&
        (notAfter === undefined ||
          !saved.success ||
          saved.data.updatedAt <= notAfter)
      ) {
        await request(store.delete(draftId));
      }
    });
  }

  /**
   * Deletes cached views of drawings the snapshot no longer has, and images
   * the cache can show no tab still needs. Without Web Locks no tab can tell
   * whether another still needs what it staged, so images stay.
   */
  async maintain(drawings: ReadonlyMap<DrawingId, DrawingMeta>) {
    await transact(this.db, ["views"], "readwrite", async (tx) => {
      const views = tx.objectStore("views");
      for (const key of await request(views.getAllKeys())) {
        if (!drawings.has(key as DrawingId)) {
          await request(views.delete(key));
        }
      }
    });
    if (!this.lock) {
      return;
    }
    const leased = await transact(this.db, ["leases"], "readonly", (tx) =>
      request(tx.objectStore("leases").getAllKeys()),
    );
    // A cache takes its lock before writing a lease, so the owner of a lease
    // read above that holds no lock now has closed for good.
    const { held = [] } = await this.lock.locks.query();
    const live = new Set(held.map(({ name }) => name));
    const closed = new Set(
      leased
        .map((key) => (key as [string, FileId])[0])
        .filter((owner) => owner !== UNHELD && !live.has(ownerLock(owner))),
    );
    // read after the query, so a closed cache's drafts are all written
    const keep = new Set<FileId>();
    for (const value of storedAccountDrafts(
      this.accountId,
      this.ownerWindow.localStorage,
    )) {
      const ids = draftFileIds(value);
      if (!ids) {
        console.warn("Keeping cached images for an unreadable draft");
        return;
      }
      ids.forEach((id) => keep.add(id));
    }
    for (const meta of drawings.values()) {
      meta.fileIds.forEach((id) => keep.add(id));
    }
    const stores = ["files", "confirmed", "leases", "drafts"];
    await transact(this.db, stores, "readwrite", async (tx) => {
      const leases = tx.objectStore("leases");
      for (const key of await request(leases.getAllKeys())) {
        const [owner, id] = key as [string, FileId];
        if (closed.has(owner)) {
          await request(leases.delete(key));
        } else {
          keep.add(id);
        }
      }
      for (const value of await request(tx.objectStore("drafts").getAll())) {
        const ids = draftFileIds(value);
        if (!ids) {
          console.warn("Keeping cached images for an unreadable draft");
          return;
        }
        ids.forEach((id) => keep.add(id));
      }
      const confirmed = tx.objectStore("confirmed");
      for (const key of await request(confirmed.getAllKeys())) {
        if (!keep.has(key as FileId)) {
          await request(tx.objectStore("files").delete(key));
          await request(confirmed.delete(key));
        }
      }
    });
  }

  close() {
    this.db.close();
    this.lock?.release();
  }
}
