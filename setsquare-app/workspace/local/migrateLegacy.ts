import {
  getNonDeletedElements,
  isInitializedImageElement,
} from "@setsquare/element";
import { getDefaultAppState } from "@setsquare/setsquare/appState";

import { STORAGE_KEYS } from "../../app_constants";
import { importFromLocalStorage } from "../../data/localStorage";
import { splitAppState } from "../drawingAppState";
import { newDrawingMeta } from "../types";

import type { Prefs } from "../drawingAppState";
import type { DrawingContent, DrawingMeta, DrawingView } from "../types";

/** The one scene the web app kept in localStorage before the workspace. */
export interface LegacyScene {
  /** null when the scene had no elements and no name */
  drawing: {
    meta: DrawingMeta;
    content: DrawingContent;
    view: DrawingView;
  } | null;
  /** null when no appState was saved */
  prefs: Prefs | null;
}

// tab sync stamps each save with Date.now(), and resets the stamp to -1
const legacySavedAt = () => {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.VERSION_DATA_STATE) ?? "null",
    );
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null;
  } catch (error) {
    console.error(error);
    return null;
  }
};

/**
 * Reads the legacy scene as a drawing at the root, dated by its last save, or
 * by `now` when that's unknown. Its localStorage keys stay in place as a
 * backup. Its images need nothing: drawings read them from the same store.
 */
export const readLegacyScene = (now: number): LegacyScene => {
  const { elements, appState } = importFromLocalStorage();
  const { content, view, prefs } = splitAppState(
    appState ?? getDefaultAppState(),
  );
  const liveElements = getNonDeletedElements(elements);
  const name = content.name || null;
  const prefsOrNull = appState ? prefs : null;
  if (liveElements.length === 0 && name === null) {
    return { drawing: null, prefs: prefsOrNull };
  }
  const fileIds = new Set(
    liveElements
      .filter(isInitializedImageElement)
      .map((element) => element.fileId),
  );
  const savedAt = legacySavedAt() ?? now;
  return {
    drawing: {
      meta: {
        ...newDrawingMeta(
          { name, folderId: null, fileIds: [...fileIds] },
          savedAt,
        ),
        openedAt: savedAt,
      },
      content: { elements: liveElements, appState: { ...content, name } },
      view,
    },
    prefs: prefsOrNull,
  };
};
