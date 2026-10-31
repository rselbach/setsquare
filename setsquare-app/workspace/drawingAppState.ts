import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@setsquare/setsquare/appState";
import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@setsquare/common";

import type { AppState } from "@setsquare/setsquare/types";

import type {
  DrawingContent,
  DrawingContentAppState,
  DrawingView,
} from "./types";

// checks the keys are appState's while keeping each key's literal type
const appStateKeys = <K extends keyof AppState>(keys: readonly K[]) => keys;

/** The appState keys saved with a drawing's content. */
export const DRAWING_CONTENT_KEYS = appStateKeys([
  "name",
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "lockedMultiSelections",
]);

/** The appState keys saved per drawing as where this browser left it. */
export const DRAWING_VIEW_KEYS = appStateKeys([
  "scrollX",
  "scrollY",
  "zoom",
  "scrolledOutside",
  "selectedElementIds",
  "selectedGroupIds",
  "previousSelectedElementIds",
  "editingGroupId",
  "selectedLinearElement",
]);

export type DrawingContentKey = (typeof DRAWING_CONTENT_KEYS)[number];
export type DrawingViewKey = (typeof DRAWING_VIEW_KEYS)[number];

/**
 * The editor settings that carry across drawings, such as the current tool
 * and stroke color.
 */
export type Prefs = Omit<
  ReturnType<typeof clearAppStateForLocalStorage>,
  DrawingContentKey | DrawingViewKey
>;

const pick = <K extends keyof AppState>(
  appState: Pick<AppState, K>,
  keys: readonly K[],
) =>
  Object.fromEntries(keys.map((key) => [key, appState[key]])) as Pick<
    AppState,
    K
  >;

/**
 * The browser-stored part of appState that isn't a drawing's content or
 * view, so any key the editor adds becomes a preference.
 */
export const toPrefs = (appState: Partial<AppState>): Prefs => {
  const prefs: Partial<AppState> = clearAppStateForLocalStorage(appState);
  for (const key of [...DRAWING_CONTENT_KEYS, ...DRAWING_VIEW_KEYS]) {
    delete prefs[key];
  }
  // like the single scene, don't reopen the search tab: its query isn't in
  // appState, so it would come back empty
  if (
    prefs.openSidebar?.name === DEFAULT_SIDEBAR.name &&
    prefs.openSidebar.tab === CANVAS_SEARCH_TAB
  ) {
    prefs.openSidebar = null;
  }
  return prefs;
};

/** Divides the editor's appState into what each place stores. */
export const splitAppState = (
  appState: Pick<AppState, DrawingContentKey | DrawingViewKey> &
    Partial<AppState>,
): {
  content: DrawingContentAppState;
  view: DrawingView;
  prefs: Prefs;
} => ({
  content: pick(appState, DRAWING_CONTENT_KEYS),
  view: {
    ...pick(appState, DRAWING_VIEW_KEYS),
    // Point editing is transient. Selection is restored from selectedElementIds.
    selectedLinearElement: null,
  },
  prefs: toPrefs(appState),
});

/** The content of a new, empty drawing. */
export const emptyDrawingContent = (name: string | null): DrawingContent => ({
  elements: [],
  appState: { ...pick(getDefaultAppState(), DRAWING_CONTENT_KEYS), name },
});
