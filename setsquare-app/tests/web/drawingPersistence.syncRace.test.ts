import { resolvablePromise } from "@setsquare/common";
import { getDefaultAppState } from "@setsquare/setsquare/appState";

import type { AppState } from "@setsquare/setsquare/types";

import { createDrawingPersistence } from "../../web/drawingPersistence";
import { readAccountRecovery } from "../../web/unsavedJournal";
import { workspaceFixture } from "../workspace/helpers";

import { savedContent } from "./helpers";

const appState: AppState = {
  ...getDefaultAppState(),
  width: 800,
  height: 600,
  offsetTop: 0,
  offsetLeft: 0,
  name: "Floor plan",
};

let fixture: ReturnType<typeof workspaceFixture>;

beforeEach(() => {
  fixture = workspaceFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
  fixture.close();
  localStorage.clear();
});

const session = async (account = true) => {
  const store = Object.assign(await fixture.open(), {
    recoveryKey: account ? fixture.dbName : undefined,
    recoveryStorage: window.localStorage,
  });
  const meta = await store.createDrawing({
    folderId: null,
    name: appState.name,
    content: savedContent(appState.name, "original"),
  });
  const drawing = await store.openDrawing(meta.id);
  if (!drawing) {
    throw new Error("The test drawing is missing");
  }
  const persistence = createDrawingPersistence({
    store,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });
  return { store, drawing, persistence };
};

const delayNextRead = (
  store: Awaited<ReturnType<typeof session>>["store"],
  method: "getDrawingMeta" | "loadDrawingContent",
) => {
  const started = resolvablePromise<void>();
  const release = resolvablePromise<void>();
  const delay = async <T>(value: T) => {
    started.resolve();
    await release;
    return value;
  };
  if (method === "getDrawingMeta") {
    const read = store.getDrawingMeta.bind(store);
    vi.spyOn(store, method).mockImplementationOnce(async (id) =>
      delay(await read(id)),
    );
  } else {
    const read = store.loadDrawingContent.bind(store);
    vi.spyOn(store, method).mockImplementationOnce(async (id) =>
      delay(await read(id)),
    );
  }
  return { started, release };
};

it.each(["getDrawingMeta", "loadDrawingContent"] as const)(
  "preserves edits during %s and retains their base revision",
  async (method) => {
    const { store, drawing, persistence } = await session();
    const remote = savedContent(appState.name, "remote");
    await store.saveDrawingContent(drawing.meta.id, remote, []);
    const { started, release } = delayNextRead(store, method);

    const syncing = persistence.changedElsewhere();
    await started;
    const local = savedContent(appState.name, "original", "local");
    persistence.save(local.elements, appState, {}, vi.fn());
    release.resolve();
    const changed = await syncing;
    await persistence.flush();

    expect(changed).toEqual({ scene: null, files: false });
    expect(persistence.getSaveState().kind).toBe("conflict");
    expect(persistence.unsaved()).toMatchObject({
      baseRevision: drawing.meta.revision,
      elements: local.elements,
    });
    const recovery = await readAccountRecovery(store, drawing.meta.id);
    expect(recovery?.baseRevision).toBe(drawing.meta.revision);
    expect(recovery?.elements).toEqual(local.elements);
    expect(await store.loadDrawingContent(drawing.meta.id)).toEqual(remote);
  },
);

it("keeps the conflict draft when a save conflicts during the content read", async () => {
  const { store, drawing, persistence } = await session();
  await store.saveDrawingContent(
    drawing.meta.id,
    savedContent(appState.name, "remote"),
    [],
  );
  const { started, release } = delayNextRead(store, "loadDrawingContent");
  const syncing = persistence.changedElsewhere();
  await started;
  const local = savedContent(appState.name, "local");
  persistence.save(local.elements, appState, {}, vi.fn());
  await persistence.flush();
  expect(persistence.getSaveState().kind).toBe("conflict");
  release.resolve();
  const changed = await syncing;
  if (changed.scene) {
    persistence.save(changed.scene.elements, appState, {}, vi.fn());
  }
  await persistence.flush();

  const recovery = await readAccountRecovery(store, drawing.meta.id);
  expect(recovery?.baseRevision).toBe(drawing.meta.revision);
  expect(recovery?.elements).toEqual(local.elements);
  expect(changed).toEqual({ scene: null, files: false });
  expect(persistence.getSaveState().kind).toBe("conflict");
});

it.each(["getDrawingMeta", "loadDrawingContent"] as const)(
  "discards %s after an edit and save complete during the read",
  async (method) => {
    const { store, drawing, persistence } = await session(false);
    const remote = savedContent(appState.name, "remote");
    await store.saveDrawingContent(drawing.meta.id, remote, []);
    const { started, release } = delayNextRead(store, method);
    const syncing = persistence.changedElsewhere();
    await started;
    const local = savedContent(appState.name, "local");
    persistence.save(local.elements, appState, {}, vi.fn());
    await persistence.flush();
    expect(persistence.unsaved()).toBe(null);
    release.resolve();
    const changed = await syncing;

    expect(changed).toEqual({ scene: null, files: false });
    expect(persistence.getSaveState().kind).toBe("saved");
    expect((await persistence.changedElsewhere()).scene).toBe(null);

    const save = vi.spyOn(store, "saveDrawingContent");
    persistence.save(remote.elements, appState, {}, vi.fn());
    await persistence.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(await store.loadDrawingContent(drawing.meta.id)).toEqual(remote);
    await persistence.renderThumbnail();
  },
);

it("ignores newer metadata obtained after a local edit finishes saving", async () => {
  const { store, drawing, persistence } = await session();
  const read = store.getDrawingMeta.bind(store);
  const started = resolvablePromise<void>();
  const release = resolvablePromise<void>();
  vi.spyOn(store, "getDrawingMeta").mockImplementationOnce(async (id) => {
    started.resolve();
    await release;
    return read(id);
  });
  const syncing = persistence.changedElsewhere();
  await started;
  persistence.save(
    savedContent(appState.name, "local").elements,
    appState,
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(persistence.unsaved()).toBe(null);
  const remote = savedContent(appState.name, "remote");
  await store.saveDrawingContent(drawing.meta.id, remote, []);
  release.resolve();
  const changed = await syncing;
  await persistence.renderThumbnail();

  expect(changed).toEqual({ scene: null, files: false });
  expect(persistence.getSaveState().kind).toBe("saved");
  expect((await persistence.changedElsewhere()).scene).toEqual(remote);
});
