import type {
  DrawingMeta,
  Folder,
  FolderId,
  ItemRef,
  MoveResult,
  ParentId,
  WorkspaceItem,
  WorkspaceItems,
  WorkspaceSnapshot,
} from "./types";

/** How long an item stays in the Trash before it's deleted for good. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The item a ref points at, if it still exists. */
export const findItem = (
  snap: WorkspaceSnapshot,
  ref: ItemRef,
): WorkspaceItem | undefined =>
  ref.kind === "folder" ? snap.folders.get(ref.id) : snap.drawings.get(ref.id);

/** The folder an item is in; a folder that no longer exists counts as root. */
export const parentOf = (
  snap: WorkspaceSnapshot,
  item: WorkspaceItem,
): ParentId => {
  const parentId = "parentId" in item ? item.parentId : item.folderId;
  return parentId !== null && snap.folders.has(parentId) ? parentId : null;
};

/** Folders and drawings directly in a folder, leaving out trashed ones. */
export const childrenOf = (
  snap: WorkspaceSnapshot,
  parentId: ParentId,
): WorkspaceItems => {
  const isChild = (item: WorkspaceItem) =>
    item.trashedAt === null && parentOf(snap, item) === parentId;
  return {
    folders: [...snap.folders.values()].filter(isChild),
    drawings: [...snap.drawings.values()].filter(isChild),
  };
};

/**
 * The path from the root down to a folder, the folder included. It stops at
 * a missing parent, and at a folder seen twice so a corrupt cycle can't loop.
 */
export const ancestors = (
  snap: WorkspaceSnapshot,
  folderId: ParentId,
): Folder[] => {
  const path: Folder[] = [];
  const seen = new Set<FolderId>();
  let folder = folderId === null ? undefined : snap.folders.get(folderId);
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    path.unshift(folder);
    folder =
      folder.parentId === null ? undefined : snap.folders.get(folder.parentId);
  }
  return path;
};

const inTrashedFolder = (snap: WorkspaceSnapshot, item: WorkspaceItem) =>
  ancestors(snap, parentOf(snap, item)).some(
    (folder) => folder.trashedAt !== null,
  );

const inTrash = (snap: WorkspaceSnapshot, item: WorkspaceItem) =>
  item.trashedAt !== null || inTrashedFolder(snap, item);

/** Whether an item is in the Trash, itself or inside a trashed folder. */
export const isTrashed = (snap: WorkspaceSnapshot, ref: ItemRef) => {
  const item = findItem(snap, ref);
  return item !== undefined && inTrash(snap, item);
};

/** What the Trash lists: trashed items that aren't inside a trashed folder. */
export const trashRoots = (snap: WorkspaceSnapshot): WorkspaceItems => {
  const isRoot = (item: WorkspaceItem) =>
    item.trashedAt !== null && !inTrashedFolder(snap, item);
  return {
    folders: [...snap.folders.values()].filter(isRoot),
    drawings: [...snap.drawings.values()].filter(isRoot),
  };
};

/** A folder and everything inside it, trashed or not. */
export const subtree = (
  snap: WorkspaceSnapshot,
  folderId: FolderId,
): WorkspaceItems => {
  const ids = new Set<FolderId>(snap.folders.has(folderId) ? [folderId] : []);
  // a Set visits what's added while iterating, and adds each id once
  for (const id of ids) {
    for (const folder of snap.folders.values()) {
      if (folder.parentId === id) {
        ids.add(folder.id);
      }
    }
  }
  return {
    folders: [...snap.folders.values()].filter((folder) => ids.has(folder.id)),
    drawings: [...snap.drawings.values()].filter(
      (drawing) => drawing.folderId !== null && ids.has(drawing.folderId),
    ),
  };
};

/** Whether an item can move into target, a folder or the root. */
export const canMove = (
  snap: WorkspaceSnapshot,
  item: ItemRef,
  target: ParentId,
): MoveResult => {
  if (!findItem(snap, item) || (target !== null && !snap.folders.has(target))) {
    return { ok: false, reason: "notFound" };
  }
  if (item.kind === "folder" && target === item.id) {
    return { ok: false, reason: "intoItself" };
  }
  if (
    item.kind === "folder" &&
    ancestors(snap, target).some((folder) => folder.id === item.id)
  ) {
    return { ok: false, reason: "intoDescendant" };
  }
  if (target !== null && isTrashed(snap, { kind: "folder", id: target })) {
    return { ok: false, reason: "targetTrashed" };
  }
  return { ok: true };
};

const lastUsed = (drawing: DrawingMeta) =>
  Math.max(drawing.openedAt ?? 0, drawing.updatedAt);

/** Drawings outside the Trash, the most recently opened or edited first. */
export const recentDrawings = (
  snap: WorkspaceSnapshot,
  limit = Infinity,
): DrawingMeta[] =>
  [...snap.drawings.values()]
    .filter((drawing) => !inTrash(snap, drawing))
    .sort((a, b) => lastUsed(b) - lastUsed(a))
    .slice(0, limit);

// so "senor" finds "Señor Chang"
const foldName = (name: string) =>
  name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Folders and drawings outside the Trash whose names contain the query,
 * ignoring case and accents. An empty query finds nothing.
 */
export const searchItems = (
  snap: WorkspaceSnapshot,
  query: string,
): WorkspaceItems => {
  const needle = foldName(query.trim());
  const matches = (item: WorkspaceItem) =>
    needle !== "" &&
    item.name !== null &&
    foldName(item.name).includes(needle) &&
    !inTrash(snap, item);
  return {
    folders: [...snap.folders.values()].filter(matches),
    drawings: [...snap.drawings.values()].filter(matches),
  };
};

const COMPARE_ITEMS = {
  updated: (a: WorkspaceItem, b: WorkspaceItem) => b.updatedAt - a.updatedAt,
  name: (a: WorkspaceItem, b: WorkspaceItem) => {
    // untitled drawings go after the named ones
    if (a.name === null || b.name === null) {
      return Number(a.name === null) - Number(b.name === null);
    }
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  },
};

/** How a list of folders or drawings is sorted. */
export type SortOrder = keyof typeof COMPARE_ITEMS;

/** Sorts by last edit, newest first, or by name, with "Plan 2" before "Plan 10". */
export const sortItems = <T extends WorkspaceItem>(
  items: readonly T[],
  order: SortOrder,
): T[] => [...items].sort(COMPARE_ITEMS[order]);

/** base, or base followed by the first number from 2 that isn't taken. */
export const uniqueName = (
  snap: WorkspaceSnapshot,
  parentId: ParentId,
  base: string,
) => {
  const { folders, drawings } = childrenOf(snap, parentId);
  const taken = new Set([...folders, ...drawings].map((item) => item.name));
  let name = base;
  for (let number = 2; taken.has(name); number++) {
    name = `${base} ${number}`;
  }
  return name;
};

/** Items that have been in the Trash themselves for the retention period. */
export const expiredTrash = (
  snap: WorkspaceSnapshot,
  now: number,
): WorkspaceItems => {
  const isExpired = (item: WorkspaceItem) =>
    item.trashedAt !== null && now - item.trashedAt >= TRASH_RETENTION_MS;
  return {
    folders: [...snap.folders.values()].filter(isExpired),
    drawings: [...snap.drawings.values()].filter(isExpired),
  };
};
