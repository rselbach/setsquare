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

import { SAVE_TO_LOCAL_STORAGE_TIMEOUT } from "../app_constants";
import { FileManager, FileSaveError } from "../data/FileManager";
import { FileStatusStore } from "../data/fileStatusStore";
import {
  DRAWING_CONTENT_KEYS,
  DRAWING_VIEW_KEYS,
  splitAppState,
  toPrefs,
} from "../workspace/drawingAppState";
import { loadPrefs, savePrefs } from "../workspace/prefs";
import {
  apiFailureCause,
  apiFailureKind,
  RequestFailure,
} from "../workspace/remote/ApiError";
import { visibleFolder } from "../workspace/tree";

import { createThumbnailer } from "./thumbnail";
import { clearUnsaved, holdDraft, writeUnsaved } from "./unsavedJournal";

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

/** What the drawing's storage keeps of a scene, as content and view. */
const persistedSignature = (
  elements: readonly SetsquareElement[],
  appState: AppState,
) => {
  const { content, view } = splitAppState(appState);
  return {
    content: contentSignature(getNonDeletedElements(elements), content),
    view: viewSignature(view),
  };
};

const NOTHING_CHANGED = { scene: null, files: false } as const;

const isQuotaExceeded = (error: unknown) =>
  error instanceof DOMException && error.name === "QuotaExceededError";

/** Whether this session's latest edit has reached persistent storage. */
export type DrawingSaveState =
  | { kind: "saved" | "unsaved" | "saving" | "expired" | "missing" }
  | { kind: "error" | "rejected"; error: unknown }
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

type PendingScene = ThumbnailScene & { onFilesSaved: () => void };
type ContentWrite = {
  phase: "content" | "view";
  uncertain: boolean;
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
  let viewError: unknown | null = null;
  let recoveredSource = recovered && "draftId" in recovered ? recovered : null;
  // until the last hold ends, another tab adopts neither this session's
  // draft nor the one it adopted
  let holds = 0;
  let unlock = () => {};
  const unlocked = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  holdDraft(store.recoveryLocks, draftId, unlocked);
  if (recoveredSource) {
    holdDraft(store.recoveryLocks, recoveredSource.draftId, unlocked);
  }
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
  let pendingSignature =
    pending && persistedSignature(pending.elements, pending.appState);
  let latest: ThumbnailScene | null = pending;
  // while above zero, the queue saves until nothing is pending instead of
  // waiting for a pause in editing between saves
  let settling = 0;
  // set while edits made during a save wait for the debounce, so a drain
  // queued before that save finished doesn't send them at once
  let awaitingPause = false;
  let request: ContentWrite | null =
    recovered?.request && pending
      ? {
          phase: "content",
          uncertain: true,
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
      draftId,
      generation,
      updatedAt,
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

  const recoveryStorage = store.recoveryStorage ?? ownerWindow.localStorage;

  const keepRecovery = () => {
    const draft = unsaved();
    if (draft && "draftId" in draft) {
      const fallbackSaved = writeUnsaved(
        draft,
        store.recoveryKey,
        recoveryStorage,
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
      clearUnsaved(id, store.recoveryKey, recoveryStorage, draftId);
      if (!store.recoveryKey && recovered && !("draftId" in recovered)) {
        clearUnsaved(id, undefined, recoveryStorage);
      }
      const source = recoveredSource;
      recoveredSource = null;
      recoveryWriting = recoveryWriting
        .then(async () => {
          await store.recoveryDrafts?.remove(draftId);
          // the two stores' copies of the source can differ; a copy its
          // still-open editor wrote after the one adopted here stays
          if (source) {
            await store.recoveryDrafts?.remove(
              source.draftId,
              source.updatedAt,
            );
            clearUnsaved(
              id,
              store.recoveryKey,
              recoveryStorage,
              source.draftId,
              source.updatedAt,
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

  const recoveryProblem = () =>
    pending ? imageRecoveryError ?? recoveryError : null;

  const localImagesSaved = (scene: PendingScene) =>
    imageFileIds(getNonDeletedElements(scene.elements)).every((id) =>
      scene.files[id]
        ? fileStorage.isFileSaved(scene.files[id])
        : drawing.meta.fileIds.includes(id),
    );

  const saveImages = async (scene: PendingScene) => {
    const savingGeneration = generation;
    const { erroredFiles, errors } = await fileStorage.saveFiles({
      ...scene,
      elements: getNonDeletedElements(scene.elements),
    });
    if (erroredFiles.size) {
      throw new FileSaveError(
        new Map([...erroredFiles.keys()].map((id) => [id, errors?.get(id)])),
      );
    }
    if (!store.stageFiles && scene === pending && localImagesSaved(scene)) {
      imagesGeneration = savingGeneration;
      imageRecoveryError = null;
    }
    scene.onFilesSaved();
  };

  /** Stages the images the scene shows and the pinned request still needs. */
  const stageImages = (scene: ThumbnailScene) => {
    const stagingGeneration = generation;
    const ids = new Set<string>([
      ...imageFileIds(getNonDeletedElements(scene.elements)),
      ...(request ? imageFileIds(request.content.elements) : []),
    ]);
    const files: BinaryFiles = Object.fromEntries(
      Object.entries(scene.files).filter(([id]) => ids.has(id)),
    );
    imageStaging = (store.stageFiles?.(files) ?? Promise.resolve()).then(
      () => {
        if (store.stageFiles || (pending && localImagesSaved(pending))) {
          imagesGeneration = stagingGeneration;
          if (generation === stagingGeneration) {
            imageRecoveryError = null;
          }
        } else if (generation === stagingGeneration) {
          imageRecoveryError = new Error(
            "The drawing's images have not been stored on this device",
          );
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

  /** Waits for image staging without letting a device-copy failure stop a save. */
  const settleImageStaging = async () => {
    try {
      await imageStaging;
    } catch (error) {
      console.warn(
        "Could not stage the drawing's images on this device",
        error,
      );
    }
  };

  const drain = async () => {
    if (awaitingPause && !settling) {
      return;
    }
    while (
      pending &&
      !gone &&
      state.kind !== "conflict" &&
      state.kind !== "missing" &&
      state.kind !== "expired"
    ) {
      const scene = request?.scene ?? pending;
      const { content, view } = splitAppState(scene.appState);
      publish({ kind: "saving" });
      if (!request) {
        await settleImageStaging();
        await saveImages(scene);
        const elements = getNonDeletedElements(scene.elements);
        const signature = contentSignature(elements, content);
        request = {
          uncertain: false,
          phase: signature !== storedContent ? "content" : "view",
          scene,
          content: { elements, appState: content },
          signature,
          baseRevision: lastRevision,
          requestId: ownerWindow.crypto.randomUUID(),
        };
      }
      keepRecovery();
      await recoveryWriting;
      if (request.phase === "content") {
        const saved = await store.saveDrawingContent(
          id,
          request.content,
          imageFileIds(request.content.elements),
          { baseRevision: request.baseRevision, requestId: request.requestId },
        );
        if (!saved.ok) {
          if (saved.reason === "notFound") {
            notFound();
            return;
          }
          // a request whose outcome is unknown, such as one a closed page
          // left, may be what moved the revision; unlike the server, this
          // device's storage keeps no receipt to say so
          const stored =
            request.uncertain && !store.recoveryKey
              ? await store.loadDrawingContent(id)
              : null;
          if (
            !stored ||
            contentSignature(stored.elements, stored.appState) !==
              request.signature
          ) {
            request = null;
            publish({ kind: "conflict", meta: saved.meta });
            keepRecovery();
            return;
          }
        }
        // a resent request gets the receipt of its first commit, which a
        // later save elsewhere may have overwritten since
        const current = store.getSnapshot().drawings.get(id);
        if (current && current.revision > saved.meta.revision) {
          request = null;
          publish({ kind: "conflict", meta: current });
          keepRecovery();
          return;
        }
        lastRevision = saved.meta.revision;
        storedContent = request.signature;
        request.phase = "view";
        request.uncertain = false;
        thumbnailer.schedule(lastRevision);
      }
      const nextView = viewSignature(view);
      if (nextView !== storedView) {
        try {
          const saved = await store.saveDrawingView(id, view);
          if (!saved.ok) {
            notFound();
            return;
          }
          storedView = nextView;
          viewError = null;
        } catch (error) {
          viewError = error;
          // where this browser left the drawing is a convenience; its
          // content is already saved
          console.warn("Could not save the drawing's view", id, error);
        }
      }
      request = null;
      if (pending === scene) {
        pending = null;
      }
      publish({ kind: pending ? "unsaved" : "saved" });
      if (!pending) {
        keepRecovery();
        await recoveryWriting;
      } else if (!settling) {
        // edits made during this save wait for a pause in editing; the
        // debounced recovery copy keeps them meanwhile
        awaitingPause = true;
        debouncedSave();
        return;
      }
    }
  };

  const enqueue = () => {
    queued++;
    writing = writing.then(drain).catch((error: unknown) => {
      const cause = apiFailureCause(error);
      const kinds =
        cause instanceof FileSaveError
          ? [...cause.errors.values()].map(apiFailureKind)
          : [apiFailureKind(cause)];
      const kind = kinds.includes("expired")
        ? "expired"
        : kinds.includes("rejected")
        ? "rejected"
        : "unknown";
      const uncertain =
        error instanceof RequestFailure
          ? error.outcome === "unknown"
          : kind === "unknown";
      // A refusal of a retry cannot disprove an earlier unacknowledged commit.
      if (request && !request.uncertain && !uncertain) {
        request = null;
      } else if (request?.phase === "content" && uncertain) {
        request.uncertain = true;
      }
      publish(
        kind === "expired"
          ? { kind }
          : {
              kind: kind === "rejected" ? "rejected" : "error",
              error: cause,
            },
      );
      keepRecovery();
    });
  };
  const debouncedSave = debounce(() => {
    awaitingPause = false;
    enqueue();
  }, SAVE_TO_LOCAL_STORAGE_TIMEOUT);
  const debouncedRecovery = debounce(
    keepRecovery,
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );
  const debouncedPrefs = debounce(
    (appState: AppState) => savePrefs(toPrefs(appState)),
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  /** Waits until the queue has saved everything pending or has to stop. */
  const settle = async () => {
    settling++;
    try {
      await writing;
      await recoveryWriting;
    } finally {
      settling--;
    }
  };

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
      debouncedPrefs(appState);
      const signature = persistedSignature(elements, appState);
      const kept = pending
        ? pendingSignature
        : { content: storedContent, view: storedView };
      // a change to what the drawing doesn't keep, such as the pointer's
      // button or an open menu, leaves nothing to save
      if (signature.content === kept?.content && signature.view === kept.view) {
        return;
      }
      pending = { ...latest, onFilesSaved };
      pendingSignature = signature;
      generation = ownerWindow.crypto.randomUUID();
      updatedAt = Date.now();
      stageImages(latest);
      // an expired session refuses every save until the page reloads; the
      // recovery draft keeps the edit meanwhile
      if (
        state.kind !== "conflict" &&
        state.kind !== "missing" &&
        state.kind !== "expired"
      ) {
        if (state.kind !== "saving") {
          publish({ kind: "unsaved" });
        }
        debouncedSave();
      }
      debouncedRecovery();
    },
    flush: () => {
      debouncedRecovery.flush();
      debouncedPrefs.flush();
      const before = queued;
      debouncedSave.flush();
      if (before === queued && pending && state.kind === "unsaved") {
        enqueue();
      }
      return settle();
    },
    isSavePaused: () => ownerWindow.document.hidden,
    changedElsewhere: async () => {
      debouncedSave.flush();
      await settle();
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
        if (pending && state.kind !== "expired") {
          publish({ kind: "error", error });
        }
        return NOTHING_CHANGED;
      }
    },
    unsaved,
    keepRecovery,
    getSaveState: () => state,
    getRecoveryError: recoveryProblem,
    isDeviceStorageFull: () =>
      isQuotaExceeded(viewError) || isQuotaExceeded(recoveryProblem()),
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
      if (
        state.kind === "conflict" ||
        state.kind === "missing" ||
        state.kind === "expired" ||
        gone
      ) {
        return;
      }
      debouncedSave.cancel();
      debouncedRecovery.cancel();
      if (pending) {
        stageImages(pending);
        keepRecovery();
      }
      enqueue();
      await settle();
    },
    recoverAsCopy: async () => {
      await writing;
      let scene = pending;
      if (!scene) {
        return null;
      }
      await saveImages(scene);
      const elements = getNonDeletedElements(scene.elements);
      const { content } = splitAppState(scene.appState);
      const name = t("workspace.saveCopyName", {
        name: content.name || t("labels.untitled"),
      });
      const copy = await store.createDrawing({
        folderId: visibleFolder(store.getSnapshot(), drawing.meta.folderId),
        name,
        content: {
          elements,
          appState: { ...content, name },
        },
        fileIds: imageFileIds(elements),
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
        await settleImageStaging();
        await saveImages(scene);
        const nextElements = getNonDeletedElements(scene.elements);
        const { content: nextContent } = splitAppState(scene.appState);
        const saved = await store.saveDrawingContent(
          copy.id,
          {
            elements: nextElements,
            appState: { ...nextContent, name },
          },
          imageFileIds(nextElements),
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
    // ends the session without saving; the drawing has to open again to show
    // what the server has
    discard: async () => {
      await writing;
      gone = true;
      pending = null;
      request = null;
      debouncedSave.cancel();
      debouncedRecovery.cancel();
      thumbnailer.cancel();
      keepRecovery();
      await recoveryWriting;
    },
    hold: () => {
      holds++;
      return () => {
        holds--;
        if (!holds) {
          unlock();
        }
      };
    },
    renderThumbnail: async () => {
      if (!gone && !pending) {
        await thumbnailer.renderNow(lastRevision);
      }
    },
    fileStorage,
  };
};
