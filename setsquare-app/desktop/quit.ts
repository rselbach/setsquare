// Quits or restarts the desktop app only once the drawing is saved locally.
// The editor saves a moment after each change, and exiting the process would
// drop the save still waiting or underway, as the webview's unload events
// don't fire.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { LocalData } from "../data/LocalData";

const afterSaving = (command: "quit" | "restart") => async () => {
  try {
    await LocalData.flushSave();
  } finally {
    await invoke(command);
  }
};

/** Saves the drawing locally, then quits the app. */
export const quit = afterSaving("quit");

if (isTauri()) {
  // closing the only window quits the app, so it saves first too
  getCurrentWindow()
    .onCloseRequested((event) => {
      event.preventDefault();
      return quit();
    })
    .catch((error) => console.error("Couldn't watch for closing", error));
  // quits from the system, such as the Dock's Quit or logging out, wait for
  // the app to save
  listen("quit-requested", quit).catch((error) =>
    console.error("Couldn't watch for quits", error),
  );
  // the updater asks once the user agrees to restart into an update
  listen("restart-requested", afterSaving("restart")).catch((error) =>
    console.error("Couldn't watch for restarts", error),
  );
}
