import { randomId } from "@setsquare/common";

import type {
  FileId,
  NonDeletedSetsquareElement,
} from "@setsquare/element/types";
import type { AppState, DataURL } from "@setsquare/setsquare/types";

import type { DrawingContentKey, DrawingViewKey } from "./drawingAppState";

/** Identifies a folder. Ids are made in the browser and kept for good. */
export type FolderId = string & { _brand: "FolderId" };

/** Identifies a drawing, as in its `/d/<id>` address. */
export type DrawingId = string & { _brand: "DrawingId" };

/** Where an item sits: a folder, or null for the root of Drawings. */
export type ParentId = FolderId | null;

/** Makes the id of a new folder. */
export const newFolderId = () => randomId() as FolderId;

/** Makes the id of a new drawing. */
export const newDrawingId = () => randomId() as DrawingId;

/** A folder of drawings and other folders. */
export type Folder = Readonly<{
  id: FolderId;
  name: string;
  parentId: ParentId;
  createdAt: number;
  /** when it was created or last renamed */
  updatedAt: number;
  /** when it was moved to the Trash, or null while it isn't there itself */
  trashedAt: number | null;
}>;

/** What the workspace lists about a drawing, without its content. */
export type DrawingMeta = Readonly<{
  id: DrawingId;
  /** null until the drawing is named; shown as "Untitled" */
  name: string | null;
  folderId: ParentId;
  createdAt: number;
  /** when its content, name included, last changed */
  updatedAt: number;
  /** when it was last opened in the editor */
  openedAt: number | null;
  /** when it was moved to the Trash, or null while it isn't there itself */
  trashedAt: number | null;
  /**
   * Bumps on every content change and rename, so other tabs and thumbnails
   * can tell they're behind.
   */
  revision: number;
  /** the images the drawing shows, so unused ones can be deleted */
  fileIds: readonly FileId[];
}>;

/** The metadata of a drawing created at `at`. */
export const newDrawingMeta = (
  {
    name,
    folderId,
    fileIds,
  }: Pick<DrawingMeta, "name" | "folderId" | "fileIds">,
  at: number,
): DrawingMeta => ({
  id: newDrawingId(),
  name,
  folderId,
  createdAt: at,
  updatedAt: at,
  openedAt: null,
  trashedAt: null,
  revision: 1,
  fileIds,
});

/** A folder or a drawing. */
export type WorkspaceItem = Folder | DrawingMeta;

/** The part of appState that belongs to the drawing, whoever views it. */
export type DrawingContentAppState = Pick<AppState, DrawingContentKey>;

/** What a drawing shows: its elements and the appState that goes with them. */
export type DrawingContent = Readonly<{
  /** without deleted elements */
  elements: readonly NonDeletedSetsquareElement[];
  appState: DrawingContentAppState;
}>;

/** Where this browser last looked in a drawing and what it had selected. */
export type DrawingView = Pick<AppState, DrawingViewKey>;

/** A drawing edit kept locally until its server write is acknowledged. */
export type DrawingDraft = {
  id: DrawingId;
  baseRevision: number;
  elements: readonly NonDeletedSetsquareElement[];
  appState: DrawingContentAppState & DrawingView;
  request?: {
    requestId: string;
    baseRevision: number;
    content: DrawingContent;
  };
};

/** One editor session's recovery record, independent of other open tabs. */
export type AccountDraft = DrawingDraft & {
  draftId: string;
  generation: string;
  updatedAt: number;
};

/** A small picture of a drawing, rendered from one of its revisions. */
export type Thumbnail = Readonly<{
  src: DataURL;
  /** the drawing's revision the picture shows */
  revision: number;
}>;

/** Points at a folder or a drawing. */
export type ItemRef =
  | { kind: "folder"; id: FolderId }
  | { kind: "drawing"; id: DrawingId };

/** Every folder and drawing in the workspace, the trashed ones included. */
export type WorkspaceSnapshot = Readonly<{
  folders: ReadonlyMap<FolderId, Folder>;
  drawings: ReadonlyMap<DrawingId, DrawingMeta>;
}>;

// whether two records of the same kind hold the same values, comparing
// arrays such as fileIds by their items
const sameRecord = (a: object, b: object) => {
  const values = b as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) => {
      const other = values[key];
      return (
        Object.is(value, other) ||
        (Array.isArray(value) &&
          Array.isArray(other) &&
          value.length === other.length &&
          value.every((item, index) => Object.is(item, other[index])))
      );
    })
  );
};

// the records by id, keeping each one previous has the same values for, or
// previous itself if every record is the same
const reuseRecords = <K, V extends { id: K }>(
  previous: ReadonlyMap<K, V>,
  records: readonly V[],
): ReadonlyMap<K, V> => {
  let changed = records.length !== previous.size;
  const next = new Map<K, V>();
  for (const record of records) {
    const old = previous.get(record.id);
    const kept = old && sameRecord(old, record) ? old : record;
    changed ||= kept !== old;
    next.set(record.id, kept);
  }
  return changed ? next : previous;
};

/**
 * The snapshot of the folders and drawings, keeping each unchanged record
 * of previous, and previous itself if nothing changed, so what shows them
 * can tell what did.
 */
export const nextSnapshot = (
  previous: WorkspaceSnapshot,
  folders: readonly Folder[],
  drawings: readonly DrawingMeta[],
): WorkspaceSnapshot => {
  const next = {
    folders: reuseRecords(previous.folders, folders),
    drawings: reuseRecords(previous.drawings, drawings),
  };
  return next.folders === previous.folders &&
    next.drawings === previous.drawings
    ? previous
    : next;
};

/** Folders and drawings, apart because folders list first. */
export type WorkspaceItems = {
  folders: Folder[];
  drawings: DrawingMeta[];
};

/** The outcome of changing an item that may no longer exist. */
export type ChangeResult = { ok: true } | { ok: false; reason: "notFound" };

/** Whether an item can move into a folder, and if not, why. */
export type MoveResult =
  | { ok: true }
  | {
      ok: false;
      reason: "notFound" | "intoItself" | "intoDescendant" | "targetTrashed";
    };

/** The drawing as saved, or why it couldn't be. */
export type SaveResult =
  | { ok: true; meta: DrawingMeta }
  | { ok: false; reason: "notFound" }
  | { ok: false; reason: "conflict"; meta: DrawingMeta };

/** A drawing as the editor opens it. */
export type OpenedDrawing = Readonly<{
  meta: DrawingMeta;
  content: DrawingContent;
  /** null until the drawing was viewed in this browser */
  view: DrawingView | null;
}>;
