import { resolvablePromise } from "@setsquare/common";
import { newElementWith } from "@setsquare/element";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";
import type { AppState } from "@setsquare/setsquare/types";

import { createDrawingPersistence } from "../../web/drawingPersistence";
import { ApiError } from "../../workspace/remote/ApiError";
import { workspaceFixture } from "../workspace/helpers";

import { savedContent } from "./helpers";

import type { DrawingContent } from "../../workspace/types";

const appState: AppState = {
  ...getDefaultAppState(),
  width: 800,
  height: 600,
  offsetTop: 0,
  offsetLeft: 0,
  name: "Floor plan",
};

const checkFiles = (content: DrawingContent, fileIds: readonly FileId[]) => {
  const referenced = [
    ...new Set(
      content.elements.flatMap((element) =>
        element.type === "image" && element.fileId ? [element.fileId] : [],
      ),
    ),
  ].sort();
  if (
    JSON.stringify(referenced) !== JSON.stringify([...new Set(fileIds)].sort())
  ) {
    throw new ApiError(400, "invalid_files");
  }
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

const session = async () => {
  const store = Object.assign(await fixture.open(), {
    recoveryKey: fixture.dbName,
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
  const remote = savedContent(appState.name, "remote");
  await store.saveDrawingContent(meta.id, remote, []);
  const create = store.createDrawing.bind(store);
  const save = store.saveDrawingContent.bind(store);
  const creating = vi
    .spyOn(store, "createDrawing")
    .mockImplementation((input) => {
      if (input.content) {
        checkFiles(input.content, input.fileIds ?? []);
      }
      return create(input);
    });
  const saving = vi
    .spyOn(store, "saveDrawingContent")
    .mockImplementation((id, content, fileIds, options) => {
      checkFiles(content, fileIds);
      return save(id, content, fileIds, options);
    });
  return { store, drawing, persistence, creating, saving, remote };
};

it.each([false, true])(
  "copies deleted images without declaring unused files, with a retained reference = %s",
  async (retainedReference) => {
    const { store, drawing, persistence, creating, remote } = await session();
    const fileId = "deleted-image" as FileId;
    const deleted = API.createElement({
      type: "image",
      fileId,
      isDeleted: true,
    });
    const visible = savedContent(appState.name, "local").elements;
    const retained = retainedReference
      ? [API.createElement({ type: "image", fileId, id: "retained" })]
      : [];
    persistence.save([...visible, deleted, ...retained], appState, {}, vi.fn());
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("conflict");

    const copy = await persistence.recoverAsCopy();
    expect(copy).not.toBe(null);
    const fileIds = retainedReference ? [fileId] : [];
    expect(creating.mock.calls[0][0].fileIds).toEqual(fileIds);
    expect(creating.mock.calls[0][0].content?.elements).toEqual([
      ...visible,
      ...retained,
    ]);
    expect(copy?.fileIds).toEqual(fileIds);
    expect(copy && (await store.loadDrawingContent(copy.id))?.elements).toEqual(
      [...visible, ...retained],
    );
    expect(await store.loadDrawingContent(drawing.meta.id)).toEqual(remote);
    expect(persistence.unsaved()).toBe(null);
    expect(persistence.getSaveState().kind).toBe("saved");
  },
);

it("keeps deleting and adding images while the recovered copy is being saved", async () => {
  const { store, drawing, persistence, creating, saving, remote } =
    await session();
  const first = API.createElement({ type: "image", fileId: "first" as FileId });
  const second = API.createElement({
    type: "image",
    fileId: "second" as FileId,
  });
  const visible = savedContent(appState.name, "local").elements;
  persistence.save([...visible, first, second], appState, {}, vi.fn());
  await persistence.flush();
  expect(persistence.getSaveState().kind).toBe("conflict");
  saving.mockClear();

  const create = creating.getMockImplementation()!;
  const creatingStarted = resolvablePromise<void>();
  const releaseCreate = resolvablePromise<void>();
  creating.mockImplementationOnce(async (input) => {
    creatingStarted.resolve();
    await releaseCreate;
    return create(input);
  });
  const save = saving.getMockImplementation()!;
  const savingStarted = resolvablePromise<void>();
  const releaseSave = resolvablePromise<void>();
  saving.mockImplementationOnce(async (...args) => {
    savingStarted.resolve();
    await releaseSave;
    return save(...args);
  });
  const copying = persistence.recoverAsCopy();
  await Promise.race([creatingStarted, copying]);
  const deletedFirst = newElementWith(first, { isDeleted: true });
  persistence.save([...visible, deletedFirst, second], appState, {}, vi.fn());
  releaseCreate.resolve();
  await Promise.race([savingStarted, copying]);
  const third = API.createElement({ type: "image", fileId: "third" as FileId });
  persistence.save(
    [
      ...visible,
      deletedFirst,
      newElementWith(second, { isDeleted: true }),
      third,
    ],
    appState,
    {},
    vi.fn(),
  );
  releaseSave.resolve();
  const copy = await copying;

  expect(creating.mock.calls[0][0].fileIds).toEqual([
    first.fileId,
    second.fileId,
  ]);
  expect(saving.mock.calls.map(([, , fileIds]) => fileIds)).toEqual([
    [second.fileId],
    [third.fileId],
  ]);
  expect(saving.mock.calls.map(([, content]) => content.elements)).toEqual([
    [...visible, second],
    [...visible, third],
  ]);
  expect(copy && (await store.getDrawingMeta(copy.id))?.fileIds).toEqual([
    third.fileId,
  ]);
  expect(copy && (await store.loadDrawingContent(copy.id))?.elements).toEqual([
    ...visible,
    third,
  ]);
  expect(await store.loadDrawingContent(drawing.meta.id)).toEqual(remote);
  expect(persistence.unsaved()).toBe(null);
  expect(persistence.getSaveState().kind).toBe("saved");
});
