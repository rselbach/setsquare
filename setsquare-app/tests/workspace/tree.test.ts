import {
  TRASH_RETENTION_MS,
  ancestors,
  canMove,
  childrenOf,
  expiredTrash,
  isTrashed,
  recentDrawings,
  searchItems,
  sortItems,
  subtree,
  trashRoots,
  uniqueName,
} from "../../workspace/tree";

import type {
  DrawingId,
  DrawingMeta,
  Folder,
  FolderId,
  WorkspaceItems,
  WorkspaceSnapshot,
} from "../../workspace/types";

const folder = (
  id: string,
  parentId: string | null,
  rest: Partial<Folder> = {},
): Folder => ({
  id: id as FolderId,
  name: id,
  parentId: parentId as FolderId | null,
  createdAt: 0,
  updatedAt: 0,
  trashedAt: null,
  ...rest,
});

const drawing = (
  id: string,
  folderId: string | null,
  rest: Partial<DrawingMeta> = {},
): DrawingMeta => ({
  id: id as DrawingId,
  name: id,
  folderId: folderId as FolderId | null,
  createdAt: 0,
  updatedAt: 0,
  openedAt: null,
  trashedAt: null,
  revision: 1,
  fileIds: [],
  ...rest,
});

const snapshot = (
  folders: Folder[],
  drawings: DrawingMeta[] = [],
): WorkspaceSnapshot => ({
  folders: new Map(folders.map((each) => [each.id, each])),
  drawings: new Map(drawings.map((each) => [each.id, each])),
});

const folderRef = (id: string) =>
  ({ kind: "folder", id: id as FolderId } as const);
const drawingRef = (id: string) =>
  ({ kind: "drawing", id: id as DrawingId } as const);

const ids = ({ folders, drawings }: WorkspaceItems) => ({
  folders: folders.map((each) => each.id),
  drawings: drawings.map((each) => each.id),
});

// Drawings
// ├ Greendale
// │ ├ Study group
// │ │ └ Floor plan
// │ └ Paintball (trashed)
// │   ├ Blue team
// │   └ Battle map
// ├ Personal
// └ Señor Chang's office
const greendale = () =>
  snapshot(
    [
      folder("greendale", null, { name: "Greendale" }),
      folder("study-group", "greendale", { name: "Study group" }),
      folder("paintball", "greendale", { name: "Paintball", trashedAt: 5 }),
      folder("blue-team", "paintball", { name: "Blue team" }),
      folder("personal", null, { name: "Personal" }),
    ],
    [
      drawing("floor-plan", "study-group", { name: "Floor plan" }),
      drawing("battle-map", "paintball", { name: "Battle map" }),
      drawing("chang", null, { name: "Señor Chang's office" }),
    ],
  );

describe("childrenOf", () => {
  it("lists what's directly in a folder, leaving out the trash", () => {
    const snap = greendale();

    expect(ids(childrenOf(snap, null))).toEqual({
      folders: ["greendale", "personal"],
      drawings: ["chang"],
    });
    expect(ids(childrenOf(snap, "greendale" as FolderId))).toEqual({
      folders: ["study-group"],
      drawings: [],
    });
  });

  it("lists an item whose folder is gone at the root", () => {
    const snap = snapshot([], [drawing("pierce", "gone")]);

    expect(ids(childrenOf(snap, null)).drawings).toEqual(["pierce"]);
  });
});

describe("ancestors", () => {
  it("lists the path from the root down to the folder", () => {
    const snap = greendale();

    expect(ancestors(snap, "study-group" as FolderId).map((f) => f.id)).toEqual(
      ["greendale", "study-group"],
    );
    expect(ancestors(snap, null)).toEqual([]);
  });

  it("stops at a missing parent and at a corrupt cycle", () => {
    const snap = snapshot([
      folder("troy", "abed"),
      folder("abed", "troy"),
      folder("annie", "gone"),
    ]);

    expect(ancestors(snap, "troy" as FolderId).map((f) => f.id)).toEqual([
      "abed",
      "troy",
    ]);
    expect(ancestors(snap, "annie" as FolderId).map((f) => f.id)).toEqual([
      "annie",
    ]);
  });
});

describe("the trash", () => {
  it("holds what is inside a trashed folder", () => {
    const snap = greendale();

    expect(isTrashed(snap, folderRef("paintball"))).toBe(true);
    expect(isTrashed(snap, drawingRef("battle-map"))).toBe(true);
    expect(isTrashed(snap, folderRef("blue-team"))).toBe(true);
    expect(isTrashed(snap, drawingRef("floor-plan"))).toBe(false);
    expect(isTrashed(snap, drawingRef("gone"))).toBe(false);
  });

  it("lists only items that aren't inside a trashed folder", () => {
    const snap = snapshot(
      [folder("paintball", null, { trashedAt: 5 })],
      [
        drawing("battle-map", "paintball", { trashedAt: 3 }),
        drawing("chang", null, { trashedAt: 7 }),
        drawing("floor-plan", null),
      ],
    );

    expect(ids(trashRoots(snap))).toEqual({
      folders: ["paintball"],
      drawings: ["chang"],
    });
  });

  it("expires items trashed 30 days ago or more", () => {
    const now = 100 * TRASH_RETENTION_MS;
    const snap = snapshot(
      [folder("paintball", null, { trashedAt: now - TRASH_RETENTION_MS })],
      [
        drawing("chang", null, { trashedAt: now - TRASH_RETENTION_MS + 1 }),
        drawing("floor-plan", null),
      ],
    );

    expect(ids(expiredTrash(snap, now))).toEqual({
      folders: ["paintball"],
      drawings: [],
    });
  });
});

describe("subtree", () => {
  it("holds a folder and everything inside it, trashed or not", () => {
    expect(ids(subtree(greendale(), "greendale" as FolderId))).toEqual({
      folders: ["greendale", "study-group", "paintball", "blue-team"],
      drawings: ["floor-plan", "battle-map"],
    });
  });

  it("ends on a corrupt cycle", () => {
    const snap = snapshot([folder("troy", "abed"), folder("abed", "troy")]);

    expect(ids(subtree(snap, "troy" as FolderId)).folders).toEqual([
      "troy",
      "abed",
    ]);
  });
});

describe("canMove", () => {
  it("refuses to move a folder into itself or a folder inside it", () => {
    const snap = greendale();

    expect(
      canMove(snap, folderRef("greendale"), "greendale" as FolderId),
    ).toEqual({ ok: false, reason: "intoItself" });
    expect(
      canMove(snap, folderRef("greendale"), "study-group" as FolderId),
    ).toEqual({ ok: false, reason: "intoDescendant" });
  });

  it("refuses to move into the trash", () => {
    const snap = greendale();

    expect(
      canMove(snap, drawingRef("floor-plan"), "paintball" as FolderId),
    ).toEqual({ ok: false, reason: "targetTrashed" });
    expect(
      canMove(snap, drawingRef("floor-plan"), "blue-team" as FolderId),
    ).toEqual({ ok: false, reason: "targetTrashed" });
  });

  it("refuses items and folders that don't exist", () => {
    const snap = greendale();

    expect(canMove(snap, drawingRef("gone"), null)).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(canMove(snap, drawingRef("floor-plan"), "gone" as FolderId)).toEqual(
      { ok: false, reason: "notFound" },
    );
  });

  it("moves into another folder or the root", () => {
    const snap = greendale();

    expect(canMove(snap, folderRef("study-group"), null)).toEqual({ ok: true });
    expect(
      canMove(snap, drawingRef("floor-plan"), "personal" as FolderId),
    ).toEqual({ ok: true });
  });
});

describe("recentDrawings", () => {
  it("lists drawings outside the trash by when they were last used", () => {
    const snap = snapshot(
      [folder("paintball", null, { trashedAt: 1 })],
      [
        drawing("floor-plan", null, { updatedAt: 10, openedAt: 30 }),
        drawing("chang", null, { updatedAt: 20 }),
        drawing("battle-map", "paintball", { updatedAt: 50 }),
      ],
    );

    expect(recentDrawings(snap).map((d) => d.id)).toEqual([
      "floor-plan",
      "chang",
    ]);
    expect(recentDrawings(snap, 1).map((d) => d.id)).toEqual(["floor-plan"]);
  });
});

describe("searchItems", () => {
  it("ignores case and accents", () => {
    const snap = greendale();

    expect(ids(searchItems(snap, "senor chang"))).toEqual({
      folders: [],
      drawings: ["chang"],
    });
    expect(ids(searchItems(snap, "GREEN"))).toEqual({
      folders: ["greendale"],
      drawings: [],
    });
  });

  it("leaves out the trash and finds nothing for an empty query", () => {
    const snap = greendale();

    expect(ids(searchItems(snap, "battle"))).toEqual({
      folders: [],
      drawings: [],
    });
    expect(ids(searchItems(snap, "  "))).toEqual({ folders: [], drawings: [] });
  });
});

describe("sortItems", () => {
  const drawings = [
    drawing("plan-10", null, { name: "Plan 10", updatedAt: 3 }),
    drawing("untitled", null, { name: null, updatedAt: 4 }),
    drawing("plan-2", null, { name: "plan 2", updatedAt: 1 }),
    drawing("abed", null, { name: "Abed's films", updatedAt: 2 }),
  ];

  it("sorts by name, numbers in order and untitled last", () => {
    expect(sortItems(drawings, "name").map((d) => d.id)).toEqual([
      "abed",
      "plan-2",
      "plan-10",
      "untitled",
    ]);
  });

  it("sorts by last edit, newest first", () => {
    expect(sortItems(drawings, "updated").map((d) => d.id)).toEqual([
      "untitled",
      "plan-10",
      "abed",
      "plan-2",
    ]);
  });
});

describe("uniqueName", () => {
  it("numbers a name taken in the same folder", () => {
    const snap = snapshot([
      folder("one", null, { name: "New folder" }),
      folder("two", null, { name: "New folder 2" }),
      folder("trashed", null, { name: "New folder 3", trashedAt: 1 }),
      folder("inside", "one", { name: "Study group" }),
    ]);

    expect(uniqueName(snap, null, "New folder")).toBe("New folder 3");
    expect(uniqueName(snap, "one" as FolderId, "New folder")).toBe(
      "New folder",
    );
  });
});
