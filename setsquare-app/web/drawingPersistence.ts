import { debounce } from "@setsquare/common";
import {
  getNonDeletedElements,
  hashElementsVersion,
  isInitializedImageElement,
} from "@setsquare/element";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { serializeAsJSON } from "@setsquare/setsquare/data/json";
import { t } from "@setsquare/setsquare/i18n";

import type { FileId, SetsquareElement } from "@setsquare/element/types";
import type { Merge } from "@setsquare/common/utility-types";
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
import { ApiError } from "../workspace/remote/ApiError";
import { visibleFolder } from "../workspace/tree";

import { createThumbnailer } from "./thumbnail";
import { clearUnsaved, writeUnsaved } from "./unsavedJournal";

import type { ScenePersistence } from "../editor/ScenePersistence";
import type {
  DrawingContent,
  DrawingContentAppState,
  DrawingMeta,
  DrawingView,
} from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { ThumbnailScene } from "./thumbnail";
import type { RecoveredDrawing, UnsavedDrawing } from "./unsavedJournal";

/** The images the elements show, each once. */
export const imageFileIds = (
  elements: readonly SetsquareElement[],
): FileId[] => [
  ...new Set(
    elements.filter(isInitializedImageElement).map((element) => element.fileId),
  ),
];

const contentSignature = (
  elements: readonly SetsquareElement[],
  appState: DrawingContentAppState,
) =>
  `${JSON.stringify(
    elements.map((element) => element.id),
  )}:${hashElementsVersion(elements)}:${JSON.stringify(
    DRAWING_CONTENT_KEYS.map((key) => appState[key]),
  )}`;

const viewSignature = (view: DrawingView) =>
  JSON.stringify(DRAWING_VIEW_KEYS.map((key) => view[key]));

const NOTHING_CHANGED = { scene: null, files: false } as const;

/** Whether this session's latest edit has reached persistent storage. */
export type DrawingSaveState =
  | { kind: "saved" | "unsaved" | "saving" | "expired" | "missing" }
  | { kind: "error"; error: unknown }
  | { kind: "conflict"; meta: DrawingMeta };

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
    hasDurableDraft(): boolean;
    getRecoveryError(): unknown | null;
    exportRecovery(): void;
  }
>;

type PendingScene = ThumbnailScene & { onFilesSaved: () => void };
type ContentWrite = {
  phase: "content" | "view";
  scene: PendingScene;
  content: DrawingContent;
  signature: string;
  requestId: string;
  baseRevision: number;
};

/** Serializes saves, retaining the exact request until its outcome is known. */
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
  const recovered = drawing.recovered;
  let lastRevision = recovered?.baseRevision ?? drawing.meta.revision;
  let storedContent = contentSignature(
    drawing.content.elements,
    drawing.content.appState,
  );
  let storedView = drawing.view && viewSignature(drawing.view);
  let gone = false;
  let writing = Promise.resolve();
  let queued = 0;
  let recoveryWriting = Promise.resolve();
  let imageStaging = Promise.resolve();
  const draftId = ownerWindow.crypto.randomUUID();
  let generation = ownerWindow.crypto.randomUUID();
  let updatedAt = Date.now();
  let storedGeneration: string | null = null;
  let fallbackGeneration: string | null = null;
  let imagesGeneration: string | null = null;
  let recoveryError: unknown | null = null;
  let imageRecoveryError: unknown | null = null;
  let recoveredSource = recovered && "draftId" in recovered ? recovered : null;
  const listeners = new Set<() => void>();
  let state: DrawingSaveState = drawing.unavailable
    ? { kind: "missing" }
    : recovered
    ? recovered.baseRevision !== drawing.meta.revision && !recovered.request
      ? { kind: "conflict", meta: drawing.meta }
      : { kind: "unsaved" }
    : { kind: "saved" };
  let pending: PendingScene | null = recovered
    ? {
        elements: recovered.elements,
        appState: {
          ...getDefaultAppState(),
          width: 0,
          height: 0,
          offsetTop: 0,
          offsetLeft: 0,
          ...loadPrefs(),
          ...recovered.appState,
        },
        files: {},
        onFilesSaved: () => {},
      }
    : null;
  let latest: ThumbnailScene | null = pending;
  let request: ContentWrite | null =
    recovered?.request && pending
      ? {
          phase: "content",
          scene: {
            ...pending,
            elements: recovered.request.content.elements,
            appState: {
              ...pending.appState,
              ...recovered.request.content.appState,
            },
          },
          content: recovered.request.content,
          signature: contentSignature(
            recovered.request.content.elements,
            recovered.request.content.appState,
          ),
          requestId: recovered.request.requestId,
          baseRevision: recovered.request.baseRevision,
        }
      : null;
  const thumbnailer = createThumbnailer({ store, id, scene: () => latest });
  const fileStorage = new FileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    getFiles: store.files.get,
    saveFiles: store.files.save,
  });

  const publish = (next: DrawingSaveState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const unsaved = (): UnsavedDrawing | null => {
    if (!pending) {
      return null;
    }
    const { content, view } = splitAppState(pending.appState);
    return {
      id,
      baseRevision: lastRevision,
      elements: getNonDeletedElements(pending.elements),
      appState: { ...content, ...view },
      ...(store.recoveryKey && { draftId, generation, updatedAt }),
      ...(request &&
        request.phase === "content" && {
          request: {
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            content: request.content,
          },
        }),
    };
  };

  const keepRecovery = () => {
    if (!store.recoveryKey) {
      return;
    }
    const draft = unsaved();
    if (draft && "draftId" in draft) {
      const fallbackSaved = writeUnsaved(
        draft,
        store.recoveryKey,
        store.recoveryStorage,
      );
      if (fallbackSaved) {
        fallbackGeneration = draft.generation;
      }
      recoveryWriting = recoveryWriting.then(async () => {
        try {
          if (store.recoveryDrafts) {
            await store.recoveryDrafts.save(draft);
            storedGeneration = draft.generation;
          } else if (!fallbackSaved) {
            throw new Error("The browser could not keep a recovery copy");
          }
          recoveryError = null;
        } catch (error) {
          if (!fallbackSaved) {
            recoveryError = error;
          }
        }
        publish({ ...state });
      });
    } else {
      clearUnsaved(id, store.recoveryKey, store.recoveryStorage, draftId);
      const source = recoveredSource;
      recoveredSource = null;
      recoveryWriting = recoveryWriting
        .then(async () => {
          await store.recoveryDrafts?.remove(draftId);
          if (source) {
            await store.recoveryDrafts?.remove(
              source.draftId,
              source.generation,
            );
            clearUnsaved(
              id,
              store.recoveryKey,
              store.recoveryStorage,
              source.draftId,
              source.generation,
            );
          }
        })
        .catch((error) =>
          console.warn("Could not remove completed recovery", error),
        );
    }
  };

  const notFound = () => {
    if (store.recoveryKey && pending) {
      request = null;
      publish({ kind: "missing" });
      keepRecovery();
      return;
    }
    gone = true;
    pending = null;
    debouncedSave.cancel();
    thumbnailer.cancel();
    onNotFound();
  };

  const saveImages = async (scene: PendingScene) => {
    const { erroredFiles } = await fileStorage.saveFiles(scene);
    appJotaiStore.set(imageSaveFailedAtom, erroredFiles.size > 0);
    if (erroredFiles.size) {
      throw new Error("The drawing's images could not be saved");
    }
    scene.onFilesSaved();
  };

  const stageImages = (files: BinaryFiles) => {
    const stagingGeneration = generation;
    imageStaging = (store.stageFiles?.(files) ?? Promise.resolve()).then(
      () => {
        imagesGeneration = stagingGeneration;
        if (generation === stagingGeneration) {
          imageRecoveryError = null;
        }
      },
      (error) => {
        if (generation === stagingGeneration) {
          imageRecoveryError = error;
        }
        publish({ ...state });
        throw error;
      },
    );
    imageStaging.catch(() => {});
  };

  const drain = async () => {
    while (
      pending &&
      !gone &&
      state.kind !== "conflict" &&
      state.kind !== "missing"
    ) {
      const scene = request?.scene ?? pending;
      const { content, view, prefs } = splitAppState(scene.appState);
      savePrefs(prefs);
      request ??= {
        phase:
          contentSignature(getNonDeletedElements(scene.elements), content) !==
          storedContent
            ? "content"
            : "view",
        scene,
        content: {
          elements: getNonDeletedElements(scene.elements),
          appState: content,
        },
        signature: contentSignature(
          getNonDeletedElements(scene.elements),
          content,
        ),
        baseRevision: lastRevision,
        requestId: ownerWindow.crypto.randomUUID(),
      };
      publish({ kind: "saving" });
      keepRecovery();
      await recoveryWriting;
      await imageStaging;
      await saveImages(scene);
      if (request.phase === "content") {
        const saved = await store.saveDrawingContent(
          id,
          request.content,
          imageFileIds(request.content.elements),
          store.recoveryKey
            ? {
                baseRevision: request.baseRevision,
                requestId: request.requestId,
              }
            : undefined,
        );
        if (!saved.ok) {
          if (saved.reason === "notFound") {
            notFound();
            return;
          }
          request = null;
          publish({ kind: "conflict", meta: saved.meta });
          keepRecovery();
          return;
        }
        lastRevision = saved.meta.revision;
        storedContent = request.signature;
        request.phase = "view";
        thumbnailer.schedule(lastRevision);
      }
      const nextView = viewSignature(view);
      if (nextView !== storedView) {
        const saved = await store.saveDrawingView(id, view);
        if (!saved.ok) {
          notFound();
          return;
        }
        storedView = nextView;
      }
      request = null;
      if (pending === scene) {
        pending = null;
      }
      appJotaiStore.set(localStorageQuotaExceededAtom, false);
      publish({ kind: pending ? "unsaved" : "saved" });
      keepRecovery();
      await recoveryWriting;
    }
  };

  const enqueue = () => {
    queued++;
    writing = writing.then(drain).catch((error: unknown) => {
      if (
        error instanceof DOMException &&
        error.name === "QuotaExceededError"
      ) {
        appJotaiStore.set(localStorageQuotaExceededAtom, true);
      }
      publish(
        error instanceof ApiError && error.status === 401
          ? { kind: "expired" }
          : { kind: "error", error },
      );
      keepRecovery();
    });
  };
  const debouncedSave = debounce(enqueue, SAVE_TO_LOCAL_STORAGE_TIMEOUT);
  const debouncedRecovery = debounce(
    keepRecovery,
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

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
    save: (elements, appState, files, onFilesSaved) => {
      if (gone) {
        return;
      }
      latest = { elements, appState, files };
      pending = { ...latest, onFilesSaved };
      generation = ownerWindow.crypto.randomUUID();
      updatedAt = Date.now();
      stageImages(files);
      if (state.kind !== "conflict" && state.kind !== "missing") {
        if (state.kind !== "saving") {
          publish({ kind: "unsaved" });
        }
        debouncedSave();
      }
      debouncedRecovery();
    },
    flush: () => {
      debouncedRecovery.flush();
      const before = queued;
      debouncedSave.flush();
      if (before === queued && pending && state.kind === "unsaved") {
        enqueue();
      }
      return writing;
    },
    isSavePaused: () => ownerWindow.document.hidden,
    changedElsewhere: async () => {
      debouncedSave.flush();
      await writing;
      if (gone) {
        return NOTHING_CHANGED;
      }
      const seen = generation;
      try {
        const meta = await store.getDrawingMeta(id);
        if (!meta || meta.revision <= lastRevision) {
          return NOTHING_CHANGED;
        }
        const changedDuringRead = () => {
          if (!gone && !request && !pending && generation === seen) {
            return false;
          }
          if (!gone && pending && !request && state.kind !== "missing") {
            publish({ kind: "conflict", meta });
          }
          return true;
        };
        if (changedDuringRead()) {
          return NOTHING_CHANGED;
        }
        const content = await store.loadDrawingContent(id);
        if (changedDuringRead() || !content) {
          return NOTHING_CHANGED;
        }
        // a later snapshot must not authorize writes over content we did not load
        lastRevision = meta.revision;
        storedContent = contentSignature(content.elements, content.appState);
        return { scene: content, files: true };
      } catch (error) {
        if (pending) {
          publish({ kind: "error", error });
        }
        return NOTHING_CHANGED;
      }
    },
    unsaved,
    getSaveState: () => state,
    getRecoveryError: () =>
      pending ? imageRecoveryError ?? recoveryError : null,
    hasDurableDraft: () =>
      !pending ||
      (imagesGeneration === generation &&
        (storedGeneration === generation || fallbackGeneration === generation)),
    exportRecovery: () => {
      const scene = pending ?? latest;
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
    subscribeSaveState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retry: async () => {
      if (state.kind === "conflict" || state.kind === "missing" || gone) {
        return;
      }
      debouncedSave.cancel();
      debouncedRecovery.cancel();
      if (pending) {
        stageImages(pending.files);
        keepRecovery();
      }
      enqueue();
      await writing;
    },
    recoverAsCopy: async () => {
      await writing;
      let scene = pending;
      if (!scene) {
        return null;
      }
      await saveImages(scene);
      const { content } = splitAppState(scene.appState);
      const name = t("workspace.saveCopyName", {
        name: content.name || t("labels.untitled"),
      });
      const copy = await store.createDrawing({
        folderId: visibleFolder(store.getSnapshot(), drawing.meta.folderId),
        name,
        content: {
          elements: getNonDeletedElements(scene.elements),
          appState: { ...content, name },
        },
        fileIds: imageFileIds(scene.elements),
      });
      let revision = copy.revision;
      let copiedSignature = contentSignature(scene.elements, content);
      while (
        pending &&
        contentSignature(
          pending.elements,
          splitAppState(pending.appState).content,
        ) !== copiedSignature
      ) {
        scene = pending;
        await imageStaging;
        await saveImages(scene);
        const { content: nextContent } = splitAppState(scene.appState);
        const saved = await store.saveDrawingContent(
          copy.id,
          {
            elements: getNonDeletedElements(scene.elements),
            appState: { ...nextContent, name },
          },
          imageFileIds(scene.elements),
          {
            baseRevision: revision,
            requestId: ownerWindow.crypto.randomUUID(),
          },
        );
        if (!saved.ok) {
          throw new Error(
            "The recovered copy changed before the latest edit was saved",
          );
        }
        revision = saved.meta.revision;
        copiedSignature = contentSignature(scene.elements, nextContent);
      }
      if (
        !pending ||
        contentSignature(
          pending.elements,
          splitAppState(pending.appState).content,
        ) === copiedSignature
      ) {
        pending = null;
      }
      request = null;
      debouncedSave.cancel();
      debouncedRecovery.cancel();
      keepRecovery();
      await recoveryWriting;
      publish({ kind: "saved" });
      return copy;
    },
    renderThumbnail: async () => {
      if (!gone && !pending) {
        await thumbnailer.renderNow(lastRevision);
      }
    },
    fileStorage,
  };
};
