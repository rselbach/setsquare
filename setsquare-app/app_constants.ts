// time constants (ms)
export const SAVE_TO_LOCAL_STORAGE_TIMEOUT = 300;
export const SYNC_BROWSER_TABS_TIMEOUT = 50;

export const STORAGE_KEYS = {
  LOCAL_STORAGE_ELEMENTS: "setsquare",
  LOCAL_STORAGE_APP_STATE: "setsquare-state",
  LOCAL_STORAGE_THEME: "setsquare-theme",
  LOCAL_STORAGE_DEBUG: "setsquare-debug",
  VERSION_DATA_STATE: "version-dataState",
  VERSION_FILES: "version-files",

  IDB_LIBRARY: "setsquare-library",

  // do not use apart from migrations
  __LEGACY_LOCAL_STORAGE_LIBRARY: "setsquare-library",
} as const;
