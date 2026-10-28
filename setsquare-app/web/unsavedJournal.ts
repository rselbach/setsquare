import type { NonDeletedSetsquareElement } from "@setsquare/element/types";

import { STORAGE_KEYS } from "../app_constants";
import { splitAppState } from "../workspace/drawingAppState";

import { imageFileIds } from "./drawingPersistence";

import type {
  DrawingContentAppState,
  DrawingId,
  DrawingView,
  OpenedDrawing,
} from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

/** A drawing's scene as the page left it, before the store had it. */
export type UnsavedDrawing = {
  id: DrawingId;
  /** the revision the scene was edited from */
  baseRevision: number;
  elements: readonly NonDeletedSetsquareElement[];
  appState: DrawingContentAppState & DrawingView;
};

const KEY = STORAGE_KEYS.LOCAL_STORAGE_UNSAVED;

/**
 * Keeps the scene where the next visit finds it. Unlike an IndexedDB write
 * started as the page closes, a localStorage write finishes before it does.
 * There's room for one scene, the last page to close wins.
 */
export const writeUnsaved = (unsaved: UnsavedDrawing) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(unsaved));
  } catch (error) {
    // such as when the scene doesn't fit
    console.error(error);
  }
};

const takeUnsaved = (id: DrawingId) => {
  try {
    const unsaved: Partial<UnsavedDrawing> | null = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    );
    if (unsaved?.id !== id) {
      return null;
    }
    localStorage.removeItem(KEY);
    return Array.isArray(unsaved.elements) ? (unsaved as UnsavedDrawing) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
};

/**
 * Stores the scene a page closed on before saving it, unless the drawing
 * changed since, and drops it either way. Resolves with the drawing to open.
 */
export const replayUnsaved = async (
  store: WorkspaceStore,
  drawing: OpenedDrawing,
): Promise<OpenedDrawing> => {
  const unsaved = takeUnsaved(drawing.meta.id);
  if (!unsaved || unsaved.baseRevision !== drawing.meta.revision) {
    return drawing;
  }
  const { content: appState, view } = splitAppState(unsaved.appState);
  const content = { elements: unsaved.elements, appState };
  const [saved] = await Promise.all([
    store.saveDrawingContent(
      drawing.meta.id,
      content,
      imageFileIds(unsaved.elements),
    ),
    store.saveDrawingView(drawing.meta.id, view),
  ]);
  return saved.ok ? { meta: saved.meta, content, view } : drawing;
};
