// Gives the desktop app the browser's launch queue, so files opened with the
// app from Finder or the Dock load like files a browser launches the web app
// with. The editor checks for the launch queue once when it loads, so this
// module must be imported before the editor.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { DesktopFileHandle } from "./fileSystem";

class LaunchParams {
  constructor(readonly files: readonly FileSystemFileHandle[]) {}
}

type LaunchConsumer = (params: LaunchParams) => void;

let consumer: LaunchConsumer | null = null;
const waiting: LaunchParams[] = [];

const launch = (paths: string[]) => {
  if (!paths.length) {
    return;
  }
  const params = new LaunchParams(
    paths.map((path) => new DesktopFileHandle(path)),
  );
  if (consumer) {
    consumer(params);
  } else {
    waiting.push(params);
  }
};

// like the browser's, holds launches until the editor is ready for them
const launchQueue = {
  setConsumer(newConsumer: LaunchConsumer) {
    consumer = newConsumer;
    waiting.splice(0).forEach(newConsumer);
  },
};

if (isTauri()) {
  Object.assign(window, { launchQueue, LaunchParams });
  // listening first means no file is missed between taking the files opened
  // so far and hearing about new ones
  listen<string[]>("open-files", ({ payload }) => launch(payload))
    .then(() => invoke<string[]>("take_opened_files"))
    .then(launch)
    .catch((error) => console.error("Couldn't receive opened files", error));
}
