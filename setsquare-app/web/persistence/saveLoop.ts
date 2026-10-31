import type { SetsquareElement } from "@setsquare/element/types";
import type { AppState, BinaryFiles } from "@setsquare/setsquare/types";

import { splitAppState } from "../../workspace/drawingAppState";

import {
  contentWrite,
  draftScene,
  persistedSignature,
  recoveredRequest,
  sceneContent,
  sceneDraft,
} from "./saveContent";
import { createSaveScheduler } from "./saveScheduler";
import { halted, saveFailure } from "./saveState";
import { saveCopy } from "./storedDrawing";

import type { DrawingMeta } from "../../workspace/types";
import type { WorkspaceStore } from "../../workspace/WorkspaceStore";
import type { createThumbnailer, ThumbnailScene } from "../thumbnail";
import type { RecoveredDrawing } from "../unsavedJournal";
import type { ImageSync } from "./imageSync";
import type { RecoveryJournal } from "./recoveryJournal";
import type { PendingScene, PinnedRequest } from "./saveContent";
import type { SaveState } from "./saveState";
import type { StoredDrawing } from "./storedDrawing";

/**
 * Saves the editor's edits (`pending`) to the drawing, one pinned request
 * at a time. Each pass of `drain` dispatches `sending`, commits the
 * request's content and then its view, and ends `sent`; a conflict, a
 * missing drawing or a failure ends it instead.
 */
export const createSaveLoop = ({
  store,
  drawing,
  ownerWindow,
  onNotFound,
  state,
  stored,
  journal,
  images,
  thumbnailer,
}: {
  store: WorkspaceStore;
  drawing: RecoveredDrawing;
  ownerWindow: Window;
  onNotFound: () => void;
  state: SaveState;
  stored: StoredDrawing;
  journal: RecoveryJournal;
  images: ImageSync;
  thumbnailer: ReturnType<typeof createThumbnailer>;
}) => {
  const { id } = drawing.meta;
  const { recovered } = drawing;
  let gone = false;
  let pending: PendingScene | null = recovered ? draftScene(recovered) : null;
  let pendingSignature =
    pending && persistedSignature(pending.elements, pending.appState);
  let latest: ThumbnailScene | null = pending;
  let request: PinnedRequest | null =
    recovered?.request && pending
      ? recoveredRequest(recovered.request, pending)
      : null;

  const unsaved = () =>
    pending &&
    journal.draft(sceneDraft(id, stored.revision(), pending, request));
  const keepRecovery = () => journal.keep(unsaved());

  const notFound = () => {
    if (store.recoveryKey && pending) {
      request = null;
      state.dispatch({ type: "missing" });
      keepRecovery();
      return;
    }
    gone = true;
    pending = null;
    scheduler.cancelSave();
    thumbnailer.cancel();
    onNotFound();
  };

  const conflict = (meta: DrawingMeta) => {
    request = null;
    state.dispatch({ type: "conflict", meta });
    keepRecovery();
  };

  /** Uploads the scene's images, then builds the write of its content. */
  const prepare = async (scene: PendingScene) => {
    await images.settle();
    await images.upload(scene);
    return contentWrite(sceneContent(scene));
  };

  const drain = async () => {
    while (pending && !gone && !halted(state.get())) {
      const scene = request?.scene ?? pending;
      state.dispatch({ type: "sending" });
      if (!request) {
        const write = await prepare(scene);
        request = {
          ...write,
          uncertain: false,
          phase:
            write.signature !== stored.signature().content ? "content" : "view",
          scene,
          baseRevision: stored.revision(),
          requestId: ownerWindow.crypto.randomUUID(),
        };
      }
      keepRecovery();
      await journal.written();
      if (request.phase === "content") {
        const sent = await stored.sendContent(
          request,
          { baseRevision: request.baseRevision, requestId: request.requestId },
          request.uncertain,
        );
        if (sent.kind === "notFound") {
          notFound();
          return;
        }
        if (sent.kind === "conflict") {
          conflict(sent.meta);
          return;
        }
        request.phase = "view";
        request.uncertain = false;
      }
      if (!(await stored.sendView(splitAppState(scene.appState).view))) {
        notFound();
        return;
      }
      request = null;
      if (pending === scene) {
        pending = null;
      }
      state.dispatch({ type: "sent", pending: !!pending });
      if (!pending) {
        keepRecovery();
        await journal.written();
      } else if (!scheduler.saveAgain()) {
        return;
      }
    }
  };

  const failed = (error: unknown) => {
    const failure = saveFailure(error);
    // A refusal of a retry cannot disprove an earlier unacknowledged commit.
    if (request && !request.uncertain && !failure.uncertain) {
      request = null;
    } else if (request?.phase === "content" && failure.uncertain) {
      request.uncertain = true;
    }
    state.dispatch(failure.event);
    keepRecovery();
  };

  const scheduler = createSaveScheduler({
    drain,
    failed,
    keepRecovery,
    recoveryWritten: journal.written,
  });

  return {
    unsaved,
    keepRecovery,
    gone: () => gone,
    pending: () => pending,
    hasRequest: () => !!request,
    latest: () => latest,
    edit: (
      elements: readonly SetsquareElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      if (gone) {
        return;
      }
      latest = { elements, appState, files };
      scheduler.savePrefsSoon(appState);
      const signature = persistedSignature(elements, appState);
      const kept = pending ? pendingSignature : stored.signature();
      // a change to what the drawing doesn't keep, such as the pointer's
      // button or an open menu, leaves nothing to save
      if (signature.content === kept?.content && signature.view === kept.view) {
        return;
      }
      pending = { ...latest, onFilesSaved };
      pendingSignature = signature;
      journal.edited();
      images.stage(latest, request?.fileIds ?? []);
      state.dispatch({ type: "edited" });
      // an expired session refuses every save until the page reloads; the
      // recovery draft keeps the edit meanwhile
      if (!halted(state.get())) {
        scheduler.saveSoon();
      }
      scheduler.keepRecoverySoon();
    },
    flush: () =>
      scheduler.flush(() => !!pending && state.get().kind === "unsaved"),
    saveWaiting: scheduler.saveWaiting,
    retry: async () => {
      if (halted(state.get()) || gone) {
        return;
      }
      scheduler.cancel();
      if (pending) {
        images.stage(pending, request?.fileIds ?? []);
        keepRecovery();
      }
      scheduler.enqueue();
      await scheduler.settle();
    },
    /** Saves the pending scene as a new drawing, with edits made meanwhile. */
    recoverAsCopy: async () => {
      await scheduler.idle();
      const copy = await saveCopy({
        store,
        drawing,
        ownerWindow,
        pending: () => pending,
        prepare,
      });
      if (!copy) {
        return null;
      }
      pending = null;
      request = null;
      scheduler.cancel();
      keepRecovery();
      await journal.written();
      state.dispatch({ type: "copied" });
      return copy;
    },
    // ends the session without saving; the drawing has to open again to show
    // what the server has
    discard: async () => {
      await scheduler.idle();
      gone = true;
      pending = null;
      request = null;
      scheduler.cancel();
      thumbnailer.cancel();
      keepRecovery();
      await journal.written();
    },
  };
};
