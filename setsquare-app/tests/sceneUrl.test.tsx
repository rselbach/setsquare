import { API } from "@setsquare/setsquare/tests/helpers/api";
import { render } from "@setsquare/setsquare/tests/test-utils";
import { t } from "@setsquare/setsquare/i18n";

import SetsquareApp from "../App";
import { STORAGE_KEYS } from "../app_constants";

const { h } = window;

const SCENE_URL = "https://greendale.edu/study-group.setsquare";

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
});
