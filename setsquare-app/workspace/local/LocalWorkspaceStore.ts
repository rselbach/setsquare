import type { FileId } from "@setsquare/element/types";

import { STORAGE_KEYS } from "../../app_constants";
import { getLocalFiles, saveLocalFiles } from "../../data/localFiles";
import { openBroadcast } from "../broadcast";
import { emptyDrawingContent } from "../drawingAppState";
import { loadPrefs, savePrefs } from "../prefs";
import {
  canMove,
  expiredTrash,
  findItem,
  isTrashed,
  parentOf,
  subtree,
  trashRoots,
} from "../tree";
import { newDrawingMeta, newFolderId } from "../types";

import { deleteUnusedFiles } from "./fileGC";
import { openDatabase, request, transact } from "./idb";
import { readLegacyScene } from "./migrateLegacy";

import type { WorkspaceBroadcast } from "../broadcast";
import type { SaveOptions } from "../api";
import type {
  ChangeResult,
  DrawingContent,
  DrawingId,
  DrawingMeta,
  DrawingView,
  Folder,
  FolderId,
  ItemRef,
  MoveResult,
  OpenedDrawing,
  ParentId,
  SaveResult,
  Thumbnail,
  WorkspaceItem,
  WorkspaceItems,
  WorkspaceSnapshot,
} from "../types";
import type {
  NewDrawing,
  WorkspaceFiles,
  WorkspaceStore,
} from "../WorkspaceStore";

const SCHEMA_VERSION = 1;
const CHANNEL_NAME = "setsquare-workspace";

// what each store holds; every store keys its values by the item's id
interface Records {
  folders: Folder;
  drawings: DrawingMeta;
  contents: DrawingContent;
  views: DrawingView;
  thumbnails: Thumbnail;
}
type RecordStore = keyof Records;
type StoreName = RecordStore | "meta";

const STORE_NAMES: readonly StoreName[] = [
  "folders",
  "drawings",
  "contents",
  "views",
  "thumbnails",
  "meta",
];
const TREE_STORES: readonly StoreName[] = ["folders", "drawings"];
const DRAWING_STORES = ["drawings", "contents", "views", "thumbnails"] as const;
const ITEM_STORES: readonly StoreName[] = ["folders", ...DRAWING_STORES];

const SCHEMA_VERSION_KEY = "schemaVersion";
const LEGACY_MIGRATION_KEY = "legacyMigration";

/** When this browser's legacy scene was imported, and as which drawing. */
type LegacyMigration = { at: number; drawingId: DrawingId | null };

const NOT_FOUND = { ok: false, reason: "notFound" } as const;
const OK = { ok: true } as const;

const upgrade = (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => {
  if (oldVersion < 1) {
    for (const name of STORE_NAMES) {
      db.createObjectStore(name);
    }
  }
  tx.objectStore("meta").put(SCHEMA_VERSION, SCHEMA_VERSION_KEY);
};

const get = <S extends RecordStore>(tx: IDBTransaction, store: S, id: string) =>
  request<Records[S] | undefined>(tx.objectStore(store).get(id));

const getAll = <S extends RecordStore>(tx: IDBTransaction, store: S) =>
  request<Records[S][]>(tx.objectStore(store).getAll());

const put = <S extends RecordStore>(
  tx: IDBTransaction,
  store: S,
  id: string,
  value: Records[S],
) => request(tx.objectStore(store).put(value, id));

// stores change(record) in place of the record, if there is one
const update = async <S extends RecordStore>(
  tx: IDBTransaction,
  store: S,
  id: string,
  change: (record: Records[S]) => Records[S],
) => {
  const record = await get(tx, store, id);
  if (record === undefined) {
    return null;
  }
  const next = change(record);
  await put(tx, store, id, next);
  return next;
};

const readSnapshot = async (tx: IDBTransaction): Promise<WorkspaceSnapshot> => {
  const [folders, drawings] = await Promise.all([
    getAll(tx, "folders"),
    getAll(tx, "drawings"),
  ]);
  return {
    folders: new Map(folders.map((folder) => [folder.id, folder])),
    drawings: new Map(drawings.map((drawing) => [drawing.id, drawing])),
  };
};

const putDrawing = (
  tx: IDBTransaction,
  drawing: { meta: DrawingMeta; content: DrawingContent; view?: DrawingView },
) =>
  Promise.all([
    put(tx, "drawings", drawing.meta.id, drawing.meta),
    put(tx, "contents", drawing.meta.id, drawing.content),
    drawing.view && put(tx, "views", drawing.meta.id, drawing.view),
  ]);

// deletes folders, and drawings with every record they have
const deleteItems = (
  tx: IDBTransaction,
  items: {
    folders: readonly { id: FolderId }[];
    drawings: readonly { id: DrawingId }[];
  },
) =>
  Promise.all([
    ...items.folders.map((folder) =>
      request(tx.objectStore("folders").delete(folder.id)),
    ),
    ...items.drawings.flatMap((drawing) =>
      DRAWING_STORES.map((store) =>
        request(tx.objectStore(store).delete(drawing.id)),
      ),
    ),
  ]);

// the items and everything inside them
const withContents = (
  snap: WorkspaceSnapshot,
  items: WorkspaceItems,
): WorkspaceItems => {
  const inside = items.folders.map((folder) => subtree(snap, folder.id));
  return {
    folders: inside.flatMap((each) => each.folders),
    drawings: [...items.drawings, ...inside.flatMap((each) => each.drawings)],
  };
};

const itemStore = (item: ItemRef) =>
  item.kind === "folder" ? "folders" : "drawings";

const withParent = (item: WorkspaceItem, parentId: ParentId): WorkspaceItem =>
  "parentId" in item ? { ...item, parentId } : { ...item, folderId: parentId };

const withName = (
  content: DrawingContent,
  name: string | null,
): DrawingContent => ({ ...content, appState: { ...content.appState, name } });

const edited = (drawing: DrawingMeta, at: number): DrawingMeta => ({
  ...drawing,
  updatedAt: at,
  revision: drawing.revision + 1,
});

/** Where {@link LocalWorkspaceStore.open} keeps the workspace. */
export interface LocalWorkspaceOptions {
  dbName?: string;
  /** the BroadcastChannel this browser's tabs tell each other changes on */
  channelName?: string;
  now?: () => number;
}

/**
 * The workspace kept in this browser's IndexedDB. Each change is one
 * transaction, and the other tabs open on it hear about it.
 */
export class LocalWorkspaceStore implements WorkspaceStore {
  /** Opens the workspace in this browser, creating it on first use. */
  static async open({
    dbName = STORAGE_KEYS.IDB_WORKSPACE,
    channelName = CHANNEL_NAME,
    now = Date.now,
  }: LocalWorkspaceOptions = {}) {
    const db = await openDatabase(dbName, SCHEMA_VERSION, upgrade);
    const store = new LocalWorkspaceStore(db, channelName, now);
    try {
      await store.refresh();
    } catch (error) {
      store.close();
      throw error;
    }
    return store;
  }

  readonly files: WorkspaceFiles = {
    get: getLocalFiles,
    save: saveLocalFiles,
  };

  private readonly db: IDBDatabase;
  private readonly now: () => number;
  private readonly broadcast: WorkspaceBroadcast;
  private readonly listeners = new Set<() => void>();
  private snapshot: WorkspaceSnapshot = {
    folders: new Map(),
    drawings: new Map(),
  };
  // refreshes can finish out of order, so only the latest started one counts
  private refreshesStarted = 0;
  private refreshShown = 0;

  private constructor(db: IDBDatabase, channelName: string, now: () => number) {
    this.db = db;
    this.now = now;
    this.broadcast = openBroadcast(channelName, () => {
      this.refresh().then(
        () => this.notify(),
        (error) => console.error(error),
      );
    });
  }

  // arrow functions, so they can go to useSyncExternalStore as they are
  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async createFolder(parentId: ParentId, name: string) {
    const at = this.now();
    const folder: Folder = {
      id: newFolderId(),
      name,
      parentId,
      createdAt: at,
      updatedAt: at,
      trashedAt: null,
    };
    await this.write(["folders"], (tx) =>
      put(tx, "folders", folder.id, folder),
    );
    return folder;
  }

  renameFolder(id: FolderId, name: string): Promise<ChangeResult> {
    const at = this.now();
    return this.write(["folders"], async (tx) => {
      const folder = await update(tx, "folders", id, (folder) => ({
        ...folder,
        name,
        updatedAt: at,
      }));
      return folder ? OK : NOT_FOUND;
    });
  }

  async createDrawing({
    folderId,
    name,
    content = emptyDrawingContent(name),
    fileIds = [],
  }: NewDrawing) {
    const meta = newDrawingMeta({ name, folderId, fileIds }, this.now());
    await this.write(["drawings", "contents"], (tx) =>
      putDrawing(tx, { meta, content: withName(content, name) }),
    );
    return meta;
  }

  duplicateDrawing(id: DrawingId, name: string | null) {
    const at = this.now();
    return this.write(["drawings", "contents", "thumbnails"], async (tx) => {
      const [source, content, thumbnail] = await Promise.all([
        get(tx, "drawings", id),
        get(tx, "contents", id),
        get(tx, "thumbnails", id),
      ]);
      if (!source) {
        return null;
      }
      const meta = newDrawingMeta(
        { name, folderId: source.folderId, fileIds: source.fileIds },
        at,
      );
      await putDrawing(tx, {
        meta,
        content: withName(content ?? emptyDrawingContent(name), name),
      });
      // a thumbnail of the source's latest revision shows the copy too
      if (thumbnail?.revision === source.revision) {
        await put(tx, "thumbnails", meta.id, {
          ...thumbnail,
          revision: meta.revision,
        });
      }
      return meta;
    });
  }

  renameDrawing(id: DrawingId, name: string | null) {
    const at = this.now();
    return this.write(
      ["drawings", "contents"],
      async (tx): Promise<SaveResult> => {
        const meta = await update(tx, "drawings", id, (drawing) => ({
          ...edited(drawing, at),
          name,
        }));
        if (!meta) {
          return NOT_FOUND;
        }
        await update(tx, "contents", id, (content) => withName(content, name));
        return { ok: true, meta };
      },
    );
  }

  openDrawing(id: DrawingId) {
    const at = this.now();
    return this.write(
      ["drawings", "contents", "views"],
      async (tx): Promise<OpenedDrawing | null> => {
        const [meta, content, view] = await Promise.all([
          update(tx, "drawings", id, (drawing) => ({
            ...drawing,
            openedAt: at,
          })),
          get(tx, "contents", id),
          get(tx, "views", id),
        ]);
        if (!meta) {
          return null;
        }
        return {
          meta,
          content: content ?? emptyDrawingContent(meta.name),
          view: view ?? null,
        };
      },
    );
  }

  async getDrawingMeta(id: DrawingId) {
    const meta = await this.read(["drawings"], (tx) => get(tx, "drawings", id));
    return meta ?? null;
  }

  async loadDrawingContent(id: DrawingId) {
    const content = await this.read(["contents"], (tx) =>
      get(tx, "contents", id),
    );
    return content ?? null;
  }

  saveDrawingContent(
    id: DrawingId,
    content: DrawingContent,
    fileIds: readonly FileId[],
    options?: SaveOptions,
  ) {
    const at = this.now();
    // the drawing takes its name from the content, so renaming it in the
    // editor renames it everywhere
    const name = content.appState.name || null;
    return this.write(
      ["drawings", "contents"],
      async (tx): Promise<SaveResult> => {
        if (options) {
          const current = await get(tx, "drawings", id);
          if (!current) {
            return NOT_FOUND;
          }
          if (current.revision !== options.baseRevision) {
            return { ok: false, reason: "conflict", meta: current };
          }
        }
        const meta = await update(tx, "drawings", id, (drawing) => ({
          ...edited(drawing, at),
          name,
          fileIds,
        }));
        if (!meta) {
          return NOT_FOUND;
        }
        await put(tx, "contents", id, withName(content, name));
        return { ok: true, meta };
      },
    );
  }

  /**
   * Saves where this browser left the drawing. Unlike other changes, it
   * isn't announced: views aren't in the snapshot, each tab keeps its own,
   * and they're saved as often as someone scrolls.
   */
  saveDrawingView(id: DrawingId, view: DrawingView): Promise<ChangeResult> {
    return transact(this.db, ["drawings", "views"], "readwrite", async (tx) => {
      if (!(await get(tx, "drawings", id))) {
        return NOT_FOUND;
      }
      await put(tx, "views", id, JSON.parse(JSON.stringify(view)));
      return OK;
    });
  }

  saveThumbnail(id: DrawingId, thumbnail: Thumbnail): Promise<ChangeResult> {
    return this.write(["drawings", "thumbnails"], async (tx) => {
      if (!(await get(tx, "drawings", id))) {
        return NOT_FOUND;
      }
      await put(tx, "thumbnails", id, thumbnail);
      return OK;
    });
  }

  async deleteThumbnail(id: DrawingId) {
    await this.write(["thumbnails"], (tx) =>
      request(tx.objectStore("thumbnails").delete(id)),
    );
  }

  async getThumbnails(ids: readonly DrawingId[]) {
    const thumbnails = await this.read(["thumbnails"], (tx) =>
      Promise.all(ids.map((id) => get(tx, "thumbnails", id))),
    );
    const byDrawing = new Map<DrawingId, Thumbnail>();
    ids.forEach((id, index) => {
      const thumbnail = thumbnails[index];
      if (thumbnail) {
        byDrawing.set(id, thumbnail);
      }
    });
    return byDrawing;
  }

  move(item: ItemRef, target: ParentId): Promise<MoveResult> {
    return this.write(TREE_STORES, async (tx) => {
      // checked in the transaction, so two tabs can't make a cycle together
      const snap = await readSnapshot(tx);
      const result = canMove(snap, item, target);
      const record = findItem(snap, item);
      if (result.ok && record) {
        await put(tx, itemStore(item), item.id, withParent(record, target));
      }
      return result;
    });
  }

  trash(item: ItemRef): Promise<ChangeResult> {
    const at = this.now();
    return this.write(TREE_STORES, async (tx) => {
      const record = await update(tx, itemStore(item), item.id, (record) => ({
        ...record,
        trashedAt: record.trashedAt ?? at,
      }));
      return record ? OK : NOT_FOUND;
    });
  }

  restore(item: ItemRef): Promise<ChangeResult> {
    return this.write(TREE_STORES, async (tx) => {
      const snap = await readSnapshot(tx);
      const record = findItem(snap, item);
      if (!record) {
        return NOT_FOUND;
      }
      const parentId = parentOf(snap, record);
      const target =
        parentId !== null && isTrashed(snap, { kind: "folder", id: parentId })
          ? null
          : parentId;
      await put(tx, itemStore(item), item.id, {
        ...withParent(record, target),
        trashedAt: null,
      });
      return OK;
    });
  }

  deleteForever(item: ItemRef): Promise<ChangeResult> {
    return this.write(ITEM_STORES, async (tx) => {
      const snap = await readSnapshot(tx);
      if (!findItem(snap, item)) {
        return NOT_FOUND;
      }
      await deleteItems(
        tx,
        item.kind === "folder"
          ? subtree(snap, item.id)
          : { folders: [], drawings: [item] },
      );
      return OK;
    });
  }

  async emptyTrash() {
    await this.write(ITEM_STORES, async (tx) => {
      const snap = await readSnapshot(tx);
      await deleteItems(tx, withContents(snap, trashRoots(snap)));
    });
  }

  /**
   * Deletes for good what has been in the Trash for 30 days, with
   * everything inside it.
   */
  async purgeExpiredTrash() {
    const now = this.now();
    await this.write(ITEM_STORES, async (tx) => {
      const snap = await readSnapshot(tx);
      await deleteItems(tx, withContents(snap, expiredTrash(snap, now)));
    });
  }

  /**
   * Deletes images that no drawing has used for a day, resolving with their
   * ids; see {@link deleteUnusedFiles}.
   */
  async collectUnusedFiles() {
    const drawings = await this.read(["drawings"], (tx) =>
      getAll(tx, "drawings"),
    );
    return deleteUnusedFiles(drawings, this.now());
  }

  /**
   * Imports the scene the web app kept before the workspace as a drawing at
   * the root, and its appState's preferences unless there are some already.
   * It runs once per browser, even in several tabs at the same time, and
   * resolves with the new drawing's id, or null when it ran before or the
   * scene was empty.
   */
  async migrateLegacyScene() {
    const at = this.now();
    const migrated = await this.write(
      ["meta", "drawings", "contents", "views"],
      async (tx) => {
        const meta = tx.objectStore("meta");
        // checked and set in one transaction, so racing tabs import it once
        if ((await request(meta.get(LEGACY_MIGRATION_KEY))) !== undefined) {
          return null;
        }
        // read only now, so a migrated scene isn't parsed again
        const legacy = readLegacyScene(at);
        if (legacy.drawing) {
          await putDrawing(tx, legacy.drawing);
        }
        const migration: LegacyMigration = {
          at,
          drawingId: legacy.drawing?.meta.id ?? null,
        };
        await request(meta.put(migration, LEGACY_MIGRATION_KEY));
        return { ...migration, prefs: legacy.prefs };
      },
    );
    if (migrated?.prefs && loadPrefs() === null) {
      savePrefs(migrated.prefs);
    }
    return migrated?.drawingId ?? null;
  }

  /** Closes the database and leaves the channel; the store is done after. */
  close() {
    this.broadcast.close();
    this.db.close();
  }

  private read<T>(
    storeNames: readonly StoreName[],
    fn: (tx: IDBTransaction) => Promise<T>,
  ) {
    return transact(this.db, storeNames, "readonly", fn);
  }

  // commits fn's changes, then shows them and tells the other tabs
  private async write<T>(
    storeNames: readonly StoreName[],
    fn: (tx: IDBTransaction) => Promise<T>,
  ) {
    const result = await transact(this.db, storeNames, "readwrite", fn);
    await this.refresh();
    this.notify();
    this.broadcast.post();
    return result;
  }

  private async refresh() {
    const started = ++this.refreshesStarted;
    const snapshot = await this.read(TREE_STORES, readSnapshot);
    if (started > this.refreshShown) {
      this.refreshShown = started;
      this.snapshot = snapshot;
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
