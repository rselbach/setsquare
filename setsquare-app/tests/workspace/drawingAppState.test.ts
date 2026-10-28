import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@setsquare/common";
import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@setsquare/setsquare/appState";
import { restoreAppState } from "@setsquare/setsquare/data/restore";

import type { NormalizedZoomValue } from "@setsquare/setsquare/types";

import { STORAGE_KEYS } from "../../app_constants";
import {
  DRAWING_CONTENT_KEYS,
  DRAWING_VIEW_KEYS,
  splitAppState,
} from "../../workspace/drawingAppState";
import { loadPrefs, savePrefs } from "../../workspace/prefs";

const DRAWING_KEYS = [...DRAWING_CONTENT_KEYS, ...DRAWING_VIEW_KEYS];

const appState = {
  ...getDefaultAppState(),
  name: "Greendale floor plan",
  viewBackgroundColor: "#fff3bf",
  gridModeEnabled: true,
  scrollX: 120,
  scrollY: -40,
  zoom: { value: 2 as NormalizedZoomValue },
  selectedElementIds: { troy: true as const },
  currentItemStrokeColor: "#e03131",
  theme: "dark" as const,
};

describe("splitAppState", () => {
  it("keeps every drawing key that browser storage keeps", () => {
    const stored = clearAppStateForLocalStorage(getDefaultAppState());

    for (const key of DRAWING_KEYS) {
      expect(stored).toHaveProperty(key);
    }
  });

  it("puts content, view and preferences apart", () => {
    const { content, view, prefs } = splitAppState(appState);

    expect(content).toEqual({
      name: "Greendale floor plan",
      viewBackgroundColor: "#fff3bf",
      gridSize: appState.gridSize,
      gridStep: appState.gridStep,
      gridModeEnabled: true,
      lockedMultiSelections: {},
    });
    expect(view).toMatchObject({
      scrollX: 120,
      scrollY: -40,
      zoom: { value: 2 },
      selectedElementIds: { troy: true },
    });
    expect(prefs).toMatchObject({
      currentItemStrokeColor: "#e03131",
      theme: "dark",
    });
    for (const key of DRAWING_KEYS) {
      expect(prefs).not.toHaveProperty(key);
    }
  });

  it("restores to what browser storage would have restored", () => {
    const { content, view, prefs } = splitAppState(appState);
    // prefs go through localStorage, the rest through IndexedDB
    const storedPrefs = JSON.parse(JSON.stringify(prefs));

    expect(
      restoreAppState(
        {
          ...storedPrefs,
          ...structuredClone(content),
          ...structuredClone(view),
        },
        null,
      ),
    ).toEqual(restoreAppState(clearAppStateForLocalStorage(appState), null));
  });

  it("doesn't reopen the search tab", () => {
    const search = splitAppState({
      ...appState,
      openSidebar: { name: DEFAULT_SIDEBAR.name, tab: CANVAS_SEARCH_TAB },
    });
    const library = splitAppState({
      ...appState,
      openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "library" },
    });

    expect(search.prefs.openSidebar).toBeNull();
    expect(library.prefs.openSidebar).toEqual({
      name: DEFAULT_SIDEBAR.name,
      tab: "library",
    });
  });
});

describe("prefs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("loads what it saved", () => {
    const { prefs } = splitAppState(appState);

    expect(savePrefs(prefs)).toBe(true);
    expect(loadPrefs()).toEqual(JSON.parse(JSON.stringify(prefs)));
  });

  it("has none when nothing or nonsense was saved", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadPrefs()).toBeNull();
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_PREFS, "{troy");
    expect(loadPrefs()).toBeNull();
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_PREFS, "[1, 2]");
    expect(loadPrefs()).toBeNull();
  });

  it("leaves out drawing keys someone saved", () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_PREFS,
      JSON.stringify({ scrollX: 5, name: "Paintball", theme: "dark" }),
    );

    expect(loadPrefs()).toEqual({ theme: "dark" });
  });

  it("reports that it couldn't save", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(savePrefs(splitAppState(appState).prefs)).toBe(false);
  });
});
