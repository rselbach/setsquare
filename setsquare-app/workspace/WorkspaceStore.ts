import type { FileId } from "@setsquare/element/types";

import type { BinaryFiles } from "@setsquare/setsquare/types";

import type { FileManager } from "../data/FileManager";

import type { SaveOptions } from "./api";

import type {
  ChangeResult,
  AccountDraft,
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
  WorkspaceSnapshot,
} from "./types";

type FileManagerOptions = ConstructorParameters<typeof FileManager>[0];

/** Where a workspace's images are kept, in the shape FileManager takes. */
export interface WorkspaceFiles {
  get: FileManagerOptions["getFiles"];
  save: FileManagerOptions["saveFiles"];
}

/** A drawing to create. */
export interface NewDrawing {
  folderId: ParentId;
  name: string | null;
  /** empty when left out */
  content?: DrawingContent;
  /** the images content shows */
  fileIds?: readonly FileId[];
}

/**
 * One user's folders and drawings, kept in this browser now and on a server
 * once there are accounts. Each call changes one item.
 */
export interface WorkspaceStore {
  /** the account whose recovery drafts this store may read */
  readonly recoveryKey?: string;
  /** the mounted browser's recovery storage, when using accounts */
  readonly recoveryStorage?: Storage;
  /** private recovery records belonging to individual editor sessions */
  readonly recoveryDrafts?: {
    save(draft: AccountDraft): Promise<void>;
    load(id: DrawingId): Promise<AccountDraft[]>;
    remove(draftId: string, generation?: string): Promise<void>;
  };
  /** caches image bytes locally before a network save can begin */
  stageFiles?(files: BinaryFiles): Promise<void>;
  /** every folder and drawing, as of the last change this store saw */
  getSnapshot(): WorkspaceSnapshot;
  /**
   * Calls listener after each change this tab or another commits, view saves
   * aside. Returns a function that stops it.
   */
  subscribe(listener: () => void): () => void;

  createFolder(parentId: ParentId, name: string): Promise<Folder>;
  renameFolder(id: FolderId, name: string): Promise<ChangeResult>;

  createDrawing(drawing: NewDrawing): Promise<DrawingMeta>;
  /** copies the drawing into its folder, or resolves null if it's gone */
  duplicateDrawing(
    id: DrawingId,
    name: string | null,
  ): Promise<DrawingMeta | null>;
  /** renames the drawing and its content, bumping its revision */
  renameDrawing(id: DrawingId, name: string | null): Promise<SaveResult>;

  /** loads the drawing and notes it was opened, or resolves null if it's gone */
  openDrawing(id: DrawingId): Promise<OpenedDrawing | null>;
  getDrawingMeta(id: DrawingId): Promise<DrawingMeta | null>;
  loadDrawingContent(id: DrawingId): Promise<DrawingContent | null>;
  /**
   * Replaces the drawing's content, bumping its revision and updatedAt. The
   * drawing takes its name from the content.
   */
  saveDrawingContent(
    id: DrawingId,
    content: DrawingContent,
    fileIds: readonly FileId[],
    options?: SaveOptions,
  ): Promise<SaveResult>;
  /** saves where this browser left the drawing; not a change to it */
  saveDrawingView(id: DrawingId, view: DrawingView): Promise<ChangeResult>;

  saveThumbnail(id: DrawingId, thumbnail: Thumbnail): Promise<ChangeResult>;
  /** deletes the drawing's thumbnail, such as when nothing's left to show */
  deleteThumbnail(id: DrawingId): Promise<void>;
  /** the thumbnails there are for the drawings, by drawing */
  getThumbnails(ids: readonly DrawingId[]): Promise<Map<DrawingId, Thumbnail>>;

  /** moves the item into target unless canMove refuses */
  move(item: ItemRef, target: ParentId): Promise<MoveResult>;
  /** moves the item to the Trash, its contents with it */
  trash(item: ItemRef): Promise<ChangeResult>;
  /**
   * Takes the item out of the Trash, back into its folder, or into the root
   * if that folder is gone or still trashed.
   */
  restore(item: ItemRef): Promise<ChangeResult>;
  /** deletes the item and everything in it, now and for good */
  deleteForever(item: ItemRef): Promise<ChangeResult>;
  /** deletes everything in the Trash for good */
  emptyTrash(): Promise<void>;

  readonly files: WorkspaceFiles;
}
