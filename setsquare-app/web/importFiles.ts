import { EVENT, KEYS, MIME_TYPES } from "@setsquare/common";
import {
  loadLibraryFromBlob,
  loadSceneOrLibraryFromBlob,
  normalizeFile,
} from "@setsquare/setsquare/data/blob";
import { fileOpen } from "@setsquare/setsquare/data/filesystem";
import { mergeLibraryItems } from "@setsquare/setsquare/data/library";
import { ImageSceneDataError } from "@setsquare/setsquare/errors";
import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect } from "react";

import { LibraryIndexedDBAdapter } from "../data/LocalData";

import { importSceneAsDrawing, missingImagesTask } from "./importScene";
import { isModalOpen } from "./isModalOpen";
import { navigate } from "./router";

import type { DrawingMeta, ParentId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask } from "./editorTasks";

type LaunchConsumer = (params: {
  files: readonly FileSystemFileHandle[];
}) => void;

// the browser's queue of files the app is launched with, where it has one
type LaunchQueue = { setConsumer(consumer: LaunchConsumer): void };

const errorTask = (message: () => string): EditorTask => ({
  kind: "error",
  message,
});

// a scene becomes a new drawing in folderId; anything else, or a scene
// missing images, leaves a task
const openFile = async (
  store: WorkspaceStore,
  item: File | FileSystemFileHandle,
  folderId: ParentId,
): Promise<{ drawing: DrawingMeta | null; task: EditorTask | null }> => {
  let file: File;
  try {
    file = await normalizeFile(
      item instanceof File ? item : await item.getFile(),
    );
  } catch (error) {
    console.error(error);
    return {
      drawing: null,
      task: errorTask(() => t("errors.openFileError", { name: item.name })),
    };
  }
  let opened: Awaited<ReturnType<typeof loadSceneOrLibraryFromBlob>>;
  try {
    opened = await loadSceneOrLibraryFromBlob(file, null, null);
  } catch (error) {
    return {
      drawing: null,
      task: errorTask(() =>
        error instanceof ImageSceneDataError
          ? t("alerts.cannotRestoreFromImage")
          : t("alerts.couldNotLoadInvalidFile"),
      ),
    };
  }
  if (opened.type === MIME_TYPES.setsquarelib) {
    return { drawing: null, task: { kind: "library", file } };
  }
  try {
    const { drawing, missingImages } = await importSceneAsDrawing(
      store,
      opened.data,
      // named after the file
      { folderId, name: opened.data.appState.name },
    );
    return {
      drawing,
      task: missingImages ? missingImagesTask(file.name, missingImages) : null,
    };
  } catch (error) {
    console.error(error);
    return {
      drawing: null,
      task: errorTask(() => t("errors.openFileError", { name: file.name })),
    };
  }
};

/**
 * Merges a library file into the element library this browser keeps, as the
 * editor would, for when no editor is open to do it.
 */
export const addToStoredLibrary = async (file: Blob) => {
  const [stored, items] = await Promise.all([
    LibraryIndexedDBAdapter.load(),
    loadLibraryFromBlob(file),
  ]);
  await LibraryIndexedDBAdapter.save({
    libraryItems: mergeLibraryItems(stored?.libraryItems ?? [], items),
  });
};

/**
 * Opens files as the workspace's own, never replacing a drawing: each scene
 * becomes a new drawing in folderId, the last of which opens, and each
 * library merges into the element library. Errors and libraries are queued
 * for the drawing that opens, or for whatever the app shows if none does.
 */
const openFiles = async (
  store: WorkspaceStore,
  items: readonly (File | FileSystemFileHandle)[],
  folderId: ParentId,
  queueTask: (task: EditorTask) => void,
) => {
  let last: DrawingMeta | null = null;
  const tasks: EditorTask[] = [];
  // in order, so the drawings are created as the files were given
  for (const item of items) {
    const { drawing, task } = await openFile(store, item, folderId);
    last = drawing ?? last;
    if (task) {
      tasks.push(task);
    }
  }
  if (last) {
    await navigate({ kind: "drawing", id: last.id });
  }
  tasks.forEach(queueTask);
};

/**
 * Lets the user pick a file to open, with Open file… and Cmd+O, importing it
 * into the folder `folderId` gives once it's picked, or at the root if that
 * folder is gone or in the Trash by then. Returns what Open file… does.
 */
export const useOpenFile = (
  store: WorkspaceStore,
  folderId: () => ParentId,
  queueTask: (task: EditorTask) => void,
) => {
  const openFile = useCallback(async () => {
    let file: File;
    try {
      file = await fileOpen({ description: "Setsquare files" });
    } catch (error: any) {
      // cancelling the picker is no error
      if (error?.name !== "AbortError") {
        console.error(error);
        queueTask(errorTask(() => error.message));
      }
      return;
    }
    await openFiles(store, [file], folderId(), queueTask);
  }, [store, folderId, queueTask]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event[KEYS.CTRL_OR_CMD] &&
        !event.shiftKey &&
        event.key.toLowerCase() === KEYS.O
      ) {
        // the browser would open the file in a tab of its own
        event.preventDefault();
        if (!isModalOpen(document)) {
          openFile();
        }
      }
    };
    document.addEventListener(EVENT.KEYDOWN, onKeyDown);
    return () => document.removeEventListener(EVENT.KEYDOWN, onKeyDown);
  }, [openFile]);

  return openFile;
};

/**
 * Opens the files the browser launches the app with, such as a drawing
 * double-clicked in the file manager, each scene as a new drawing at the
 * root. The browser holds launches until there's a consumer, so it's fine
 * to start once the workspace is ready.
 */
export const useLaunchedFiles = (
  store: WorkspaceStore,
  queueTask: (task: EditorTask) => void,
) => {
  useEffect(() => {
    const { launchQueue } = window as { launchQueue?: LaunchQueue };
    if (!launchQueue) {
      return;
    }
    launchQueue.setConsumer(({ files }) => {
      openFiles(store, files, null, queueTask);
    });
    return () => launchQueue.setConsumer(() => {});
  }, [store, queueTask]);
};
