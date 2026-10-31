import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act } from "@setsquare/setsquare/tests/test-utils";

import { navigate } from "../../web/router";
import * as workspaceStore from "../../web/workspaceStore";

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

beforeEach(() => {
  workspace = setUpTestWorkspace();
});
afterEach(() => cleanUpWebApp(workspace));

// opens a drawing on a store whose recovery drafts save as saveDraft does
const openWithRecovery = async (saveDraft: () => Promise<void>) => {
  const store = Object.assign(await workspace.open(), {
    recoveryKey: "troy-barnes",
    recoveryStorage: window.localStorage,
    recoveryDrafts: {
      save: vi.fn(saveDraft),
      load: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  });
  const drawing = await store.createDrawing({
    folderId: null,
    name: "Greendale",
    content: savedContent("Greendale", "troy"),
  });
  vi.mocked(workspaceStore.openWorkspaceStore).mockResolvedValue(store);
  await renderWebAppAt(`/d/${drawing.id}`);
  await waitForDrawing(drawing.id, ["troy"]);
  await waitForAutosave();
  return { store, drawing };
};

const editDrawing = async () => {
  API.updateScene({
    elements: [
      ...h.elements,
      API.createElement({ type: "ellipse", id: "annie" }),
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  await waitForAutosave();
};

it("keeps the canvas mounted when network and local recovery both fail", async () => {
  const { store, drawing } = await openWithRecovery(() =>
    Promise.reject(new Error("IndexedDB full")),
  );
  vi.spyOn(store, "saveDrawingContent").mockRejectedValue(new Error("Offline"));
  vi.spyOn(store.recoveryStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await editDrawing();
  let left: boolean | undefined;
  await act(async () => {
    left = await navigate({ kind: "drawings", folderId: null });
  });
  expect(left).toBe(false);
  expect(window.location.pathname).toBe(`/d/${drawing.id}`);
  expect(elementIds()).toEqual(["troy", "annie"]);
  const closing = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(true);
});

it("leaves a stalled save behind once the recovery draft holds the edit", async () => {
  const { store, drawing } = await openWithRecovery(() => Promise.resolve());
  vi.spyOn(store, "saveDrawingContent").mockReturnValue(new Promise(() => {}));
  await editDrawing();
  const started = Date.now();
  let left: boolean | undefined;
  await act(async () => {
    left = await navigate({ kind: "drawings", folderId: null });
  });
  expect(left).toBe(true);
  expect(Date.now() - started).toBeLessThan(3000);
  expect(window.location.pathname).toBe("/");
  expect(store.recoveryDrafts.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: drawing.id }),
  );
});
