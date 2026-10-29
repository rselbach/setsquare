import { EVENT, KEYS, MIME_TYPES } from "@setsquare/common";
import {
  loadSceneOrLibraryFromBlob,
  normalizeFile,
} from "@setsquare/setsquare/data/blob";
import { fileOpen } from "@setsquare/setsquare/data/filesystem";
import { ImageSceneDataError } from "@setsquare/setsquare/errors";
import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect } from "react";

import { importSceneAsDrawing } from "./importScene";
import { navigate } from "./router";

import type { DrawingMeta, ParentId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask } from "./editorTasks";

type LaunchConsumer = (params: {
  files: readonly FileSystemFileHandle[];
}) => void;

// the browser's queue of files the app is launched with, where it has one
type LaunchQueue = { setConsumer(consumer: LaunchConsumer): void };

const showError =
  (message: string): EditorTask =>
  (api) =>
    api.updateScene({ appState: { errorMessage: message } });

const mergeLibrary =
  (file: Blob): EditorTask =>
  (api) => {
    api
      .updateLibrary({ libraryItems: file, merge: true, openLibraryMenu: true })
      .catch((error) => {
        console.error(error);
        showError(t("errors.importLibraryError"))(api);
      });
  };

// a scene becomes a new drawing in folderId; anything else leaves work for
// the editor
const openFile = async (
  store: WorkspaceStore,
  item: File | FileSystemFileHandle,
  folderId: ParentId,
): Promise<{ drawing: DrawingMeta } | { task: EditorTask }> => {
  let file: File;
  try {
    file = await normalizeFile(
      item instanceof File ? item : await item.getFile(),
    );
  } catch (error) {
    console.error(error);
    return { task: showError(t("errors.openFileError", { name: item.name })) };
  }
  let opened: Awaited<ReturnType<typeof loadSceneOrLibraryFromBlob>>;
  try {
    opened = await loadSceneOrLibraryFromBlob(file, null, null);
  } catch (error) {
    return {
      task: showError(
        error instanceof ImageSceneDataError
          ? t("alerts.cannotRestoreFromImage")
          : t("alerts.couldNotLoadInvalidFile"),
      ),
    };
  }
  if (opened.type === MIME_TYPES.setsquarelib) {
    return { task: mergeLibrary(file) };
  }
  try {
    const drawing = await importSceneAsDrawing(store, opened.data, {
      folderId,
      // named after the file
      name: opened.data.appState.name,
    });
    return { drawing };
  } catch (error) {
    console.error(error);
    return { task: showError(t("errors.openFileError", { name: file.name })) };
  }
};

/**
 * Opens files as the workspace's own, never replacing a drawing: each scene
 * becomes a new drawing in folderId, the last of which opens, and each
 * library merges into the element library. What's left for the editor,
 * errors included, waits for the drawing that opens.
 */
const openFiles = async (
  store: WorkspaceStore,
  items: readonly (File | FileSystemFileHandle)[],
  folderId: ParentId,
  runInEditor: (task: EditorTask) => void,
) => {
  let last: DrawingMeta | null = null;
  const tasks: EditorTask[] = [];
  // in order, so the drawings are created as the files were given
  for (const item of items) {
    const opened = await openFile(store, item, folderId);
    if ("drawing" in opened) {
      last = opened.drawing;
    } else {
      tasks.push(opened.task);
    }
  }
  if (last) {
    await navigate({ kind: "drawing", id: last.id });
  }
  tasks.forEach(runInEditor);
};

/**
 * Lets the user pick a file to open, with Open file… and Cmd+O, importing it
 * into the folder `folderId` gives at the time. Returns what Open file… does.
 */
export const useOpenFile = (
  store: WorkspaceStore,
  folderId: () => ParentId,
  runInEditor: (task: EditorTask) => void,
) => {
  const openFile = useCallback(async () => {
    let file: File;
    try {
      file = await fileOpen({ description: "Setsquare files" });
    } catch (error: any) {
      // cancelling the picker is no error
      if (error?.name !== "AbortError") {
        console.error(error);
        runInEditor(showError(error.message));
      }
      return;
    }
    await openFiles(store, [file], folderId(), runInEditor);
  }, [store, folderId, runInEditor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event[KEYS.CTRL_OR_CMD] &&
        !event.shiftKey &&
        event.key.toLowerCase() === KEYS.O
      ) {
        // the browser would open the file in a tab of its own
        event.preventDefault();
        openFile();
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
  runInEditor: (task: EditorTask) => void,
) => {
  useEffect(() => {
    const { launchQueue } = window as { launchQueue?: LaunchQueue };
    if (!launchQueue) {
      return;
    }
    launchQueue.setConsumer(({ files }) => {
      openFiles(store, files, null, runInEditor);
    });
    return () => launchQueue.setConsumer(() => {});
  }, [store, runInEditor]);
};
