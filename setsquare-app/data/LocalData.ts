/**
 * This file deals with saving data state (appState, elements, images, ...)
 * locally to the browser.
 *
 * Notes:
 *
 * - DataState refers to full state of the app: appState, elements, images,
 *   though some state is saved separately (library) for one reason or
 *   another. We also save different data to different storage
 *   (localStorage, indexedDB).
 */

import { clearAppStateForLocalStorage } from "@setsquare/setsquare/appState";
import {
  CANVAS_SEARCH_TAB,
  DEFAULT_SIDEBAR,
  debounce,
} from "@setsquare/common";
import { createStore, set, get } from "idb-keyval";

import { getNonDeletedElements } from "@setsquare/element";

import type { LibraryPersistedData } from "@setsquare/setsquare/data/library";
import type { SetsquareElement } from "@setsquare/element/types";
import type { AppState, BinaryFiles } from "@setsquare/setsquare/types";
import type { MaybePromise } from "@setsquare/common/utility-types";

import { appJotaiStore, atom } from "../app-jotai";
import { SAVE_TO_LOCAL_STORAGE_TIMEOUT, STORAGE_KEYS } from "../app_constants";

import { FileStatusStore } from "./fileStatusStore";
import { LocalFileManager, getLocalFiles, saveLocalFiles } from "./localFiles";
import { updateBrowserStateVersion } from "./tabSync";

export const localStorageQuotaExceededAtom = atom(false);
export const imageSaveFailedAtom = atom(false);

const saveDataStateToLocalStorage = (
  elements: readonly SetsquareElement[],
  appState: AppState,
) => {
  const localStorageQuotaExceeded = appJotaiStore.get(
    localStorageQuotaExceededAtom,
  );
  try {
    const _appState = clearAppStateForLocalStorage(appState);

    if (
      _appState.openSidebar?.name === DEFAULT_SIDEBAR.name &&
      _appState.openSidebar.tab === CANVAS_SEARCH_TAB
    ) {
      _appState.openSidebar = null;
    }

    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify(getNonDeletedElements(elements)),
    );
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify(_appState),
    );
    updateBrowserStateVersion(STORAGE_KEYS.VERSION_DATA_STATE);
    if (localStorageQuotaExceeded) {
      appJotaiStore.set(localStorageQuotaExceededAtom, false);
    }
    return true;
  } catch (error: any) {
    // Unable to access window.localStorage
    console.error(error);
    if (isQuotaExceededError(error) && !localStorageQuotaExceeded) {
      appJotaiStore.set(localStorageQuotaExceededAtom, true);
    }
    return false;
  }
};

const isQuotaExceededError = (error: any) => {
  return error instanceof DOMException && error.name === "QuotaExceededError";
};

export class LocalData {
  // settles once every save started so far has finished
  private static saved: Promise<unknown> = Promise.resolve();

  private static _save = debounce(
    (
      elements: readonly SetsquareElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      saveDataStateToLocalStorage(elements, appState);

      const saving = this.fileStorage
        .saveFiles({
          elements,
          files,
        })
        .then(({ erroredFiles }) => {
          appJotaiStore.set(imageSaveFailedAtom, erroredFiles.size > 0);
          onFilesSaved();
        });
      this.saved = Promise.allSettled([this.saved, saving]);
      return saving;
    },
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  /** Saves DataState, including files. Bails if saving is paused */
  static save = (
    elements: readonly SetsquareElement[],
    appState: AppState,
    files: BinaryFiles,
    onFilesSaved: () => void,
  ) => {
    // we need to make the `isSavePaused` check synchronously (undebounced)
    if (!this.isSavePaused()) {
      this._save(elements, appState, files, onFilesSaved);
    }
  };

  /** Saves pending changes now, resolving once every save is stored */
  static flushSave = () => {
    this._save.flush();
    return this.saved;
  };

  /** Persists agent edits even while the desktop window is hidden. */
  static saveImmediately = async (
    elements: readonly SetsquareElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (!saveDataStateToLocalStorage(elements, appState)) {
      throw new Error(
        "The drawing changed, but local storage could not save it",
      );
    }
    const saving = this.fileStorage.saveFiles({ elements, files });
    this.saved = Promise.allSettled([this.saved, saving]);
    const { erroredFiles } = await saving;
    appJotaiStore.set(imageSaveFailedAtom, erroredFiles.size > 0);
    if (erroredFiles.size) {
      throw new Error(
        "The drawing changed, but some images could not be saved",
      );
    }
  };

  static isSavePaused = () => {
    return document.hidden;
  };

  // ---------------------------------------------------------------------------

  static fileStorage = new LocalFileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    getFiles: getLocalFiles,
    saveFiles(data) {
      // before we use `storage` event synchronization, let's update the flag
      // optimistically. Hopefully nothing fails, and an IDB read executed
      // before an IDB write finishes will read the latest value.
      updateBrowserStateVersion(STORAGE_KEYS.VERSION_FILES);
      return saveLocalFiles(data);
    },
  });
}
export class LibraryIndexedDBAdapter {
  /** IndexedDB database and store name */
  private static idb_name = STORAGE_KEYS.IDB_LIBRARY;
  /** library data store key */
  private static key = "libraryData";

  private static store = createStore(
    `${LibraryIndexedDBAdapter.idb_name}-db`,
    `${LibraryIndexedDBAdapter.idb_name}-store`,
  );

  static async load() {
    const IDBData = await get<LibraryPersistedData>(
      LibraryIndexedDBAdapter.key,
      LibraryIndexedDBAdapter.store,
    );

    return IDBData || null;
  }

  static save(data: LibraryPersistedData): MaybePromise<void> {
    return set(
      LibraryIndexedDBAdapter.key,
      data,
      LibraryIndexedDBAdapter.store,
    );
  }
}
