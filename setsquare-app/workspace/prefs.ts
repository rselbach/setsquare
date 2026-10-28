import { STORAGE_KEYS } from "../app_constants";

import { toPrefs } from "./drawingAppState";

import type { Prefs } from "./drawingAppState";

/**
 * The editor settings saved in this browser, or null when there are none or
 * they can't be read.
 */
export const loadPrefs = (): Prefs | null => {
  try {
    const json = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_PREFS);
    if (json === null) {
      return null;
    }
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    // drops whatever an older or newer editor saved that isn't a preference
    return toPrefs(value);
  } catch (error) {
    console.error(error);
    return null;
  }
};

/** Saves the editor settings, returning whether they were stored. */
export const savePrefs = (prefs: Prefs): boolean => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_PREFS,
      JSON.stringify(prefs),
    );
    return true;
  } catch (error) {
    // such as when localStorage is full or blocked
    console.error(error);
    return false;
  }
};
