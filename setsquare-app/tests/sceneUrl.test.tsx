import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, render, waitFor } from "@setsquare/setsquare/tests/test-utils";
import { t } from "@setsquare/setsquare/i18n";
import { CaptureUpdateAction } from "@setsquare/setsquare";
import { serializeAsJSON } from "@setsquare/setsquare/data/json";

import SetsquareApp from "../App";
import { STORAGE_KEYS } from "../app_constants";

const { h } = window;

const SCENE_URL = "https://greendale.edu/study-group.setsquare";

const changeHash = (hash: string) => {
  window.history.replaceState({}, "", `/${hash}`);
  act(() => {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
};

describe("#url= links", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    localStorage.clear();
  });

  it("keeps the saved scene when the linked scene fails to load", async () => {
    vi.spyOn(window, "fetch").mockRejectedValue(new TypeError("offline"));
    window.history.replaceState({}, "", `/#url=${SCENE_URL}`);
    const rect = API.createElement({ type: "rectangle", id: "troy" });

    await render(<SetsquareApp />, { localStorageData: { elements: [rect] } });

    expect(h.state.errorMessage).toBe(t("alerts.invalidSceneUrl"));
    expect(h.elements.map((element) => element.id)).toEqual(["troy"]);
    // autosave runs on a 300 ms debounce
    await new Promise((resolve) => setTimeout(resolve, 400));
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!,
    );
    expect(saved.map((element: { id: string }) => element.id)).toEqual([
      "troy",
    ]);
  });

  it("leaves the open scene alone when another hash changes", async () => {
    const fetch = vi.spyOn(window, "fetch");
    await render(<SetsquareApp />);
    const rect = API.createElement({ type: "rectangle", id: "abed" });
    API.updateScene({
      elements: [rect],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const fileHandle = { name: "Greendale.setsquare" } as any;
    act(() => {
      h.setState({ fileHandle });
    });
    const undoSteps = (h.history as any).undoStack.length;

    changeHash("#study-room");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetch).not.toHaveBeenCalled();
    expect(h.state.fileHandle).toBe(fileHandle);
    expect(h.elements.map((element) => element.id)).toEqual(["abed"]);
    expect((h.history as any).undoStack.length).toBe(undoSteps);
  });

  it("loads the linked scene when a #url= hash is opened", async () => {
    const linked = API.createElement({ type: "rectangle", id: "annie" });
    const json = serializeAsJSON([linked], {}, {}, "local");
    vi.spyOn(window, "fetch").mockResolvedValue({
      blob: async () => new Blob([json], { type: "application/json" }),
    } as Response);
    await render(<SetsquareApp />);

    changeHash(`#url=${SCENE_URL}`);

    await waitFor(() =>
      expect(h.elements.map((element) => element.id)).toEqual(["annie"]),
    );
    expect(h.state.isLoading).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("keeps the open scene when a #url= hash fails to load", async () => {
    vi.spyOn(window, "fetch").mockRejectedValue(new TypeError("offline"));
    await render(<SetsquareApp />);
    const rect = API.createElement({ type: "rectangle", id: "britta" });
    API.updateScene({
      elements: [rect],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    changeHash(`#url=${SCENE_URL}`);

    await waitFor(() =>
      expect(h.state.errorMessage).toBe(t("alerts.invalidSceneUrl")),
    );
    expect(h.state.isLoading).toBe(false);
    expect(h.elements.map((element) => element.id)).toEqual(["britta"]);
  });
});
