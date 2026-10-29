import { useCallback, useMemo } from "react";

import { isTrashed, parentOf } from "../workspace/tree";

import { useOpenFile } from "./importFiles";
import { navigate } from "./router";

import type { DrawingId, ParentId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask } from "./editorTasks";

/** What the editor's menus offer to do in the workspace. */
export type WorkspaceActions = {
  /** creates an empty drawing next to the open one and opens it */
  newDrawing: () => void;
  /** asks for a file and opens it as a new drawing next to the open one */
  openFile: () => void;
};

/**
 * The editor's workspace actions on drawingId, the drawing it has open, if
 * any. It also takes Cmd+O for Open file….
 */
export const useWorkspaceActions = (
  store: WorkspaceStore,
  drawingId: DrawingId | null,
  runInEditor: (task: EditorTask) => void,
): WorkspaceActions => {
  // the open drawing's folder, unless that's gone or in the Trash, where
  // a new drawing wouldn't show
  const folderId = useCallback((): ParentId => {
    const snap = store.getSnapshot();
    const drawing =
      drawingId === null ? undefined : snap.drawings.get(drawingId);
    const parentId = drawing ? parentOf(snap, drawing) : null;
    return parentId !== null &&
      isTrashed(snap, { kind: "folder", id: parentId })
      ? null
      : parentId;
  }, [store, drawingId]);

  const openFile = useOpenFile(store, folderId, runInEditor);

  const newDrawing = useCallback(() => {
    store.createDrawing({ folderId: folderId(), name: null }).then(
      (drawing) => navigate({ kind: "drawing", id: drawing.id }),
      (error) => console.error(error),
    );
  }, [store, folderId]);

  return useMemo(() => ({ newDrawing, openFile }), [newDrawing, openFile]);
};
