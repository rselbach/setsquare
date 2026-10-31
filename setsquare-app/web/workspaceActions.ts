import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useMemo } from "react";

import {
  ApiError,
  apiFailureCause,
  apiFailureKind,
} from "../workspace/remote/ApiError";
import {
  findItem,
  parentOf,
  uniqueName,
  visibleFolder,
} from "../workspace/tree";
import { useShowMessage } from "../workspace/ui/WorkspaceToast";

import { useOpenFile } from "./importFiles";
import { navigate } from "./router";

import type {
  ChangeResult,
  DrawingId,
  ItemRef,
  MoveResult,
  ParentId,
  SaveResult,
} from "../workspace/types";
import type { PageMessage } from "../workspace/ui/WorkspaceToast";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask } from "./editorTasks";

/** What the editor's menus and the workspace page offer to create. */
export type WorkspaceActions = {
  /** creates an empty drawing and opens it */
  newDrawing: () => void;
  /** asks for a file and opens it as a new drawing */
  openFile: () => void;
};

/** The editor's workspace actions, which can also leave the open drawing. */
export type DrawingActions = WorkspaceActions & {
  /** goes to the folder of the open drawing */
  allDrawings: () => void;
  /**
   * saves the open drawing and goes to its folder, which shows it moved to
   * the Trash with Undo
   */
  moveToTrash: () => void;
};

// the drawings New drawing made in this tab, with the revision they were
// made with, until the editor first leaves them; see discardIfUnused
const newDrawings = new Map<DrawingId, number>();

/**
 * Deletes the drawing for good, not to the Trash, if New drawing made it in
 * this tab and it's still as it was made: nothing on it, no name, and no
 * content saved since, so not even a new background. Drawings made any
 * other way, such as by opening an empty file, are kept. Call it as the
 * editor leaves the drawing, once it's saved, with whether everything was;
 * it only ever looks at a drawing once. Resolves with whether it deleted it.
 */
export const discardIfUnused = async (
  store: WorkspaceStore,
  id: DrawingId,
  saved: boolean,
) => {
  const revision = newDrawings.get(id);
  newDrawings.delete(id);
  if (revision === undefined || !saved) {
    return false;
  }
  const [meta, content] = await Promise.all([
    store.getDrawingMeta(id),
    store.loadDrawingContent(id),
  ]);
  if (
    meta?.revision !== revision ||
    meta.name !== null ||
    content?.elements.length !== 0
  ) {
    return false;
  }
  return (await store.deleteForever({ kind: "drawing", id })).ok;
};

// what each action says when it fails for a reason there's no better
// message for
const FAILED = {
  move: "workspace.failedMove",
  rename: "workspace.failedRename",
  duplicate: "workspace.failedDuplicate",
  newFolder: "workspace.failedNewFolder",
  newDrawing: "workspace.failedNewDrawing",
  trash: "workspace.failedTrash",
  restore: "workspace.failedRestore",
  deleteForever: "workspace.failedDeleteForever",
  emptyTrash: "workspace.failedEmptyTrash",
} as const;

/** A workspace action that can fail, as its failure message names it. */
export type FailedAction = keyof typeof FAILED;

/** What the store refused an action with, or what it threw. */
export type StoreFailure =
  | { reason: Exclude<MoveResult | SaveResult, { ok: true }>["reason"] }
  | { error: unknown };

const failureText = (
  failure: StoreFailure,
  action: FailedAction,
  name: string,
) => {
  const cause = "error" in failure ? apiFailureCause(failure.error) : null;
  const reason =
    "reason" in failure
      ? failure.reason
      : cause instanceof ApiError &&
          cause.status === 409 &&
          cause.message === "target_trashed"
        ? "targetTrashed"
        : null;
  switch (reason) {
    case "targetTrashed":
      return t("workspace.failedTargetTrashed");
    case "notFound":
      return t("workspace.failedNotFound", { name });
    case "conflict":
      return t("workspace.failedConflict", { name });
  }
  // fetch rejects with a TypeError when the network does
  if (
    cause instanceof TypeError ||
    (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500))
  ) {
    return t("workspace.failedUnreachable");
  }
  return t(FAILED[action], { name });
};

/**
 * Tells the user that the store refused or failed `action` on the item it
 * shows as `name`. An expired session says nothing, since the account
 * notice already does.
 */
export const reportFailure = (
  show: (message: PageMessage) => void,
  failure: StoreFailure,
  action: FailedAction,
  name = "",
) => {
  if ("error" in failure) {
    console.error(failure.error);
    if (apiFailureKind(failure.error) === "expired") {
      return;
    }
  }
  show({ text: failureText(failure, action, name), error: true });
};

/**
 * Waits for a change to the store, reporting it with {@link reportFailure}
 * if the store refuses or fails it. Resolves with whether it went through.
 */
export const attempt = async (
  show: (message: PageMessage) => void,
  change: Promise<ChangeResult | MoveResult | SaveResult>,
  action: FailedAction,
  name?: string,
) => {
  try {
    const result = await change;
    if (!result.ok) {
      reportFailure(show, result, action, name);
    }
    return result.ok;
  } catch (error) {
    reportFailure(show, { error }, action, name);
    return false;
  }
};

/**
 * Moves the item to the Trash and says so, by the name it had, with Undo to
 * take it back out. It says so too when the store refuses or fails it.
 */
export const trashWithUndo = async (
  store: WorkspaceStore,
  item: ItemRef,
  show: (message: PageMessage) => void,
) => {
  const trashed = findItem(store.getSnapshot(), item);
  const name = trashed?.name || t("labels.untitled");
  if (!(await attempt(show, store.trash(item), "trash", name)) || !trashed) {
    return;
  }
  show({
    text: t("workspace.movedToTrash", { name }),
    error: false,
    undo: () => {
      // one deleted for good meanwhile has nothing to restore, and the
      // page shows it's gone
      store
        .restore(item)
        .catch((error) => reportFailure(show, { error }, "restore", name));
    },
  });
};

/**
 * Copies the drawing next to it, as "Copy of" the name the store has for it
 * once `beforeCopy` resolves, made unique in its folder. A failure is said
 * with `name`, what the user knows the drawing by.
 */
export const duplicateDrawing = async (
  store: WorkspaceStore,
  id: DrawingId,
  show: (message: PageMessage) => void,
  { name, beforeCopy }: { name: string; beforeCopy?: () => Promise<unknown> },
) => {
  try {
    await beforeCopy?.();
    const snap = store.getSnapshot();
    const source = snap.drawings.get(id);
    const copy =
      source &&
      (await store.duplicateDrawing(
        id,
        uniqueName(
          snap,
          parentOf(snap, source),
          t("workspace.copyName", {
            name: source.name || t("labels.untitled"),
          }),
        ),
      ));
    if (!copy) {
      reportFailure(show, { reason: "notFound" }, "duplicate", name);
    }
  } catch (error) {
    reportFailure(show, { error }, "duplicate", name);
  }
};

/**
 * Creates drawings in the folder `folderId` gives at the time, queueing what
 * opening files leaves to show. It also takes Cmd+O for Open file…, so only
 * the view that shows uses it.
 */
export const useWorkspaceActions = (
  store: WorkspaceStore,
  folderId: () => ParentId,
  queueTask: (task: EditorTask) => void,
): WorkspaceActions => {
  const openFile = useOpenFile(store, folderId, queueTask);
  const show = useShowMessage();

  const newDrawing = useCallback(() => {
    store.createDrawing({ folderId: folderId(), name: null }).then(
      (drawing) => {
        newDrawings.set(drawing.id, drawing.revision);
        return navigate({ kind: "drawing", id: drawing.id });
      },
      (error) => reportFailure(show, { error }, "newDrawing"),
    );
  }, [store, folderId, show]);

  return useMemo(() => ({ newDrawing, openFile }), [newDrawing, openFile]);
};

/**
 * The editor's workspace actions on drawingId, the drawing it has open: they
 * create next to it, and All drawings and Move to Trash go to its folder, or
 * to the root if that's gone or in the Trash. `trash` moves an item to the
 * Trash, offering Undo.
 */
export const useDrawingActions = (
  store: WorkspaceStore,
  drawingId: DrawingId,
  queueTask: (task: EditorTask) => void,
  trash: (item: ItemRef) => void,
): DrawingActions => {
  const folderId = useCallback((): ParentId => {
    const snap = store.getSnapshot();
    const drawing = snap.drawings.get(drawingId);
    return drawing ? visibleFolder(snap, parentOf(snap, drawing)) : null;
  }, [store, drawingId]);

  const actions = useWorkspaceActions(store, folderId, queueTask);

  const allDrawings = useCallback(() => {
    navigate({ kind: "drawings", folderId: folderId() });
  }, [folderId]);

  const moveToTrash = useCallback(async () => {
    // leaving first saves the drawing, and the editor isn't there to see it
    // go, which it would take for another tab's doing
    if (!(await navigate({ kind: "drawings", folderId: folderId() }))) {
      return;
    }
    trash({ kind: "drawing", id: drawingId });
  }, [folderId, trash, drawingId]);

  return useMemo(
    () => ({ ...actions, allDrawings, moveToTrash }),
    [actions, allDrawings, moveToTrash],
  );
};
