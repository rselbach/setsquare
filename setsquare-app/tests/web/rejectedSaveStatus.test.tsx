import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, fireEvent, screen } from "@setsquare/setsquare/tests/test-utils";

import * as workspaceStore from "../../web/workspaceStore";
import { ApiError } from "../../workspace/remote/ApiError";

import {
  cleanUpWebApp,
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
afterEach(async () => {
  vi.useRealTimers();
  await cleanUpWebApp(workspace);
});

it("offers Export and manual Retry for rejection without retrying automatically", async () => {
  const store = Object.assign(await workspace.open(), {
    recoveryKey: "rejected-status",
    recoveryStorage: window.localStorage,
  });
  const drawing = await store.createDrawing({
    folderId: null,
    name: "Rejection",
    content: savedContent("Rejection", "original"),
  });
  vi.mocked(workspaceStore.openWorkspaceStore).mockResolvedValue(store);
  await renderWebAppAt(`/d/${drawing.id}`);
  await waitForDrawing(drawing.id, ["original"]);
  await waitForAutosave();
  const save = vi
    .spyOn(store, "saveDrawingContent")
    .mockRejectedValue(new ApiError(413, "invalid_request"));
  API.updateScene({
    elements: [
      ...h.elements,
      API.createElement({ type: "rectangle", id: "edit" }),
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  await waitForAutosave();
  expect(screen.getByRole("status")).toHaveAttribute("data-state", "rejected");
  expect(screen.getByRole("button", { name: "Export drawing" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(/too large/i);
  vi.useFakeTimers();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("online"));
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });
  expect(save).toHaveBeenCalledTimes(2);
});
