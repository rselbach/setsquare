import { serializeAsJSON } from "@setsquare/setsquare/data/json";

import type { SetsquareElement } from "@setsquare/element/types";
import type { Merge } from "@setsquare/common/utility-types";
import type { AppState, BinaryFiles } from "@setsquare/setsquare/types";

import { loadPrefs } from "../workspace/prefs";

import { createImageSync } from "./persistence/imageSync";
import { createRecoveryJournal } from "./persistence/recoveryJournal";
import { checkRemoteChanges } from "./persistence/remoteChanges";
import { createSaveLoop } from "./persistence/saveLoop";
import { createSaveState, openingState } from "./persistence/saveState";
import { createStoredDrawing } from "./persistence/storedDrawing";
import { createThumbnailer } from "./thumbnail";

import type { ScenePersistence } from "../editor/ScenePersistence";
import type { DrawingMeta } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { DrawingSaveState } from "./persistence/saveState";
import type { RecoveredDrawing, UnsavedDrawing } from "./unsavedJournal";

const isQuotaExceeded = (error: unknown) =>
  error instanceof DOMException && error.name === "QuotaExceededError";

/** One drawing's editor session and any changes it still needs to save. */
export type DrawingPersistence = Merge<
  ScenePersistence,
  {
    save(
      elements: readonly SetsquareElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ): void;
    unsaved(): UnsavedDrawing | null;
    renderThumbnail(): Promise<void>;
    getSaveState(): DrawingSaveState;
    subscribeSaveState(listener: () => void): () => void;
    retry(): Promise<void>;
    recoverAsCopy(): Promise<DrawingMeta | null>;
    discard(): Promise<void>;
    hasDurableDraft(): boolean;
    keepRecovery(): void;
    getRecoveryError(): unknown | null;
    isDeviceStorageFull(): boolean;
    exportRecovery(): void;
    /**
     * Keeps other tabs from recovering this session's drafts, as they do
     * from its creation, until every hold it returns is released.
     */
    hold(): () => void;
  }
>;

/**
 * Serializes saves, retaining the exact request until its outcome is known.
 * The save state (`persistence/saveState`) changes only through its
 * transitions; `persistence/storedDrawing` owns what storage has of the
 * drawing, and the save loop (`persistence/saveLoop`) what the editor has.
 */
export const createDrawingPersistence = ({
  store,
  drawing,
  onNotFound,
  ownerWindow,
}: {
  store: WorkspaceStore;
  drawing: RecoveredDrawing;
  onNotFound: () => void;
  ownerWindow: Window;
}): DrawingPersistence => {
  const { id } = drawing.meta;
  const { recovered } = drawing;
  const state = createSaveState(openingState(drawing));
  const journal = createRecoveryJournal({
    store,
    id,
    recovered,
    ownerWindow,
    onChange: state.refresh,
  });
  const images = createImageSync({
    store,
    savedFileIds: drawing.meta.fileIds,
    generation: journal.generation,
    pending: () => loop.pending(),
    onFailure: state.refresh,
  });
  const thumbnailer = createThumbnailer({
    store,
    id,
    scene: () => loop.latest(),
  });
  const stored = createStoredDrawing({ store, drawing, thumbnailer });
  const loop = createSaveLoop({
    store,
    drawing,
    ownerWindow,
    onNotFound,
    state,
    stored,
    journal,
    images,
    thumbnailer,
  });

  const recoveryProblem = () =>
    loop.pending() ? images.error() ?? journal.error() : null;

  return {
    load: async () => ({
      elements: recovered?.elements ?? drawing.content.elements,
      appState: {
        ...loadPrefs(),
        ...drawing.content.appState,
        ...drawing.view,
        ...recovered?.appState,
      },
      scrollToContent: !drawing.view && !recovered,
    }),
    opened: () => {},
    save: loop.edit,
    flush: loop.flush,
    isSavePaused: () => ownerWindow.document.hidden,
    changedElsewhere: async () => {
      await loop.saveWaiting();
      return checkRemoteChanges(store, id, {
        gone: loop.gone,
        revision: stored.revision,
        generation: journal.generation,
        hasPending: () => !!loop.pending(),
        hasRequest: loop.hasRequest,
        conflicted: (meta) => state.dispatch({ type: "conflict", meta }),
        readFailed: (error) => {
          if (loop.pending()) {
            state.dispatch({ type: "failed", kind: "error", error });
          }
        },
        reloaded: stored.reloaded,
      });
    },
    unsaved: loop.unsaved,
    keepRecovery: loop.keepRecovery,
    getSaveState: state.get,
    getRecoveryError: recoveryProblem,
    isDeviceStorageFull: () =>
      isQuotaExceeded(stored.viewError()) || isQuotaExceeded(recoveryProblem()),
    hasDurableDraft: () =>
      !loop.pending() || (images.isStored() && journal.isStored()),
    exportRecovery: () => {
      const scene = loop.pending() ?? loop.latest();
      if (!scene) {
        return;
      }
      const view = ownerWindow.document.defaultView;
      if (!view) {
        return;
      }
      const blob = new view.Blob(
        [serializeAsJSON(scene.elements, scene.appState, scene.files, "local")],
        {
          type: "application/vnd.setsquare+json",
        },
      );
      const url = view.URL.createObjectURL(blob);
      const link = ownerWindow.document.createElement("a");
      link.href = url;
      link.download = `${scene.appState.name || "Setsquare"}.setsquare`;
      link.click();
      ownerWindow.setTimeout(() => view.URL.revokeObjectURL(url), 0);
    },
    subscribeSaveState: state.subscribe,
    retry: loop.retry,
    recoverAsCopy: loop.recoverAsCopy,
    discard: loop.discard,
    hold: journal.hold,
    renderThumbnail: async () => {
      if (!loop.gone() && !loop.pending()) {
        await thumbnailer.renderNow(stored.revision());
      }
    },
    fileStorage: images.fileStorage,
  };
};
