import { EVENT } from "@setsquare/common";
import { getNonDeletedElements } from "@setsquare/element";
import { loadFromBlob } from "@setsquare/setsquare/data/blob";
import { t } from "@setsquare/setsquare/i18n";
import { useEffect } from "react";

import type { FileId } from "@setsquare/element/types";
import type { RestoredDataState } from "@setsquare/setsquare/data/restore";
import type { BinaryFileData } from "@setsquare/setsquare/types";

import { getSceneUrl } from "../desktop/sceneUrl";
import { splitAppState } from "../workspace/drawingAppState";

import { imageFileIds } from "./drawingPersistence";
import { navigate } from "./router";

import type { ParentId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask } from "./editorTasks";

/**
 * Creates a drawing from a restored scene, such as an opened file, with the
 * scene's images. Of its appState, only what belongs to a drawing is kept,
 * so the file's preferences and scroll don't carry over.
 */
export const importSceneAsDrawing = async (
  store: WorkspaceStore,
  scene: RestoredDataState,
  { folderId, name }: { folderId: ParentId; name: string | null },
) => {
  const elements = getNonDeletedElements(scene.elements);
  const fileIds = imageFileIds(elements);
  const addedFiles = new Map<FileId, BinaryFileData>();
  for (const id of fileIds) {
    if (scene.files[id]) {
      addedFiles.set(id, scene.files[id]);
    }
  }
  const { erroredFiles } = await store.files.save({ addedFiles });
  if (erroredFiles.size) {
    // the drawing is still worth having; its images show as missing
    console.error("Couldn't save the imported images", [
      ...erroredFiles.keys(),
    ]);
  }
  return store.createDrawing({
    folderId,
    name,
    content: { elements, appState: splitAppState(scene.appState).content },
    fileIds,
  });
};

/**
 * Imports the scene the address's `#url=` names, if it names one, as a new
 * drawing at the root and opens it. Resolves to false if it couldn't.
 */
export const openSceneUrl = async (store: WorkspaceStore) => {
  const url = getSceneUrl();
  if (!url) {
    return true;
  }
  // the link is used up; the page keeps its own address
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  try {
    const response = await fetch(window.decodeURIComponent(url));
    const scene = await loadFromBlob(await response.blob(), null, null);
    const drawing = await importSceneAsDrawing(store, scene, {
      folderId: null,
      name: scene.appState.name,
    });
    await navigate({ kind: "drawing", id: drawing.id }, { replace: true });
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

/** Tells the user a `#url=` link's scene couldn't be opened. */
export const sceneUrlFailed = (): EditorTask => ({
  kind: "error",
  message: () => t("alerts.invalidSceneUrl"),
});

/**
 * Opens the scenes of `#url=` links followed while the app is open, queueing
 * an error for one that couldn't be.
 */
export const useSceneUrlLinks = (
  store: WorkspaceStore,
  queueTask: (task: EditorTask) => void,
) => {
  useEffect(() => {
    const onHashChange = () => {
      openSceneUrl(store).then((opened) => {
        if (!opened) {
          queueTask(sceneUrlFailed());
        }
      });
    };
    window.addEventListener(EVENT.HASHCHANGE, onHashChange);
    return () => window.removeEventListener(EVENT.HASHCHANGE, onHashChange);
  }, [store, queueTask]);
};
