// Runs the editor commands picked from the desktop app's menu bar. The editor
// handles their shortcuts before the menu sees them, so this mostly handles
// clicks, plus the shortcuts the editor leaves to text fields.

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { isWritableElement } from "@setsquare/common";
import {
  actionLoadScene,
  actionSaveFileToDisk,
  actionSaveToActiveFile,
} from "@setsquare/setsquare/actions/actionExport";
import { actionSelectAll } from "@setsquare/setsquare/actions/actionSelectAll";
import {
  useSetsquareActionManager,
  useSetsquareSetAppState,
} from "@setsquare/setsquare/components/App";

import type { Action } from "@setsquare/setsquare/actions/types";

export const DesktopMenuCommands = () => {
  const actionManager = useSetsquareActionManager();
  const setAppState = useSetsquareSetAppState();

  useEffect(() => {
    // like the action's shortcut, which view mode blocks unless the action
    // allows it
    const run = (action: Action) => {
      if (actionManager.getAppState().viewModeEnabled && !action.viewMode) {
        return;
      }
      actionManager.executeAction(action, "ui");
    };

    // a focused text field gets the browser's own text editing, as it would
    // from the standard menu items; otherwise the command edits the drawing
    const editTextOrRun = (textCommand: string, action: Action) => {
      if (isWritableElement(document.activeElement)) {
        document.execCommand(textCommand);
      } else {
        run(action);
      }
    };

    const unlisten = listen<string>("menu", ({ payload }) => {
      switch (payload) {
        case "open":
          return run(actionLoadScene);
        case "save":
          return run(actionSaveToActiveFile);
        case "save-as":
          return run(actionSaveFileToDisk);
        case "export-image":
          return setAppState({ openDialog: { name: "imageExport" } });
        case "undo":
          return editTextOrRun("undo", actionManager.actions.undo);
        case "redo":
          return editTextOrRun("redo", actionManager.actions.redo);
        case "select-all":
          return editTextOrRun("selectAll", actionSelectAll);
      }
    });
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, [actionManager, setAppState]);

  return null;
};
