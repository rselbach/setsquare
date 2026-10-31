import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";
import type { AppState, BinaryFileData } from "@setsquare/setsquare/types";

import { createDrawingPersistence } from "../../web/drawingPersistence";
import { replayUnsaved } from "../../web/unsavedJournal";
import { ApiError } from "../../workspace/remote/ApiError";
import { workspaceFixture } from "../workspace/helpers";

import { savedContent } from "./helpers";

const appState: AppState = {
  ...getDefaultAppState(),
  width: 800,
  height: 600,
  offsetTop: 0,
  offsetLeft: 0,
  name: "Rejection",
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
    name: "Rejection",
    content: savedContent("Rejection", "original"),
  });
  const drawing = (await store.openDrawing(meta.id))!;
  const persistence = createDrawingPersistence({
    store,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });
  return { store, drawing, persistence };
};

it.each([400, 413, 409])(
  "releases a definitively rejected request (%s) and saves corrected edits",
  async (status) => {
    const { store, drawing, persistence } = await session();
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockRejectedValueOnce(
        new ApiError(
          status,
          status === 409 ? "request_reused" : "invalid_request",
        ),
      );
    persistence.save(
      savedContent("Rejection", "too-big").elements,
      appState,
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("rejected");
    expect(persistence.unsaved()?.request).toBeUndefined();
    persistence.save(
      savedContent("Rejection", "corrected").elements,
      appState,
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(save.mock.calls[1][1].elements.map((e) => e.id)).toEqual([
      "corrected",
    ]);
    expect(save.mock.calls[1][3]?.requestId).not.toBe(
      save.mock.calls[0][3]?.requestId,
    );
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(
      (await store.openDrawing(drawing.meta.id))?.content.elements[0].id,
    ).toBe("corrected");
  },
);

it("does not replay refused content after reopening a corrected draft", async () => {
  const { store, drawing, persistence } = await session();
  vi.spyOn(store, "saveDrawingContent").mockRejectedValue(
    new ApiError(400, "invalid_request"),
  );
  persistence.save(
    savedContent("Rejection", "refused").elements,
    appState,
    {},
    vi.fn(),
  );
  await persistence.flush();
  persistence.save(
    savedContent("Rejection", "corrected").elements,
    appState,
    {},
    vi.fn(),
  );
  await persistence.flush();
  const reopened = await replayUnsaved(store, drawing);
  expect(reopened.recovered?.request).toBeUndefined();
  expect(reopened.recovered?.elements.map((e) => e.id)).toEqual(["corrected"]);
});

it.each([0, 408, 429, 500, 503, 409])(
  "retains the exact uncertain request (%s)",
  async (status) => {
    const { store, persistence } = await session();
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockRejectedValueOnce(
        new ApiError(
          status,
          status === 409 ? "concurrent_write" : "unavailable",
        ),
      );
    persistence.save(
      savedContent("Rejection", "first").elements,
      appState,
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("error");
    expect(persistence.unsaved()?.request?.requestId).toBe(
      save.mock.calls[0][3]?.requestId,
    );
    persistence.save(
      savedContent("Rejection", "newest").elements,
      appState,
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(save.mock.calls[2][1].elements[0].id).toBe("newest");
  },
);

it.each([401, 403])(
  "expires rejected authentication (%s) without pinning content",
  async (status) => {
    const { store, persistence } = await session();
    vi.spyOn(store, "saveDrawingContent").mockRejectedValue(
      new ApiError(status, "csrf_failed"),
    );
    persistence.save(
      savedContent("Rejection", "edit").elements,
      appState,
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("expired");
    expect(persistence.unsaved()?.request).toBeUndefined();
  },
);

it("does not pin an upload failure and can save after the image is removed", async () => {
  const { store, drawing, persistence } = await session();
  const fileId = "refused-image" as FileId;
  const file: BinaryFileData = {
    id: fileId,
    dataURL: "data:image/png;base64,AAAA" as BinaryFileData["dataURL"],
    mimeType: "image/png",
    created: 1,
  };
  const upload = vi.spyOn(store.files, "save").mockResolvedValueOnce({
    savedFiles: new Map(),
    erroredFiles: new Map([[fileId, file]]),
  });
  const save = vi.spyOn(store, "saveDrawingContent");
  // The file manager captures the save function when the session opens.
  const editor = createDrawingPersistence({
    store,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });
  editor.save(
    [API.createElement({ type: "image", fileId })],
    appState,
    { [fileId]: file },
    vi.fn(),
  );
  await editor.flush();
  expect(save).not.toHaveBeenCalled();
  expect(editor.unsaved()?.request).toBeUndefined();
  expect(
    (await replayUnsaved(store, drawing)).recovered?.request,
  ).toBeUndefined();
  editor.save(
    savedContent("Rejection", "corrected").elements,
    appState,
    {},
    vi.fn(),
  );
  await editor.flush();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0][1].elements[0].id).toBe("corrected");
  expect(editor.getSaveState().kind).toBe("saved");
  expect(persistence.unsaved()).toBeNull();
});

it("keeps a previously uncertain request through an expired retry", async () => {
  const { store, persistence } = await session();
  const save = vi
    .spyOn(store, "saveDrawingContent")
    .mockRejectedValueOnce(new TypeError("Lost acknowledgement"))
    .mockRejectedValueOnce(new ApiError(403, "csrf_failed"));
  persistence.save(
    savedContent("Rejection", "first").elements,
    appState,
    {},
    vi.fn(),
  );
  await persistence.flush();
  const request = persistence.unsaved()?.request;
  persistence.save(
    savedContent("Rejection", "latest").elements,
    appState,
    {},
    vi.fn(),
  );
  await persistence.flush();
  expect(persistence.getSaveState().kind).toBe("expired");
  expect(persistence.unsaved()?.request).toEqual(request);
  await persistence.retry();
  expect(save.mock.calls[2]).toEqual(save.mock.calls[0]);
  expect(save.mock.calls[3][1].elements[0].id).toBe("latest");
});

it("keeps image rejection reasons and stops retrying a deleted image", async () => {
  const { store, drawing } = await session();
  const fileId = "invalid-svg" as FileId;
  const file: BinaryFileData = {
    id: fileId,
    dataURL: "data:image/svg+xml;base64,AAAA" as BinaryFileData["dataURL"],
    mimeType: "image/svg+xml",
    created: 1,
  };
  const error = new ApiError(400, "invalid_image");
  const upload = vi
    .spyOn(store.files, "save")
    .mockImplementation(async ({ addedFiles }) => ({
      savedFiles: new Map(),
      erroredFiles: addedFiles,
      errors: new Map([[fileId, error]]),
    }));
  const editor = createDrawingPersistence({
    store,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });
  const image = API.createElement({ type: "image", fileId });
  editor.save([image], appState, { [fileId]: file }, vi.fn());
  await editor.flush();
  expect(editor.getSaveState()).toMatchObject({
    kind: "rejected",
    error: { errors: new Map([[fileId, error]]) },
  });
  expect(editor.unsaved()?.request).toBeUndefined();
  editor.save(
    [{ ...image, isDeleted: true }],
    appState,
    { [fileId]: file },
    vi.fn(),
  );
  await editor.flush();
  expect(upload.mock.calls[1][0].addedFiles.size).toBe(0);
  expect(editor.getSaveState().kind).toBe("saved");
});

it("saves content without pinning it when image staging fails", async () => {
  const { store, drawing } = await session();
  const staged = Object.assign(store, {
    stageFiles: vi
      .fn()
      .mockRejectedValueOnce(new Error("Cache unavailable"))
      .mockResolvedValue(undefined),
  });
  const save = vi.spyOn(store, "saveDrawingContent");
  const editor = createDrawingPersistence({
    store: staged,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });
  editor.save(
    savedContent("Rejection", "first").elements,
    appState,
    {},
    vi.fn(),
  );
  await editor.flush();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][1].elements[0].id).toBe("first");
  expect(editor.unsaved()?.request).toBeUndefined();
  editor.save(
    savedContent("Rejection", "corrected").elements,
    appState,
    {},
    vi.fn(),
  );
  await editor.flush();
  expect(save.mock.calls[1][1].elements[0].id).toBe("corrected");
  expect(editor.getSaveState().kind).toBe("saved");
});
