import type { BinaryFileData } from "@setsquare/setsquare/types";

import type {
  ChangeResult,
  DrawingContent,
  DrawingId,
  DrawingMeta,
  Folder,
  FolderId,
  ItemRef,
  MoveResult,
  ParentId,
  SaveResult,
  Thumbnail,
} from "./types";

/** The GitHub identity attached to a Setsquare account. */
export type AccountUser = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string;
};

/** Whether the server offers accounts and who is signed in. */
export type SessionInfo =
  | { kind: "local" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; user: AccountUser; csrfToken: string };

/** A workspace snapshot as JSON, without drawing content. */
export type WorkspaceData = {
  folders: Folder[];
  drawings: DrawingMeta[];
};

/** A saved drawing without this device's view. */
export type DrawingData = { meta: DrawingMeta; content: DrawingContent };

/** The revision a save edits and the identity of an uncertain retry. */
export type SaveOptions = { baseRevision: number; requestId: string };

/** A single account-owned workspace mutation. */
export type WorkspaceCommand =
  | { kind: "createFolder"; id: FolderId; parentId: ParentId; name: string }
  | { kind: "renameFolder"; id: FolderId; name: string }
  | {
      kind: "createDrawing";
      id: DrawingId;
      folderId: ParentId;
      name: string | null;
      content: DrawingContent;
      fileIds: readonly string[];
    }
  | {
      kind: "duplicateDrawing";
      sourceId: DrawingId;
      id: DrawingId;
      name: string | null;
    }
  | {
      kind: "renameDrawing";
      id: DrawingId;
      name: string | null;
      baseRevision: number;
    }
  | {
      kind: "saveDrawing";
      id: DrawingId;
      content: DrawingContent;
      fileIds: readonly string[];
      baseRevision: number;
    }
  | { kind: "saveThumbnail"; id: DrawingId; thumbnail: Thumbnail }
  | { kind: "deleteThumbnail"; id: DrawingId }
  | { kind: "move"; item: ItemRef; target: ParentId }
  | { kind: "trash" | "restore" | "deleteForever"; item: ItemRef }
  | { kind: "emptyTrash" }
  | { kind: "importFolder"; folder: Folder }
  | { kind: "importDrawing"; drawing: DrawingData };

/** A mutation result whose variant identifies its payload. */
export type CommandResult =
  | { kind: "folder"; folder: Folder }
  | { kind: "drawing"; drawing: DrawingMeta | null }
  | { kind: "save"; result: SaveResult }
  | { kind: "change"; result: ChangeResult }
  | { kind: "move"; result: MoveResult }
  | { kind: "done" };

/** A mutation and the new metadata snapshot it committed. */
export type CommandResponse = {
  result: CommandResult;
  snapshot: WorkspaceData;
};

/** Images loaded from or uploaded to the account's private file store. */
export type FilesData = { files: BinaryFileData[] };
