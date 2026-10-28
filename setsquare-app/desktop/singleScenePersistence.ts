import {
  restoreAppState,
  restoreElements,
} from "@setsquare/setsquare/data/restore";
import { t } from "@setsquare/setsquare/i18n";

import type { RestoredDataState } from "@setsquare/setsquare/data/restore";
import type { SetsquareInitialDataState } from "@setsquare/setsquare/types";

import { STORAGE_KEYS } from "../app_constants";
import { LocalData } from "../data/LocalData";
import { importFromLocalStorage } from "../data/localStorage";
import { isBrowserStorageStateNewer } from "../data/tabSync";

import { getSceneUrl, loadSceneFromUrl } from "./sceneUrl";

import type { ScenePersistence } from "../editor/ScenePersistence";

const initializeScene = async (): Promise<SetsquareInitialDataState> => {
  const url = getSceneUrl();

  const localDataState = importFromLocalStorage();

  const scene: Omit<
    RestoredDataState,
    // we're not storing files in localStorage, and instead fetch them async
    // from a different store
    "files"
  > = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  if (url) {
    try {
      const data = await loadSceneFromUrl(url, scene.elements.length > 0);
      if (data) {
        return data;
      }
    } catch (error: any) {
      return {
        ...scene,
        appState: {
          ...scene.appState,
          errorMessage: t("alerts.invalidSceneUrl"),
        },
      };
    }
  }

  return scene;
};

/**
 * The one scene kept in local storage, with its images in IndexedDB. A page
 * opened from a `#url=` link opens the linked scene instead, after asking
 * before it replaces a scene with elements.
 */
export const singleScenePersistence: ScenePersistence = {
  load: initializeScene,
  opened: (fileIds) => {
    // on fresh load, clear unused files from IDB (from previous session)
    LocalData.fileStorage.clearObsoleteFiles({ currentFileIds: fileIds });
  },
  save: LocalData.save,
  flush: LocalData.flushSave,
  isSavePaused: LocalData.isSavePaused,
  changedElsewhere: async () => ({
    // don't sync if local state is newer or identical to browser state
    scene: isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)
      ? importFromLocalStorage()
      : null,
    files: isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES),
  }),
  fileStorage: LocalData.fileStorage,
};
