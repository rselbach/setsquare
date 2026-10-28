import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";

import { STORAGE_KEYS } from "../../app_constants";
import { loadPrefs, savePrefs } from "../../workspace/prefs";

import { workspaceFixture } from "./helpers";

const SAVED_AT = Date.UTC(2026, 8, 15);

const saveLegacyScene = (elements: unknown[], appState: object) => {
  localStorage.setItem(
    STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
    JSON.stringify(elements),
  );
  localStorage.setItem(
    STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
    JSON.stringify(appState),
  );
  localStorage.setItem(
    STORAGE_KEYS.VERSION_DATA_STATE,
    JSON.stringify(SAVED_AT),
  );
};

const saveGreendaleScene = () =>
  saveLegacyScene(
    [
      API.createElement({ type: "rectangle", id: "troy" }),
      API.createElement({
        type: "image",
        id: "abed",
        fileId: "chang" as FileId,
      }),
      API.createElement({ type: "rectangle", id: "pierce", isDeleted: true }),
    ],
    {
      name: "Greendale floor plan",
      viewBackgroundColor: "#fff3bf",
      scrollX: 120,
      zoom: { value: 2 },
      currentItemStrokeColor: "#e03131",
    },
  );

let workspace: ReturnType<typeof workspaceFixture>;

beforeEach(() => {
  workspace = workspaceFixture();
});

afterEach(() => {
  workspace.close();
  localStorage.clear();
});

describe("migrating the legacy scene", () => {
  it("imports it with its images as one drawing at the root", async () => {
    saveGreendaleScene();
    const store = await workspace.open();

    const id = await store.migrateLegacyScene();

    expect([...store.getSnapshot().drawings.keys()]).toEqual([id]);
    const opened = await store.openDrawing(id!);
    expect(opened?.meta).toMatchObject({
      name: "Greendale floor plan",
      folderId: null,
      fileIds: ["chang"],
      createdAt: SAVED_AT,
      updatedAt: SAVED_AT,
    });
    expect(opened?.content.elements.map((element) => element.id)).toEqual([
      "troy",
      "abed",
    ]);
    expect(opened?.content.appState).toMatchObject({
      name: "Greendale floor plan",
      viewBackgroundColor: "#fff3bf",
    });
    expect(opened?.view).toMatchObject({ scrollX: 120, zoom: { value: 2 } });
  });

  it("dates the drawing by its last save", async () => {
    saveGreendaleScene();
    const store = await workspace.open();

    const id = await store.migrateLegacyScene();

    expect(store.getSnapshot().drawings.get(id!)?.openedAt).toBe(SAVED_AT);
  });

  it("dates the drawing now when its last save is unknown", async () => {
    saveGreendaleScene();
    localStorage.setItem(STORAGE_KEYS.VERSION_DATA_STATE, "-1");
    const store = await workspace.open();

    const id = await store.migrateLegacyScene();

    expect(store.getSnapshot().drawings.get(id!)).toMatchObject({
      updatedAt: workspace.clock.now,
      openedAt: workspace.clock.now,
    });
  });

  it("keeps the legacy keys and saves the scene's preferences", async () => {
    saveGreendaleScene();
    const store = await workspace.open();

    await store.migrateLegacyScene();

    for (const key of [
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      STORAGE_KEYS.VERSION_DATA_STATE,
    ]) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
    const prefs = loadPrefs();
    expect(prefs).toMatchObject({ currentItemStrokeColor: "#e03131" });
    expect(prefs).not.toHaveProperty("name");
    expect(prefs).not.toHaveProperty("scrollX");
  });

  it("keeps preferences the browser already has", async () => {
    saveGreendaleScene();
    savePrefs({ currentItemStrokeColor: "#1971c2" });
    const store = await workspace.open();

    await store.migrateLegacyScene();

    expect(loadPrefs()).toEqual({ currentItemStrokeColor: "#1971c2" });
  });

  it("imports once when run twice", async () => {
    saveGreendaleScene();
    const store = await workspace.open();

    const id = await store.migrateLegacyScene();

    expect(await store.migrateLegacyScene()).toBeNull();
    expect([...store.getSnapshot().drawings.keys()]).toEqual([id]);
  });

  it("imports once when two tabs run it at the same time", async () => {
    saveGreendaleScene();
    const troyTab = await workspace.open();
    const abedTab = await workspace.open();

    const ids = await Promise.all([
      troyTab.migrateLegacyScene(),
      abedTab.migrateLegacyScene(),
    ]);

    expect(ids.filter((id) => id !== null)).toHaveLength(1);
    expect(troyTab.getSnapshot().drawings.size).toBe(1);
    expect(abedTab.getSnapshot().drawings.size).toBe(1);
  });

  it("marks an empty scene as migrated without making a drawing", async () => {
    saveLegacyScene(
      [API.createElement({ type: "rectangle", id: "pierce", isDeleted: true })],
      { currentItemStrokeColor: "#e03131" },
    );
    const store = await workspace.open();

    expect(await store.migrateLegacyScene()).toBeNull();
    expect(store.getSnapshot().drawings.size).toBe(0);
    expect(loadPrefs()).toMatchObject({ currentItemStrokeColor: "#e03131" });

    saveGreendaleScene();
    expect(await store.migrateLegacyScene()).toBeNull();
    expect(store.getSnapshot().drawings.size).toBe(0);
  });
});
