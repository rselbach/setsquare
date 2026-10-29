import { useCallback, useMemo } from "react";

import { parentOf, visibleFolder } from "../workspace/tree";

import { useOpenFile } from "./importFiles";
import { navigate } from "./router";

import type { DrawingId, ParentId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask } from "./editorTasks";

/** What the editor's menus and the workspace page offer to create. */
export type WorkspaceActions = {
  /** creates an empty drawing and opens it */
  newDrawing: () => void;
  /** asks for a file and opens it as a new drawing */
  openFile: () => void;
};

/** The editor's workspace actions, which can also go back to the drawings. */
export type DrawingActions = WorkspaceActions & {
  /** goes to the folder of the open drawing */
  allDrawings: () => void;
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
      (drawing) => navigate({ kind: "drawing", id: drawing.id }),
      (error) => console.error(error),
    );
  }, [store, folderId]);

  return useMemo(() => ({ newDrawing, openFile }), [newDrawing, openFile]);
};

/**
 * The editor's workspace actions on drawingId, the drawing it has open: they
 * create next to it, and All drawings goes to its folder, or to the root if
 * that's gone or in the Trash.
 */
export const useDrawingActions = (
  store: WorkspaceStore,
  drawingId: DrawingId,
  queueTask: (task: EditorTask) => void,
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

  return useMemo(() => ({ ...actions, allDrawings }), [actions, allDrawings]);
};
