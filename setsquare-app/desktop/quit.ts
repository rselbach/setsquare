// Quits the desktop app only once the drawing is saved locally. The editor
// saves a moment after each change, and exiting the process would drop the
// save still waiting or underway, as the webview's unload events don't fire.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { LocalData } from "../data/LocalData";

/** Saves the drawing locally, then quits the app. */
export const quit = async () => {
  try {
    await LocalData.flushSave();
  } finally {
    await invoke("quit");
  }
};

if (isTauri()) {
  // closing the only window quits the app, so it saves first too
  getCurrentWindow()
    .onCloseRequested((event) => {
      event.preventDefault();
      return quit();
    })
    .catch((error) => console.error("Couldn't watch for closing", error));
}
