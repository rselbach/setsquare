import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useMemo } from "react";

import { findItem, parentOf, visibleFolder } from "../workspace/tree";

import { useOpenFile } from "./importFiles";
import { navigate } from "./router";

import type { DrawingId, ItemRef, ParentId } from "../workspace/types";
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
  /** moves a drawing to the Trash, the open one as moveToTrash does */
  trashDrawing: (id: DrawingId) => void;
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

/**
 * Moves the item to the Trash and says so, by the name it had, with Undo to
 * take it back out.
 */
export const trashWithUndo = async (
  store: WorkspaceStore,
  item: ItemRef,
  show: (message: PageMessage) => void,
) => {
  const trashed = findItem(store.getSnapshot(), item);
  const result = await store.trash(item);
  if (!trashed || !result.ok) {
    return;
  }
  show({
    text: t("workspace.movedToTrash", {
      name: trashed.name || t("labels.untitled"),
    }),
    error: false,
    undo: () => {
      store.restore(item).catch((error) => console.error(error));
    },
  });
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

  const newDrawing = useCallback(() => {
    store.createDrawing({ folderId: folderId(), name: null }).then(
      (drawing) => {
        newDrawings.set(drawing.id, drawing.revision);
        return navigate({ kind: "drawing", id: drawing.id });
      },
      (error) => console.error(error),
    );
  }, [store, folderId]);

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
    await navigate({ kind: "drawings", folderId: folderId() });
    trash({ kind: "drawing", id: drawingId });
  }, [folderId, trash, drawingId]);

  const trashDrawing = useCallback(
    (id: DrawingId) => {
      if (id === drawingId) {
        moveToTrash();
      } else {
        trash({ kind: "drawing", id });
      }
    },
    [drawingId, moveToTrash, trash],
  );

  return useMemo(
    () => ({ ...actions, allDrawings, moveToTrash, trashDrawing }),
    [actions, allDrawings, moveToTrash, trashDrawing],
  );
};
