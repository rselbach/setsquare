import { arrayToMap } from "@setsquare/common";
import { LinearElementEditor } from "@setsquare/element";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";
import type { DataURL } from "@setsquare/setsquare/types";

import { splitAppState } from "../../workspace/drawingAppState";
import { DatabaseClosedError, openDatabase } from "../../workspace/local/idb";
import { SCHEMA_VERSION } from "../../workspace/local/LocalWorkspaceStore";
import {
  childrenOf,
  isTrashed,
  TRASH_RETENTION_MS,
} from "../../workspace/tree";

import { contentWith, workspaceFixture } from "./helpers";

import type { DrawingView, FolderId } from "../../workspace/types";

const DAY = 24 * 60 * 60 * 1000;

const thumbnailOf = (revision: number) => ({
  src: "data:image/webp;base64,AAAA" as DataURL,
  revision,
});

let workspace: ReturnType<typeof workspaceFixture>;

beforeEach(() => {
  workspace = workspaceFixture();
});

afterEach(() => {
  workspace.close();
});

describe("LocalWorkspaceStore", () => {
  it("closes for a newer build's upgrade, saying so, and refuses later changes", async () => {
    const onVersionChange = vi.fn();
    const store = await workspace.open({ onVersionChange });

    const db = await openDatabase(
      workspace.dbName,
      SCHEMA_VERSION + 1,
      () => {},
    );
    db.close();

    expect(onVersionChange).toHaveBeenCalledTimes(1);
    await expect(
      store.createDrawing({ folderId: null, name: "Pillow fort" }),
    ).rejects.toBeInstanceOf(DatabaseClosedError);
  });

  it("finishes a change already running when a newer build's upgrade closes it", async () => {
    const store = await workspace.open();

    const creating = store.createDrawing({
      folderId: null,
      name: "Pillow fort",
    });
    const db = await openDatabase(
      workspace.dbName,
      SCHEMA_VERSION + 1,
      () => {},
    );
    db.close();

    await expect(creating).resolves.toMatchObject({ name: "Pillow fort" });
  });

  it("stores a JSON-safe view when given a live linear element editor", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({ folderId: null, name: "Arrow" });
    const arrow = API.createElement({ type: "arrow" });
    const view = {
      ...splitAppState(getDefaultAppState()).view,
      selectedElementIds: { [arrow.id]: true as const },
      selectedLinearElement: new LinearElementEditor(
        arrow,
        arrayToMap([arrow]),
      ),
    };

    await store.saveDrawingView(plan.id, view);
    const reopened = await workspace.open();
    const opened = await reopened.openDrawing(plan.id);

    expect(opened?.view).toStrictEqual(JSON.parse(JSON.stringify(view)));
    expect(opened?.view?.selectedElementIds).toEqual({ [arrow.id]: true });
  });

  it("creates, renames and duplicates", async () => {
    const store = await workspace.open();

    const greendale = await store.createFolder(null, "Greendale");
    const plan = await store.createDrawing({
      folderId: greendale.id,
      name: "Floor plan",
      content: contentWith("Floor plan", "troy"),
    });
    expect(store.getSnapshot().folders.get(greendale.id)).toEqual(greendale);
    expect(store.getSnapshot().drawings.get(plan.id)).toEqual(plan);
    expect(plan.revision).toBe(1);

    expect(await store.renameFolder(greendale.id, "Greendale CC")).toEqual({
      ok: true,
    });
    expect(store.getSnapshot().folders.get(greendale.id)?.name).toBe(
      "Greendale CC",
    );

    const renamed = await store.renameDrawing(plan.id, "Seating chart");
    expect(renamed.ok && renamed.meta).toMatchObject({
      name: "Seating chart",
      revision: 2,
    });
    expect((await store.loadDrawingContent(plan.id))?.appState.name).toBe(
      "Seating chart",
    );

    await store.saveThumbnail(plan.id, thumbnailOf(2));
    const copy = await store.duplicateDrawing(plan.id, "Seating chart copy");
    expect(copy).toMatchObject({
      name: "Seating chart copy",
      folderId: greendale.id,
      revision: 1,
    });
    const copied = await store.loadDrawingContent(copy!.id);
    expect(copied?.appState.name).toBe("Seating chart copy");
    expect(copied?.elements.map((element) => element.id)).toEqual(["troy"]);
    expect(await store.getThumbnails([copy!.id])).toEqual(
      new Map([[copy!.id, thumbnailOf(1)]]),
    );
  });

  it("refuses to create in a folder that's gone or in the Trash", async () => {
    const store = await workspace.open();
    const greendale = await store.createFolder(null, "Greendale");
    const studyGroup = await store.createFolder(greendale.id, "Study group");
    await store.trash({ kind: "folder", id: greendale.id });

    for (const parent of [greendale.id, studyGroup.id, "gone" as FolderId]) {
      await expect(
        store.createDrawing({ folderId: parent, name: "Battle map" }),
      ).rejects.toThrow("The destination folder is gone or in the Trash");
      await expect(store.createFolder(parent, "Paintball")).rejects.toThrow(
        "The destination folder is gone or in the Trash",
      );
    }
    expect(store.getSnapshot().drawings.size).toBe(0);
    expect(store.getSnapshot().folders.size).toBe(2);
    expect(await workspace.countRecords()).toMatchObject({
      folders: 2,
      drawings: 0,
      contents: 0,
    });
  });

  it("refuses to rename or duplicate what's gone", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({ folderId: null, name: null });
    await store.deleteForever({ kind: "drawing", id: plan.id });

    expect(await store.renameDrawing(plan.id, "Paintball")).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await store.renameFolder("gone" as FolderId, "Paintball")).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await store.duplicateDrawing(plan.id, null)).toBeNull();
  });

  it("bumps the revision for content but not for the view", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({ folderId: null, name: null });

    workspace.clock.now += 1000;
    const saved = await store.saveDrawingContent(
      plan.id,
      contentWith("Floor plan", "troy", "abed"),
      ["chang" as FileId],
    );
    expect(saved.ok && saved.meta).toMatchObject({
      name: "Floor plan",
      revision: 2,
      updatedAt: workspace.clock.now,
      fileIds: ["chang"],
    });

    const view = { scrollX: 120, scrollY: -40 } as DrawingView;
    workspace.clock.now += 1000;
    expect(await store.saveDrawingView(plan.id, view)).toEqual({ ok: true });
    expect(await store.getDrawingMeta(plan.id)).toEqual(saved.ok && saved.meta);

    workspace.clock.now += 1000;
    const opened = await store.openDrawing(plan.id);
    expect(opened?.view).toEqual(view);
    expect(opened?.content.elements.map((element) => element.id)).toEqual([
      "troy",
      "abed",
    ]);
    expect(opened?.meta).toMatchObject({
      revision: 2,
      openedAt: workspace.clock.now,
    });
  });

  it("names the drawing after its content", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({ folderId: null, name: "Plan" });

    await store.saveDrawingContent(plan.id, contentWith("Study room"), []);
    expect(store.getSnapshot().drawings.get(plan.id)?.name).toBe("Study room");

    await store.saveDrawingContent(plan.id, contentWith(""), []);
    expect(store.getSnapshot().drawings.get(plan.id)?.name).toBeNull();
    expect((await store.loadDrawingContent(plan.id))?.appState.name).toBeNull();
  });

  it("deletes a thumbnail and tells thumbnail subscribers, not snapshot ones", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({ folderId: null, name: "Plan" });
    const seating = await store.createDrawing({ folderId: null, name: null });
    const snapshot = store.getSnapshot();
    const listener = vi.fn();
    const thumbnailListener = vi.fn();
    store.subscribe(listener);
    store.subscribeThumbnails(thumbnailListener);

    await store.saveThumbnail(plan.id, thumbnailOf(1));
    await store.saveThumbnail(seating.id, thumbnailOf(1));
    await store.deleteThumbnail(plan.id);

    expect(listener).not.toHaveBeenCalled();
    expect(thumbnailListener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()).toBe(snapshot);
    expect(await store.getThumbnails([plan.id, seating.id])).toEqual(
      new Map([[seating.id, thumbnailOf(1)]]),
    );
    // one that's gone already is no error
    await store.deleteThumbnail(plan.id);
    expect(store.getSnapshot().drawings.size).toBe(2);
  });

  it("saves nothing for a drawing that's gone", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({ folderId: null, name: null });
    await store.deleteForever({ kind: "drawing", id: plan.id });

    const notFound = { ok: false, reason: "notFound" };
    expect(
      await store.saveDrawingContent(plan.id, contentWith("Plan", "troy"), []),
    ).toEqual(notFound);
    expect(
      await store.saveDrawingView(plan.id, { scrollX: 1 } as DrawingView),
    ).toEqual(notFound);
    expect(await store.saveThumbnail(plan.id, thumbnailOf(1))).toEqual(
      notFound,
    );
    expect(await store.openDrawing(plan.id)).toBeNull();
    expect(await store.loadDrawingContent(plan.id)).toBeNull();
    expect(await workspace.countRecords()).toEqual({
      folders: 0,
      drawings: 0,
      contents: 0,
      views: 0,
      thumbnails: 0,
    });
  });

  it("refuses moves that would loop or hide an item", async () => {
    const store = await workspace.open();
    const greendale = await store.createFolder(null, "Greendale");
    const studyGroup = await store.createFolder(greendale.id, "Study group");
    const paintball = await store.createFolder(null, "Paintball");
    const plan = await store.createDrawing({ folderId: null, name: "Plan" });
    await store.trash({ kind: "folder", id: paintball.id });

    const greendaleRef = { kind: "folder", id: greendale.id } as const;
    const planRef = { kind: "drawing", id: plan.id } as const;
    expect(await store.move(greendaleRef, greendale.id)).toEqual({
      ok: false,
      reason: "intoItself",
    });
    expect(await store.move(greendaleRef, studyGroup.id)).toEqual({
      ok: false,
      reason: "intoDescendant",
    });
    expect(await store.move(planRef, paintball.id)).toEqual({
      ok: false,
      reason: "targetTrashed",
    });
    expect(await store.move(planRef, "gone" as FolderId)).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(store.getSnapshot().folders.get(greendale.id)?.parentId).toBeNull();

    expect(await store.move(planRef, studyGroup.id)).toEqual({ ok: true });
    expect(store.getSnapshot().drawings.get(plan.id)?.folderId).toBe(
      studyGroup.id,
    );
  });

  it("refuses to move a drawing in the trash", async () => {
    const store = await workspace.open();
    const greendale = await store.createFolder(null, "Greendale");
    const plan = await store.createDrawing({ folderId: null, name: "Plan" });
    await store.trash({ kind: "drawing", id: plan.id });

    expect(
      await store.move({ kind: "drawing", id: plan.id }, greendale.id),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(store.getSnapshot().drawings.get(plan.id)?.folderId).toBeNull();
  });

  it("won't let two tabs move two folders into each other", async () => {
    const troyTab = await workspace.open();
    const abedTab = await workspace.open();
    const troy = await troyTab.createFolder(null, "Troy");
    const abed = await troyTab.createFolder(null, "Abed");

    const results = await Promise.all([
      troyTab.move({ kind: "folder", id: troy.id }, abed.id),
      abedTab.move({ kind: "folder", id: abed.id }, troy.id),
    ]);

    expect(results).toEqual([
      { ok: true },
      { ok: false, reason: "intoDescendant" },
    ]);
  });

  it("restores a trashed item into its folder", async () => {
    const store = await workspace.open();
    const greendale = await store.createFolder(null, "Greendale");
    const plan = await store.createDrawing({
      folderId: greendale.id,
      name: "Floor plan",
    });
    const planRef = { kind: "drawing", id: plan.id } as const;

    workspace.clock.now += 1000;
    expect(await store.trash(planRef)).toEqual({ ok: true });
    expect(store.getSnapshot().drawings.get(plan.id)?.trashedAt).toBe(
      workspace.clock.now,
    );
    expect(childrenOf(store.getSnapshot(), greendale.id).drawings).toEqual([]);

    expect(await store.restore(planRef)).toEqual({ ok: true });
    expect(store.getSnapshot().drawings.get(plan.id)).toMatchObject({
      folderId: greendale.id,
      trashedAt: null,
    });
  });

  it("restores into the root when the folder is still trashed or gone", async () => {
    const store = await workspace.open();
    const paintball = await store.createFolder(null, "Paintball");
    const map = await store.createDrawing({
      folderId: paintball.id,
      name: "Battle map",
    });
    const orphan = await store.createDrawing({
      folderId: null,
      name: "Chang's notes",
    });
    await workspace.putRecord("drawings", orphan.id, {
      ...orphan,
      folderId: "gone" as FolderId,
    });
    const mapRef = { kind: "drawing", id: map.id } as const;
    const orphanRef = { kind: "drawing", id: orphan.id } as const;
    await store.trash(mapRef);
    await store.trash({ kind: "folder", id: paintball.id });
    await store.trash(orphanRef);

    await store.restore(mapRef);
    await store.restore(orphanRef);

    const snap = store.getSnapshot();
    expect(snap.drawings.get(map.id)).toMatchObject({
      folderId: null,
      trashedAt: null,
    });
    expect(snap.drawings.get(orphan.id)?.folderId).toBeNull();
    expect(isTrashed(snap, { kind: "folder", id: paintball.id })).toBe(true);
  });

  it("deletes a folder forever with everything in it", async () => {
    const store = await workspace.open();
    const greendale = await store.createFolder(null, "Greendale");
    const studyGroup = await store.createFolder(greendale.id, "Study group");
    const plan = await store.createDrawing({
      folderId: studyGroup.id,
      name: "Floor plan",
    });
    await store.saveDrawingView(plan.id, { scrollX: 1 } as DrawingView);
    await store.saveThumbnail(plan.id, thumbnailOf(1));
    const personal = await store.createDrawing({ folderId: null, name: null });

    await store.deleteForever({ kind: "folder", id: greendale.id });

    expect([...store.getSnapshot().folders.keys()]).toEqual([]);
    expect([...store.getSnapshot().drawings.keys()]).toEqual([personal.id]);
    expect(await workspace.countRecords()).toEqual({
      folders: 0,
      drawings: 1,
      contents: 1,
      views: 0,
      thumbnails: 0,
    });
  });

  it("empties the trash", async () => {
    const store = await workspace.open();
    const paintball = await store.createFolder(null, "Paintball");
    await store.createDrawing({ folderId: paintball.id, name: "Battle map" });
    const chang = await store.createDrawing({ folderId: null, name: "Chang" });
    const plan = await store.createDrawing({ folderId: null, name: "Plan" });
    await store.trash({ kind: "folder", id: paintball.id });
    await store.trash({ kind: "drawing", id: chang.id });

    await store.emptyTrash();

    expect([...store.getSnapshot().folders.keys()]).toEqual([]);
    expect([...store.getSnapshot().drawings.keys()]).toEqual([plan.id]);
    expect(await workspace.countRecords()).toMatchObject({
      drawings: 1,
      contents: 1,
    });
  });

  it("purges what has been in the trash for 30 days", async () => {
    const store = await workspace.open();
    const start = workspace.clock.now;
    const chang = await store.createDrawing({ folderId: null, name: "Chang" });
    const paintball = await store.createFolder(null, "Paintball");
    const map = await store.createDrawing({
      folderId: paintball.id,
      name: "Battle map",
    });
    await store.trash({ kind: "drawing", id: chang.id });
    workspace.clock.now += 10 * DAY;
    await store.trash({ kind: "folder", id: paintball.id });

    workspace.clock.now = start + TRASH_RETENTION_MS;
    await store.purgeExpiredTrash();
    expect(store.getSnapshot().drawings.has(chang.id)).toBe(false);
    expect(store.getSnapshot().drawings.has(map.id)).toBe(true);

    workspace.clock.now += 10 * DAY;
    await store.purgeExpiredTrash();
    expect(store.getSnapshot().folders.size).toBe(0);
    expect(await workspace.countRecords()).toMatchObject({
      drawings: 0,
      contents: 0,
    });
  });

  it("tells subscribers about each change, but not about views", async () => {
    const store = await workspace.open();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const plan = await store.createDrawing({ folderId: null, name: "Plan" });
    expect(listener).toHaveBeenCalledTimes(1);
    await store.saveDrawingView(plan.id, { scrollX: 1 } as DrawingView);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await store.createFolder(null, "Greendale");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps every record a change leaves alone", async () => {
    const store = await workspace.open();
    const greendale = await store.createFolder(null, "Greendale");
    const plan = await store.createDrawing({ folderId: null, name: "Plan" });
    const seating = await store.createDrawing({
      folderId: greendale.id,
      name: "Seating",
      fileIds: ["chang" as FileId],
    });
    const before = store.getSnapshot();

    await store.renameDrawing(plan.id, "Paintball");

    const after = store.getSnapshot();
    expect(after.drawings.get(plan.id)?.name).toBe("Paintball");
    expect(after.drawings.get(seating.id)).toBe(
      before.drawings.get(seating.id),
    );
    expect(after.folders).toBe(before.folders);

    const listener = vi.fn();
    store.subscribe(listener);
    // a write that changes nothing in the snapshot shows nothing new
    expect(await store.trash({ kind: "drawing", id: plan.id })).toEqual({
      ok: true,
    });
    const trashed = store.getSnapshot();
    expect(await store.trash({ kind: "drawing", id: plan.id })).toEqual({
      ok: true,
    });
    expect(store.getSnapshot()).toBe(trashed);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("tells another tab about thumbnails apart from changes", async () => {
    const troyTab = await workspace.open();
    const abedTab = await workspace.open();
    const plan = await troyTab.createDrawing({ folderId: null, name: "Plan" });
    await vi.waitFor(() =>
      expect(abedTab.getSnapshot().drawings.has(plan.id)).toBe(true),
    );
    const listener = vi.fn();
    abedTab.subscribe(listener);
    const thumbnailsChanged = new Promise<void>((resolve) =>
      abedTab.subscribeThumbnails(resolve),
    );

    await troyTab.saveThumbnail(plan.id, thumbnailOf(1));
    await thumbnailsChanged;

    expect(listener).not.toHaveBeenCalled();
    expect(await abedTab.getThumbnails([plan.id])).toEqual(
      new Map([[plan.id, thumbnailOf(1)]]),
    );
  });

  it("tells another tab about changes", async () => {
    const troyTab = await workspace.open();
    const abedTab = await workspace.open();
    const changed = new Promise<void>((resolve) => abedTab.subscribe(resolve));

    const greendale = await troyTab.createFolder(null, "Greendale");
    await changed;

    expect(abedTab.getSnapshot().folders.get(greendale.id)).toEqual(greendale);
  });

  it("reports a committed write when the refresh after it fails", async () => {
    const troyTab = await workspace.open();
    const abedTab = await workspace.open();
    const changed = new Promise<void>((resolve) => abedTab.subscribe(resolve));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const transaction = IDBDatabase.prototype.transaction;
    let failed = false;
    const spy = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementation(function (this: IDBDatabase, storeNames, mode) {
        // the first read is troyTab's refresh, right after its write commits
        if (!failed && mode !== "readwrite") {
          failed = true;
          throw new DOMException("closing", "InvalidStateError");
        }
        return transaction.call(this, storeNames, mode);
      });

    try {
      const greendale = await troyTab.createFolder(null, "Greendale");
      await changed;

      expect(failed).toBe(true);
      expect(abedTab.getSnapshot().folders.get(greendale.id)).toEqual(
        greendale,
      );
      expect(error).toHaveBeenCalledWith(
        "Couldn't refresh after a committed change",
        expect.any(DOMException),
      );
    } finally {
      spy.mockRestore();
      error.mockRestore();
    }
  });
});
