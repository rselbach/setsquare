import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";

import type {
  AppState,
  BinaryFileData,
  DataURL,
} from "@setsquare/setsquare/types";

import { createDrawingPersistence } from "../../web/drawingPersistence";
import {
  readAccountRecovery,
  recoverUnavailable,
  replayUnsaved,
} from "../../web/unsavedJournal";
import { AccountCache } from "../../workspace/remote/AccountCache";
import { ImageVersionCollision } from "../../workspace/remote/ApiError";
import { workspaceFixture } from "../workspace/helpers";

import { savedContent } from "./helpers";

import type {
  DrawingContent,
  OpenedDrawing,
  SaveResult,
} from "../../workspace/types";

const appState = (name = "Greendale"): AppState => ({
  ...getDefaultAppState(),
  width: 800,
  height: 600,
  offsetTop: 0,
  offsetLeft: 0,
  name,
});

let fixture: ReturnType<typeof workspaceFixture>;
let caches: AccountCache[];

beforeEach(() => {
  fixture = workspaceFixture();
  caches = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  fixture.close();
  for (const cache of caches) {
    cache.close();
  }
  localStorage.clear();
});

const session = async () => {
  const cache = await AccountCache.open(window, fixture.dbName);
  caches.push(cache);
  const store = Object.assign(await fixture.open(), {
    recoveryKey: fixture.dbName,
    recoveryStorage: window.localStorage,
    recoveryDrafts: {
      save: (draft: Parameters<AccountCache["saveDraft"]>[0]) =>
        cache.saveDraft(draft),
      load: (id: Parameters<AccountCache["loadDrafts"]>[0]) =>
        cache.loadDrafts(id),
      remove: (id: string, generation?: string) =>
        cache.removeDraft(id, generation),
    },
    stageFiles: (files: Record<string, BinaryFileData>) =>
      cache.saveFiles(Object.values(files)),
  });
  const meta = await store.createDrawing({
    folderId: null,
    name: "Greendale",
    content: savedContent("Greendale", "troy"),
  });
  const drawing = await store.openDrawing(meta.id);
  if (!drawing) {
    throw new Error("The test drawing is missing");
  }
  return { store, drawing };
};

const persistenceFor = (
  store: Awaited<ReturnType<typeof session>>["store"],
  drawing: OpenedDrawing,
) =>
  createDrawingPersistence({
    store,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });

it("serializes overlapping saves and commits the newest edit last", async () => {
  const { store, drawing } = await session();
  const original = store.saveDrawingContent.bind(store);
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let maximum = 0;
  const save = vi
    .spyOn(store, "saveDrawingContent")
    .mockImplementation(async (...args) => {
      active++;
      maximum = Math.max(active, maximum);
      if (save.mock.calls.length === 1) {
        await blocked;
      }
      try {
        return await original(...args);
      } finally {
        active--;
      }
    });
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "troy", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  const first = persistence.flush();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  persistence.save(
    savedContent("Greendale", "troy", "abed").elements,
    appState(),
    {},
    vi.fn(),
  );
  const second = persistence.flush();
  expect(save).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, second]);
  expect(maximum).toBe(1);
  expect(
    (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
      ({ id }) => id,
    ),
  ).toEqual(["troy", "abed"]);
  expect(persistence.getSaveState().kind).toBe("saved");
  expect(persistence.unsaved()).toBe(null);
  await persistence.renderThumbnail();
});

it("replays an unacknowledged write before saving a newer draft", async () => {
  const { store, drawing } = await session();
  const original = store.saveDrawingContent.bind(store);
  let receipt: SaveResult | null = null;
  const ids: Array<string | undefined> = [];
  const save = vi
    .spyOn(store, "saveDrawingContent")
    .mockImplementation(async (id, content, files, options) => {
      ids.push(options?.requestId);
      if (ids.length === 2 && receipt) {
        return receipt;
      }
      const result = await original(id, content, files);
      if (ids.length === 1) {
        receipt = result;
        throw new Error("The acknowledgement was lost");
      }
      return result;
    });
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "troy", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(persistence.getSaveState().kind).toBe("error");
  const draft = persistence.unsaved();
  expect(draft?.request?.requestId).toBe(ids[0]);
  persistence.save(
    savedContent("Greendale", "troy", "abed").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.retry();
  expect(save).toHaveBeenCalledTimes(3);
  expect(ids[0]).toBe(ids[1]);
  expect(ids[2]).not.toBe(ids[0]);
  expect((await store.getDrawingMeta(drawing.meta.id))?.revision).toBe(3);
  expect(persistence.getSaveState().kind).toBe("saved");
  await persistence.renderThumbnail();
});

it("resends an unacknowledged write after reload exactly as it was sent", async () => {
  const { store, drawing } = await session();
  const sent: Array<{ content: string; requestId?: string }> = [];
  vi.spyOn(store, "saveDrawingContent").mockImplementation(
    async (_id, content, _files, options) => {
      sent.push({
        content: JSON.stringify(content),
        requestId: options?.requestId,
      });
      throw new Error("The acknowledgement was lost");
    },
  );
  const persistence = persistenceFor(store, drawing);
  const rectangle = API.createElement({ type: "rectangle", id: "britta" });
  expect(rectangle.boundElements).toBe(null);
  persistence.save([rectangle], appState(), {}, vi.fn());
  await persistence.flush();
  expect(persistence.getSaveState().kind).toBe("error");

  const reopened = persistenceFor(store, await replayUnsaved(store, drawing));
  await reopened.flush();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
});

it("keeps a conflicting draft across reload and recovers it as a copy", async () => {
  const { store, drawing } = await session();
  const original = store.saveDrawingContent.bind(store);
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "troy", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  await original(drawing.meta.id, savedContent("Greendale", "abed"), []);
  const newer = await store.openDrawing(drawing.meta.id);
  if (!newer) {
    throw new Error("The updated drawing is missing");
  }
  vi.spyOn(store, "saveDrawingContent").mockResolvedValue({
    ok: false,
    reason: "conflict",
    meta: newer.meta,
  });
  await persistence.flush();
  expect(persistence.getSaveState().kind).toBe("conflict");
  expect((await persistence.changedElsewhere()).scene).toBe(null);
  const recovered = await replayUnsaved(store, newer);
  expect(recovered.recovered?.elements.map(({ id }) => id)).toEqual([
    "troy",
    "annie",
  ]);
  const reopened = persistenceFor(store, recovered);
  expect(reopened.getSaveState().kind).toBe("conflict");
  expect((await reopened.load()).elements?.map(({ id }) => id)).toEqual([
    "troy",
    "annie",
  ]);
  const copy = await reopened.recoverAsCopy();
  expect(copy?.id).not.toBe(drawing.meta.id);
  expect(
    (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
      ({ id }) => id,
    ),
  ).toEqual(["abed"]);
  expect(
    copy &&
      (await store.loadDrawingContent(copy.id))?.elements.map(({ id }) => id),
  ).toEqual(["troy", "annie"]);
  expect((await replayUnsaved(store, newer)).recovered).toBeUndefined();
});

it("does not commit drawing content when its images fail to upload", async () => {
  const { store, drawing } = await session();
  const fileId = "abed-image" as FileId;
  const file: BinaryFileData = {
    id: fileId,
    dataURL: "data:image/png;base64,AAAA" as DataURL,
    mimeType: "image/png",
    created: 1,
  };
  vi.spyOn(store.files, "save").mockResolvedValue({
    savedFiles: new Map(),
    erroredFiles: new Map([[fileId, file]]),
  });
  const save = vi.spyOn(store, "saveDrawingContent");
  const persistence = persistenceFor(store, drawing);
  const image = API.createElement({ type: "image", fileId });
  const content: DrawingContent = {
    ...savedContent("Greendale"),
    elements: [image],
  };
  persistence.save(content.elements, appState(), { [fileId]: file }, vi.fn());
  await persistence.flush();
  expect(save).not.toHaveBeenCalled();
  expect(persistence.unsaved()).not.toBe(null);
  expect(persistence.getSaveState().kind).toBe("error");
});

it("does not read another account's recovery draft", async () => {
  const { store, drawing } = await session();
  vi.spyOn(store, "saveDrawingContent").mockRejectedValue(new Error("Offline"));
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(
    (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
      ({ id }) => id,
    ),
  ).toEqual(["annie"]);
  const cache = await AccountCache.open(window, `${fixture.dbName}-abed`);
  caches.push(cache);
  const other = Object.assign(await fixture.open(), {
    recoveryKey: `${fixture.dbName}-abed`,
    recoveryStorage: window.localStorage,
    recoveryDrafts: {
      save: (draft: Parameters<AccountCache["saveDraft"]>[0]) =>
        cache.saveDraft(draft),
      load: (id: Parameters<AccountCache["loadDrafts"]>[0]) =>
        cache.loadDrafts(id),
      remove: (id: string, generation?: string) =>
        cache.removeDraft(id, generation),
    },
  });
  expect((await replayUnsaved(other, drawing)).recovered).toBeUndefined();
  await persistence.renderThumbnail();
});

it("keeps another tab's draft when this tab finishes a save", async () => {
  const { store, drawing } = await session();
  const first = persistenceFor(store, drawing);
  const second = persistenceFor(store, drawing);
  const save = vi.spyOn(store, "saveDrawingContent");
  save.mockResolvedValueOnce({
    ok: false,
    reason: "conflict",
    meta: drawing.meta,
  });
  first.save(
    savedContent("Greendale", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  await first.flush();
  second.save(
    savedContent("Greendale", "abed").elements,
    appState(),
    {},
    vi.fn(),
  );
  await second.flush();
  const recovered = await readAccountRecovery(store, drawing.meta.id);
  expect(recovered?.elements.map(({ id }) => id)).toEqual(["annie"]);
  await second.renderThumbnail();
});

it("opens a preserved draft after the server drawing is deleted", async () => {
  const { store, drawing } = await session();
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  await store.deleteForever({ kind: "drawing", id: drawing.meta.id });
  await persistence.flush();
  const recovered = await recoverUnavailable(store, drawing.meta.id, "missing");
  expect(recovered?.recovered?.elements.map(({ id }) => id)).toEqual(["annie"]);
  if (!recovered) {
    throw new Error("The deleted drawing's draft is missing");
  }
  const reopened = persistenceFor(store, recovered);
  expect(reopened.getSaveState().kind).toBe("missing");
  const copy = await reopened.recoverAsCopy();
  expect(
    copy &&
      (await store.loadDrawingContent(copy.id))?.elements.map(({ id }) => id),
  ).toEqual(["annie"]);
});

it("includes edits made while a recovered copy is being created", async () => {
  const { store, drawing } = await session();
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  vi.spyOn(store, "saveDrawingContent").mockResolvedValueOnce({
    ok: false,
    reason: "conflict",
    meta: drawing.meta,
  });
  await persistence.flush();
  const create = store.createDrawing.bind(store);
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const creating = vi
    .spyOn(store, "createDrawing")
    .mockImplementation(async (input) => {
      await blocked;
      return create(input);
    });
  const copying = persistence.recoverAsCopy();
  await vi.waitFor(() => expect(creating).toHaveBeenCalledTimes(1));
  persistence.save(
    savedContent("Greendale", "annie", "abed").elements,
    appState(),
    {},
    vi.fn(),
  );
  release();
  const copy = await copying;
  expect(
    copy &&
      (await store.loadDrawingContent(copy.id))?.elements.map(({ id }) => id),
  ).toEqual(["annie", "abed"]);
  expect(persistence.unsaved()).toBe(null);
});

it("keeps recovery in IndexedDB when the synchronous fallback is full", async () => {
  const { store, drawing } = await session();
  vi.spyOn(store.recoveryStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  vi.spyOn(store, "saveDrawingContent").mockRejectedValue(new Error("Offline"));
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(persistence.hasDurableDraft()).toBe(true);
  expect(persistence.getRecoveryError()).toBe(null);
  expect(
    (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
      ({ id }) => id,
    ),
  ).toEqual(["annie"]);
});

it("reports failed local recovery and detects image bytes still being staged", async () => {
  const { store, drawing } = await session();
  vi.spyOn(store.recoveryStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  vi.spyOn(store.recoveryDrafts, "save").mockRejectedValue(
    new Error("IndexedDB full"),
  );
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(store, "stageFiles").mockReturnValue(blocked);
  vi.spyOn(store, "saveDrawingContent").mockRejectedValue(new Error("Offline"));
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  expect(persistence.hasDurableDraft()).toBe(false);
  const saving = persistence.flush();
  release();
  await saving;
  expect(persistence.hasDurableDraft()).toBe(false);
  expect(persistence.getRecoveryError()).not.toBe(null);
});

it("keeps saving newer content when the view write fails", async () => {
  const { store, drawing } = await session();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const save = vi.spyOn(store, "saveDrawingContent");
  vi.spyOn(store, "saveDrawingView").mockRejectedValue(
    new DOMException("Full", "QuotaExceededError"),
  );
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "troy", "annie").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(persistence.getSaveState().kind).toBe("saved");
  expect(persistence.unsaved()).toBe(null);
  expect(warn).toHaveBeenCalled();

  persistence.save(
    savedContent("Greendale", "troy", "abed").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][1].elements.map(({ id }) => id)).toEqual([
    "troy",
    "abed",
  ]);
  expect(persistence.getSaveState().kind).toBe("saved");
  expect(
    (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
      ({ id }) => id,
    ),
  ).toEqual(["troy", "abed"]);
});

it("still saves when staging images for recovery fails", async () => {
  const { store, drawing } = await session();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const staging = vi
    .spyOn(store, "stageFiles")
    .mockRejectedValue(new DOMException("Full", "QuotaExceededError"));
  const save = vi
    .spyOn(store, "saveDrawingContent")
    .mockRejectedValueOnce(new Error("Offline"));
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "troy").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(staging).toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
  expect(persistence.getSaveState().kind).toBe("error");
  expect(persistence.getRecoveryError()).not.toBe(null);
  expect(persistence.hasDurableDraft()).toBe(false);
  expect(warn).toHaveBeenCalled();

  await persistence.retry();
  expect(persistence.getSaveState().kind).toBe("saved");
  expect(persistence.getRecoveryError()).toBe(null);
  expect(persistence.unsaved()).toBe(null);
});

it("still reports an image version collision from staging", async () => {
  const { store, drawing } = await session();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(store, "stageFiles").mockRejectedValue(new ImageVersionCollision());
  const save = vi.spyOn(store, "saveDrawingContent");
  const persistence = persistenceFor(store, drawing);
  persistence.save(
    savedContent("Greendale", "troy").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(save).not.toHaveBeenCalled();
  expect(persistence.getSaveState().kind).toBe("error");
});

it("never pairs old content with the revision of a newer metadata refresh", async () => {
  const { store, drawing } = await session();
  const persistence = persistenceFor(store, drawing);
  await store.saveDrawingContent(
    drawing.meta.id,
    savedContent("Greendale", "annie"),
    [],
  );
  const second = await store.getDrawingMeta(drawing.meta.id);
  if (!second) {
    throw new Error("The second revision is missing");
  }
  const content = await store.loadDrawingContent(drawing.meta.id);
  vi.spyOn(store, "getDrawingMeta").mockResolvedValueOnce(second);
  const original = store.saveDrawingContent.bind(store);
  vi.spyOn(store, "loadDrawingContent").mockImplementationOnce(async () => {
    await original(drawing.meta.id, savedContent("Greendale", "shirley"), []);
    return content;
  });
  const loaded = await persistence.changedElsewhere();
  expect(loaded.scene?.elements.map(({ id }) => id)).toEqual(["annie"]);
  expect(store.getSnapshot().drawings.get(drawing.meta.id)?.revision).toBe(3);
  const save = vi.spyOn(store, "saveDrawingContent");
  persistence.save(
    savedContent("Greendale", "annie", "abed").elements,
    appState(),
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(save.mock.calls[0][3]?.baseRevision).toBe(2);
  expect(persistence.getSaveState().kind).toBe("conflict");
});

it("finishes a recovery copy when metadata refresh reports an unchanged scene", async () => {
  const { store, drawing } = await session();
  const persistence = persistenceFor(store, drawing);
  const content = savedContent("Greendale", "annie");
  persistence.save(content.elements, appState(), {}, vi.fn());
  vi.spyOn(store, "saveDrawingContent").mockResolvedValueOnce({
    ok: false,
    reason: "conflict",
    meta: drawing.meta,
  });
  await persistence.flush();
  const create = store.createDrawing.bind(store);
  vi.spyOn(store, "createDrawing").mockImplementation(async (input) => {
    const copy = await create(input);
    persistence.save(content.elements, appState(), {}, vi.fn());
    return copy;
  });
  const save = vi.mocked(store.saveDrawingContent);
  save.mockClear();
  const copy = await persistence.recoverAsCopy();
  expect(copy).not.toBe(null);
  expect(save).not.toHaveBeenCalled();
  expect(persistence.unsaved()).toBe(null);
});
