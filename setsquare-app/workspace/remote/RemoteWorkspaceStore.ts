import type { FileId } from "@setsquare/element/types";

import type { BinaryFiles } from "@setsquare/setsquare/types";

import { emptyDrawingContent } from "../drawingAppState";
import { newDrawingId, newFolderId } from "../types";

import { AccountCache } from "./AccountCache";
import { ApiError } from "./ApiError";
import { FileSync } from "./fileSync";
import { LocalImport } from "./localImport";
import { parseThumbnails } from "./parse";
import { SnapshotState } from "./snapshot";
import { AccountClient, withIds } from "./transport";

import type { SaveOptions, SessionInfo, WorkspaceCommand } from "../api";
import type { UpgradeEvents } from "../local/idb";
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
} from "../types";
import type {
  NewDrawing,
  WorkspaceFiles,
  WorkspaceStore,
} from "../WorkspaceStore";

type SignedIn = Extract<SessionInfo, { kind: "signedIn" }>;

/** The account and browser used to open a remote workspace. */
export type RemoteWorkspaceOptions = UpgradeEvents & {
  session: SignedIn;
  ownerWindow: Window;
  onSessionExpired: () => void;
  fetch?: typeof fetch;
};

const NOT_FOUND = { ok: false, reason: "notFound" } as const;
const OK = { ok: true } as const;

/** An account's server workspace, with device-local recovery images and views. */
export class RemoteWorkspaceStore implements WorkspaceStore {
  static async open(options: RemoteWorkspaceOptions) {
    const cache = await AccountCache.open(
      options.ownerWindow,
      options.session.user.id,
      options,
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
  readonly recoveryLocks?: LockManager;
  readonly recoveryDrafts: NonNullable<WorkspaceStore["recoveryDrafts"]>;
  readonly files: WorkspaceFiles;
  private readonly client: AccountClient;
  private readonly state: SnapshotState;
  private readonly fileSync: FileSync;
  private readonly localImport: LocalImport;

  private constructor(
    options: RemoteWorkspaceOptions,
    private readonly cache: AccountCache,
  ) {
    const { ownerWindow } = options;
    this.user = options.session.user;
    this.recoveryKey = this.user.id;
    this.recoveryStorage = ownerWindow.localStorage;
    // missing outside secure contexts, and in jsdom
    this.recoveryLocks = ownerWindow.navigator.locks;
    this.recoveryDrafts = {
      save: (draft) => cache.saveDraft(draft),
      load: (id) => cache.loadDrafts(id),
      list: () => cache.listDrafts(),
      remove: (id, notAfter) => cache.removeDraft(id, notAfter),
    };
    this.client = new AccountClient({
      session: options.session,
      fetch: options.fetch ?? ownerWindow.fetch.bind(ownerWindow),
      onSessionExpired: options.onSessionExpired,
    });
    this.state = new SnapshotState(this.client, () =>
      ownerWindow.crypto.randomUUID(),
    );
    this.fileSync = new FileSync(this.client, cache);
    this.localImport = new LocalImport(
      this.state,
      this.fileSync,
      cache,
      ownerWindow,
    );
    this.files = {
      get: (ids) => this.fileSync.get(ids),
      save: (change) => this.fileSync.save(change),
    };
  }

  getSnapshot = () => this.state.getSnapshot();

  subscribe = (listener: () => void) => this.state.subscribe(listener);

  /** Makes image recovery durable before a queued save reaches the network. */
  stageFiles(files: BinaryFiles) {
    return this.fileSync.stage(files);
  }

  async refresh() {
    await this.state.refresh();
    await this.maintainCache();
  }

  close() {
    this.client.close();
    this.state.close();
    this.cache.close();
  }

  async createFolder(parentId: ParentId, name: string) {
    const { result } = await this.state.command({
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
    const { result } = await this.state.command({
      kind: "renameFolder",
      id,
      name,
    });
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
    const command: WorkspaceCommand = {
      kind: "createDrawing",
      id: newDrawingId(),
      folderId,
      name,
      content,
      fileIds,
    };
    const { result } = await this.fileSync.withFiles(fileIds, () =>
      this.state.command(command),
    );
    if (result.kind !== "drawing" || !result.drawing) {
      throw new Error("The server did not create the drawing");
    }
    return result.drawing;
  }

  async duplicateDrawing(sourceId: DrawingId, name: string | null) {
    const { result } = await this.state.command({
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
    const meta = this.state.getSnapshot().drawings.get(id);
    if (!meta) {
      return NOT_FOUND;
    }
    const { result } = await this.state.command({
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
    const drawing = await this.state.readDrawing(
      `/api/drawings/${encodeURIComponent(id)}`,
    );
    if (!drawing) {
      return null;
    }
    const view = await this.cache.getView(id).catch((error) => {
      console.warn("Could not read cached drawing view", id, error);
      return null;
    });
    return { ...drawing, view };
  }

  async getDrawingMeta(id: DrawingId): Promise<DrawingMeta | null> {
    await this.refresh();
    return this.state.getSnapshot().drawings.get(id) ?? null;
  }

  async loadDrawingContent(id: DrawingId): Promise<DrawingContent | null> {
    const drawing = await this.state.readDrawing(
      `/api/drawings/${encodeURIComponent(id)}/content`,
    );
    return drawing?.content ?? null;
  }

  async saveDrawingContent(
    id: DrawingId,
    content: DrawingContent,
    fileIds: readonly FileId[],
    options?: SaveOptions,
  ): Promise<SaveResult> {
    const baseRevision =
      options?.baseRevision ??
      this.state.getSnapshot().drawings.get(id)?.revision;
    if (baseRevision === undefined) {
      return NOT_FOUND;
    }
    const command: WorkspaceCommand = {
      kind: "saveDrawing",
      id,
      content,
      fileIds,
      baseRevision,
    };
    const { result } = await this.fileSync.withFiles(fileIds, () =>
      this.state.command(command, options?.requestId),
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
    if (!this.state.getSnapshot().drawings.has(id)) {
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
      const { result } = await this.state.command({
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
    await this.state.command({ kind: "deleteThumbnail", id });
  }

  async getThumbnails(ids: readonly DrawingId[]) {
    const thumbnails = new Map<DrawingId, Thumbnail>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const entries = parseThumbnails(
        await this.client.get(
          withIds("/api/thumbnails", ids.slice(offset, offset + 100)),
        ),
      );
      for (const [id, thumbnail] of entries) {
        thumbnails.set(id, thumbnail);
      }
    }
    return thumbnails;
  }

  async move(item: ItemRef, target: ParentId) {
    const { result } = await this.state.command({ kind: "move", item, target });
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
    await this.state.command({ kind: "emptyTrash" });
  }

  /** Counts the browser drawings this account has not imported yet. */
  pendingImports(local: LocalWorkspaceStore) {
    return this.localImport.pending(local);
  }

  /**
   * Copies the browser's folders and drawings into the account, skipping
   * what an earlier import copied and drawings the account can't take.
   */
  importLocalWorkspace(local: LocalWorkspaceStore) {
    return this.localImport.run(local);
  }

  /** Drops cached views of drawings the snapshot no longer has. */
  private async maintainCache() {
    try {
      await this.cache.maintain(
        new Set(this.state.getSnapshot().drawings.keys()),
      );
    } catch (error) {
      console.warn("Could not clean up the device cache", error);
    }
  }

  private async change(command: WorkspaceCommand): Promise<ChangeResult> {
    const { result } = await this.state.command(command);
    if (result.kind !== "change") {
      throw new Error("The server returned an invalid change result");
    }
    return result.result;
  }
}
