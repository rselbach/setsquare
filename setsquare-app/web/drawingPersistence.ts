import { debounce } from "@setsquare/common";
import {
  getNonDeletedElements,
  hashElementsVersion,
  isInitializedImageElement,
} from "@setsquare/element";

import type { FileId, SetsquareElement } from "@setsquare/element/types";
import type { AppState, BinaryFiles } from "@setsquare/setsquare/types";

import { appJotaiStore } from "../app-jotai";
import { SAVE_TO_LOCAL_STORAGE_TIMEOUT } from "../app_constants";
import { FileManager } from "../data/FileManager";
import { FileStatusStore } from "../data/fileStatusStore";
import {
  imageSaveFailedAtom,
  localStorageQuotaExceededAtom,
} from "../data/LocalData";
import {
  DRAWING_CONTENT_KEYS,
  DRAWING_VIEW_KEYS,
  splitAppState,
} from "../workspace/drawingAppState";
import { loadPrefs, savePrefs } from "../workspace/prefs";

import { createThumbnailer } from "./thumbnail";

import type { ScenePersistence } from "../editor/ScenePersistence";
import type {
  DrawingContentAppState,
  DrawingView,
  OpenedDrawing,
} from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { ThumbnailScene } from "./thumbnail";
import type { UnsavedDrawing } from "./unsavedJournal";

/** The images the elements show, each once. */
export const imageFileIds = (
  elements: readonly SetsquareElement[],
): FileId[] => [
  ...new Set(
    elements.filter(isInitializedImageElement).map((element) => element.fileId),
  ),
];

// cheap to compare on every save; any edit changes an element's versionNonce
const contentSignature = (
  elements: readonly SetsquareElement[],
  appState: DrawingContentAppState,
) =>
  `${hashElementsVersion(elements)}:${JSON.stringify(
    DRAWING_CONTENT_KEYS.map((key) => appState[key]),
  )}`;

const viewSignature = (view: DrawingView) =>
  JSON.stringify(DRAWING_VIEW_KEYS.map((key) => view[key]));

const isQuotaExceededError = (error: unknown) =>
  error instanceof DOMException && error.name === "QuotaExceededError";

const NOTHING_CHANGED = { scene: null, files: false } as const;

/** One drawing's editor session, which can tell what it hasn't stored. */
export interface DrawingPersistence extends ScenePersistence {
  /** the newest scene it was asked to save that isn't stored yet, if any */
  unsaved(): UnsavedDrawing | null;
  /**
   * Brings the drawing's thumbnail up to what the editor showed last, as
   * when the editor leaves it; call it once saving is done.
   */
  renderThumbnail(): Promise<void>;
}

/**
 * Loads and saves one opened drawing for one editor session. The session
 * only ever writes to that drawing, so opening another takes a new editor
 * with a session of its own. Content and view are written only when they
 * change, and only content writes bump the drawing's revision, after which
 * the drawing's thumbnail renders once the editor is quiet.
 */
export const createDrawingPersistence = ({
  store,
  drawing,
  onNotFound,
}: {
  store: WorkspaceStore;
  drawing: OpenedDrawing;
  /** called once if the drawing is gone when saved, after which saves stop */
  onNotFound: () => void;
}): DrawingPersistence => {
  const { id } = drawing.meta;
  // the revision this tab last stored or loaded
  let lastRevision = drawing.meta.revision;
  // what the store holds, as far as this tab knows; null when unknown
  let storedContent: string | null = contentSignature(
    drawing.content.elements,
    drawing.content.appState,
  );
  let storedView: string | null = drawing.view && viewSignature(drawing.view);
  let gone = false;
  // settles once every write started so far has
  let writing: Promise<unknown> = Promise.resolve();
  // the newest scene given to save, until a write of it finishes
  let pending: {
    elements: readonly SetsquareElement[];
    appState: AppState;
  } | null = null;
  // the scene the editor reported last, for thumbnails rendered after it's
  // gone
  let latest: ThumbnailScene | null = null;
  const thumbnailer = createThumbnailer({ store, id, scene: () => latest });

  const fileStorage = new FileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    getFiles: store.files.get,
    saveFiles: store.files.save,
  });

  const stop = () => {
    if (gone) {
      return;
    }
    gone = true;
    pending = null;
    debouncedSave.cancel();
    thumbnailer.cancel();
    onNotFound();
  };

  const writeScene = async (
    elements: readonly SetsquareElement[],
    appState: AppState,
  ) => {
    const { content, view, prefs } = splitAppState(appState);
    // localStorage, so preferences survive even a write cut short by unload
    savePrefs(prefs);
    const live = getNonDeletedElements(elements);
    const nextContent = contentSignature(live, content);
    const nextView = viewSignature(view);
    const writes: Promise<void>[] = [];
    if (nextContent !== storedContent) {
      storedContent = nextContent;
      writes.push(
        store
          .saveDrawingContent(
            id,
            { elements: live, appState: content },
            imageFileIds(live),
          )
          .then(
            (result) => {
              if (!result.ok) {
                return stop();
              }
              lastRevision = result.meta.revision;
              thumbnailer.schedule(lastRevision);
            },
            (error) => {
              storedContent = null;
              throw error;
            },
          ),
      );
    }
    if (nextView !== storedView) {
      storedView = nextView;
      writes.push(
        store.saveDrawingView(id, view).then(
          (result) => {
            if (!result.ok) {
              stop();
            }
          },
          (error) => {
            storedView = null;
            throw error;
          },
        ),
      );
    }
    await Promise.all(writes);
  };

  const debouncedSave = debounce(
    (
      elements: readonly SetsquareElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      const scene = pending;
      const saving = Promise.all([
        writeScene(elements, appState).then(
          () => {
            if (pending === scene) {
              pending = null;
            }
            if (appJotaiStore.get(localStorageQuotaExceededAtom)) {
              appJotaiStore.set(localStorageQuotaExceededAtom, false);
            }
          },
          (error) => {
            console.error(error);
            if (isQuotaExceededError(error)) {
              appJotaiStore.set(localStorageQuotaExceededAtom, true);
            }
          },
        ),
        fileStorage.saveFiles({ elements, files }).then(({ erroredFiles }) => {
          appJotaiStore.set(imageSaveFailedAtom, erroredFiles.size > 0);
          onFilesSaved();
        }),
      ]);
      writing = Promise.allSettled([writing, saving]);
    },
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  return {
    load: async () => ({
      elements: drawing.content.elements,
      appState: {
        ...loadPrefs(),
        ...drawing.content.appState,
        ...drawing.view,
      },
      // a drawing this browser hasn't viewed opens on its content
      scrollToContent: !drawing.view,
    }),
    // unused images are collected for the whole workspace instead
    opened: () => {},
    save: (elements, appState, files, onFilesSaved) => {
      if (gone) {
        return;
      }
      latest = { elements, appState, files };
      pending = { elements, appState };
      debouncedSave(elements, appState, files, onFilesSaved);
    },
    flush: () => {
      debouncedSave.flush();
      return writing;
    },
    isSavePaused: () => document.hidden,
    changedElsewhere: async () => {
      // this tab's own writes bump the revision too, so let them land first
      await writing;
      const meta = gone ? null : await store.getDrawingMeta(id);
      if (!meta || meta.revision <= lastRevision) {
        return NOTHING_CHANGED;
      }
      const content = await store.loadDrawingContent(id);
      if (!content) {
        return NOTHING_CHANGED;
      }
      lastRevision = meta.revision;
      storedContent = contentSignature(content.elements, content.appState);
      // only the content: this tab keeps its own view and preferences, and
      // another tab may have added images
      return { scene: content, files: true };
    },
    unsaved: () => {
      if (!pending) {
        return null;
      }
      const { content, view } = splitAppState(pending.appState);
      return {
        id,
        baseRevision: lastRevision,
        elements: getNonDeletedElements(pending.elements),
        appState: { ...content, ...view },
      };
    },
    renderThumbnail: async () => {
      if (!gone) {
        await thumbnailer.renderNow(lastRevision);
      }
    },
    fileStorage,
  };
};
