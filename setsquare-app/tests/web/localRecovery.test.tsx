import { CaptureUpdateAction } from "@setsquare/setsquare";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  act,
  fireEvent,
  screen,
  within,
} from "@setsquare/setsquare/tests/test-utils";

import type { FileId } from "@setsquare/element/types";
import type { AppState, BinaryFileData } from "@setsquare/setsquare/types";

import { STORAGE_KEYS } from "../../app_constants";
import { createDrawingPersistence } from "../../web/drawingPersistence";
import { navigate } from "../../web/router";
import { replayUnsaved, writeUnsaved } from "../../web/unsavedJournal";
import * as workspaceStore from "../../web/workspaceStore";
import { splitAppState } from "../../workspace/drawingAppState";

import {
  cleanUpWebApp,
  elementIds,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
} from "./helpers";

const { h } = window;
let workspace: ReturnType<typeof setUpTestWorkspace>;
const failed = () => new DOMException("Connection lost", "UnknownError");
const journals = () =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith(STORAGE_KEYS.LOCAL_STORAGE_UNSAVED))
    .map((k) => JSON.parse(localStorage.getItem(k)!));
const appState: AppState = {
  ...getDefaultAppState(),
  width: 800,
  height: 600,
  offsetTop: 0,
  offsetLeft: 0,
  name: "Local recovery",
};
beforeEach(() => {
  workspace = setUpTestWorkspace();
});
afterEach(() => cleanUpWebApp(workspace));
const setup = async () => {
  const store = await workspace.open();
  const meta = await store.createDrawing({
    folderId: null,
    name: "Local recovery",
    content: savedContent("Local recovery", "original"),
  });
  vi.mocked(workspaceStore.openWorkspaceStore).mockResolvedValue(store);
  const drawing = (await store.openDrawing(meta.id))!;
  return { store, drawing };
};
const edit = () =>
  API.updateScene({
    elements: [
      ...h.elements,
      API.createElement({ type: "rectangle", id: "edit" }),
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

it.each([true, false])(
  "protects local edits during navigation with durable fallback %s",
  async (durable) => {
    const { store, drawing } = await setup();
    await renderWebAppAt(`/d/${drawing.meta.id}`);
    await waitForDrawing(drawing.meta.id, ["original"]);
    await waitForAutosave();
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockRejectedValue(failed());
    if (!durable)
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw failed();
      });
    vi.spyOn(console, "error").mockImplementation(() => {});
    edit();
    await waitForAutosave();
    expect(screen.getByRole("status")).toHaveTextContent(/not saved/i);
    expect(
      within(screen.getByRole("status")).getByRole("button", {
        name: "Export",
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("status")).getByRole("button", { name: "Retry" }),
    ).toBeVisible();
    const closing = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(!durable);
    let left: boolean | undefined;
    await act(async () => {
      left = await navigate({ kind: "drawings", folderId: null });
    });
    expect(left).toBe(durable);
    if (durable) {
      expect(
        journals().some(
          (d) =>
            d.id === drawing.meta.id &&
            d.elements.some((e: { id: string }) => e.id === "edit"),
        ),
      ).toBe(true);
      await act(async () => {
        await navigate({ kind: "drawing", id: drawing.meta.id });
      });
      await waitForDrawing(drawing.meta.id, ["original", "edit"]);
    } else {
      expect(elementIds()).toEqual(["original", "edit"]);
      expect(window.location.pathname).toBe(`/d/${drawing.meta.id}`);
    }
    save.mockRestore();
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("status")).getByRole("button", {
          name: "Retry",
        }),
      );
    });
    expect(
      (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
        (e) => e.id,
      ),
    ).toEqual(["original", "edit"]);
  },
);

it("retains a legacy journal after failed replay and opens its recovered scene", async () => {
  const { store, drawing } = await setup();
  const { content, view } = splitAppState(appState);
  const draft = {
    id: drawing.meta.id,
    baseRevision: drawing.meta.revision,
    elements: savedContent("Local recovery", "recovered").elements,
    appState: { ...content, ...view },
  };
  writeUnsaved(draft);
  vi.spyOn(store, "saveDrawingContent").mockRejectedValue(failed());
  const reopened = await replayUnsaved(store, drawing);
  expect(reopened.recovered?.elements[0].id).toBe("recovered");
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_UNSAVED)!),
  ).toEqual(draft);
  await renderWebAppAt(`/d/${drawing.meta.id}`);
  await waitForDrawing(drawing.meta.id, ["recovered"]);
  await waitForAutosave();
  expect(journals().some((d) => d.elements[0]?.id === "recovered")).toBe(true);
});

it("keeps separate local drafts for separate drawings and the latest edit generation", async () => {
  const { store, drawing } = await setup();
  const meta = await store.createDrawing({ folderId: null, name: "Second" });
  const second = (await store.openDrawing(meta.id))!;
  vi.spyOn(store, "saveDrawingContent").mockRejectedValue(failed());
  const first = createDrawingPersistence({
    store,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });
  const other = createDrawingPersistence({
    store,
    drawing: second,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });
  first.save(
    savedContent("Local recovery", "first").elements,
    appState,
    {},
    vi.fn(),
  );
  await first.flush();
  expect(first.hasDurableDraft()).toBe(true);
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw failed();
    });
  first.save(
    savedContent("Local recovery", "latest").elements,
    appState,
    {},
    vi.fn(),
  );
  await first.flush();
  expect(first.hasDurableDraft()).toBe(false);
  storage.mockRestore();
  await first.retry();
  other.save(savedContent("Second", "second").elements, appState, {}, vi.fn());
  await other.flush();
  expect((await replayUnsaved(store, drawing)).recovered?.elements[0].id).toBe(
    "latest",
  );
  expect((await replayUnsaved(store, second)).recovered?.elements[0].id).toBe(
    "second",
  );
  const account = Object.assign(store, {
    recoveryKey: "another-account",
    recoveryStorage: window.localStorage,
  });
  expect((await replayUnsaved(account, drawing)).recovered).toBeUndefined();
});

it("does not call a text-only fallback durable when new image bytes fail to save", async () => {
  const { store, drawing } = await setup();
  const fileId = "unsaved-local-image" as FileId;
  const file: BinaryFileData = {
    id: fileId,
    dataURL: "data:image/png;base64,AAAA" as BinaryFileData["dataURL"],
    mimeType: "image/png",
    created: 1,
  };
  vi.spyOn(store.files, "save").mockResolvedValue({
    savedFiles: new Map(),
    erroredFiles: new Map([[fileId, file]]),
  });
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
  expect(journals()).toHaveLength(1);
  expect(editor.hasDurableDraft()).toBe(false);
  expect(editor.getRecoveryError()).not.toBeNull();
});
