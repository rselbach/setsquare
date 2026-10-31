import { EVENT } from "@setsquare/common";
import {
  getNonDeletedElements,
  isInitializedImageElement,
} from "@setsquare/element";
import { loadFromBlob } from "@setsquare/setsquare/data/blob";
import { t } from "@setsquare/setsquare/i18n";
import { useEffect } from "react";

import type { FileId } from "@setsquare/element/types";
import type { RestoredDataState } from "@setsquare/setsquare/data/restore";
import type { BinaryFileData } from "@setsquare/setsquare/types";

import { getSceneUrl } from "../desktop/sceneUrl";
import { splitAppState } from "../workspace/drawingAppState";

import { imageFileIds } from "./persistence/saveContent";
import { navigate } from "./router";

import type { ParentId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask } from "./editorTasks";

/**
 * Creates a drawing from a restored scene, such as an opened file, with the
 * scene's images. Of its appState, only what belongs to a drawing is kept,
 * so the file's preferences and scroll don't carry over. Images the scene
 * lacks or the store refuses are left out, with how many there were.
 */
export const importSceneAsDrawing = async (
  store: WorkspaceStore,
  scene: RestoredDataState,
  { folderId, name }: { folderId: ParentId; name: string | null },
) => {
  const elements = getNonDeletedElements(scene.elements);
  const addedFiles = new Map<FileId, BinaryFileData>();
  const missing = new Set<FileId>();
  for (const id of imageFileIds(elements)) {
    if (scene.files[id]) {
      addedFiles.set(id, scene.files[id]);
    } else {
      missing.add(id);
    }
  }
  const { erroredFiles } = await store.files.save({ addedFiles });
  for (const id of erroredFiles.keys()) {
    missing.add(id);
  }
  if (missing.size) {
    console.error("Couldn't import the scene's images", [...missing]);
  }
  // the drawing is still worth having without them, and an account refuses
  // a drawing that shows images it doesn't have
  const kept = elements.filter(
    (element) =>
      !isInitializedImageElement(element) || !missing.has(element.fileId),
  );
  const drawing = await store.createDrawing({
    folderId,
    name,
    content: {
      elements: kept,
      appState: splitAppState(scene.appState).content,
    },
    fileIds: imageFileIds(kept),
  });
  return { drawing, missingImages: elements.length - kept.length };
};

/** Tells the user the drawing `name` opened as lacks some of its images. */
export const missingImagesTask = (name: string, count: number): EditorTask => ({
  kind: "error",
  message: () => t("errors.openFileMissingImages", { name, count }),
});

/**
 * Imports the scene the address's `#url=` names, if it names one, as a new
 * drawing at the root and opens it. Resolves to what's left to tell the user.
 */
export const openSceneUrl = async (
  store: WorkspaceStore,
): Promise<EditorTask[]> => {
  const url = getSceneUrl();
  if (!url) {
    return [];
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
    const { drawing, missingImages } = await importSceneAsDrawing(
      store,
      scene,
      { folderId: null, name: scene.appState.name },
    );
    await navigate({ kind: "drawing", id: drawing.id }, { replace: true });
    return missingImages
      ? [missingImagesTask(drawing.name ?? t("labels.untitled"), missingImages)]
      : [];
  } catch (error) {
    console.error(error);
    return [{ kind: "error", message: () => t("alerts.invalidSceneUrl") }];
  }
};

/**
 * Opens the scenes of `#url=` links followed while the app is open, queueing
 * an error for one that couldn't be, or that lacks images.
 */
export const useSceneUrlLinks = (
  store: WorkspaceStore,
  queueTask: (task: EditorTask) => void,
) => {
  useEffect(() => {
    const onHashChange = () => {
      openSceneUrl(store).then((tasks) => tasks.forEach(queueTask));
    };
    window.addEventListener(EVENT.HASHCHANGE, onHashChange);
    return () => window.removeEventListener(EVENT.HASHCHANGE, onHashChange);
  }, [store, queueTask]);
};
