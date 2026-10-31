import { resolvablePromise } from "@setsquare/common";
import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, waitFor } from "@setsquare/setsquare/tests/test-utils";
import { screen } from "@testing-library/react";

import * as drawingPersistence from "../../web/drawingPersistence";
import { readAccountRecovery } from "../../web/unsavedJournal";
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

const testEnv = vi.hoisted(() => ({ enabled: true }));

vi.mock("@setsquare/common", async (importOriginal) => {
  const module = await importOriginal<typeof import("@setsquare/common")>();
  const { mockThrottleRAF } =
    await import("@setsquare/setsquare/tests/helpers/mocks");
  return {
    ...module,
    throttleRAF: mockThrottleRAF,
    isTestEnv: () => testEnv.enabled,
  };
});

const { h } = window;
let workspace: ReturnType<typeof setUpTestWorkspace>;

beforeEach(() => {
  workspace = setUpTestWorkspace();
});

afterEach(async () => {
  testEnv.enabled = true;
  await cleanUpWebApp(workspace);
});

it.each([false, true])(
  "keeps an edit made during focus sync when its save has fired = %s",
  async (flushDuringRead) => {
    const store = Object.assign(await workspace.open(), {
      recoveryKey: workspace.dbName,
      recoveryStorage: window.localStorage,
    });
    vi.mocked(workspaceStore.openWorkspaceStore).mockResolvedValue(store);
    const otherTab = await workspace.open();
    const plan = await otherTab.createDrawing({
      folderId: null,
      name: "Floor plan",
      content: savedContent("Floor plan", "original"),
    });
    const create = vi.spyOn(drawingPersistence, "createDrawingPersistence");
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["original"]);
    await waitForAutosave();
    const persistence = create.mock.results[0].value;
    const sync = vi.spyOn(persistence, "changedElsewhere");
    await act(async () => {
      await otherTab.saveDrawingContent(
        plan.id,
        savedContent("Floor plan", "remote"),
        [],
      );
    });
    const read = store.loadDrawingContent.bind(store);
    const started = resolvablePromise<void>();
    const release = resolvablePromise<void>();
    vi.spyOn(store, "loadDrawingContent").mockImplementationOnce(async (id) => {
      const content = await read(id);
      started.resolve();
      await release;
      return content;
    });
    testEnv.enabled = false;
    await act(async () => {
      const ownerWindow = h.app.ownerWindow;
      ownerWindow.dispatchEvent(new ownerWindow.Event("focus"));
      await started;
    });
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "rectangle", id: "local" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    if (flushDuringRead) {
      await act(() => persistence.flush());
      expect(persistence.getSaveState().kind).toBe("conflict");
    }
    await act(async () => {
      release.resolve();
      await sync.mock.results[0].value;
    });
    await waitFor(() => {
      expect(elementIds()).toEqual(["original", "local"]);
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-state",
        "conflict",
      );
    });
    await act(() => persistence.flush());
    expect(
      (await readAccountRecovery(store, plan.id))?.elements.map(({ id }) => id),
    ).toEqual(["original", "local"]);
  },
);
