import { useApp } from "@setsquare/setsquare/components/App";
import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect, useState } from "react";

import type { SetsquareImperativeAPI } from "@setsquare/setsquare/types";

/**
 * Something left for the app to show or finish, such as an error from
 * opening a file. Messages are read when shown, in the language the app has
 * by then. The editor the app shows takes it, or the workspace page when no
 * editor is coming.
 */
export type EditorTask =
  | { kind: "error"; message: () => string }
  /** a library file to merge into the element library */
  | { kind: "library"; file: Blob }
  /** a passing hint about the editor, which the page leaves out */
  | { kind: "hint"; message: () => string };

const HINT_DURATION_MS = 10000;

const runTask = (api: SetsquareImperativeAPI, task: EditorTask) => {
  switch (task.kind) {
    case "error":
      api.updateScene({ appState: { errorMessage: task.message() } });
      return;
    case "library":
      api
        .updateLibrary({
          libraryItems: task.file,
          merge: true,
          openLibraryMenu: true,
        })
        .catch((error) => {
          console.error(error);
          runTask(api, {
            kind: "error",
            message: () => t("errors.importLibraryError"),
          });
        });
      return;
    case "hint":
      api.setToast({
        message: task.message(),
        closable: true,
        duration: HINT_DURATION_MS,
      });
  }
};

/**
 * Holds tasks for the editor the app shows, which may still be loading, or
 * not there yet while the app opens another drawing. Render
 * {@link EditorTasks} in the editor to run them there; the workspace page
 * takes them when it shows instead.
 */
export const useEditorTasks = (initial: readonly EditorTask[] = []) => {
  const [tasks, setTasks] = useState(initial);
  const queueTask = useCallback(
    (task: EditorTask) => setTasks((tasks) => [...tasks, task]),
    [],
  );
  const onRun = useCallback(
    (ran: readonly EditorTask[]) =>
      setTasks((tasks) => tasks.filter((task) => !ran.includes(task))),
    [],
  );
  return { tasks, queueTask, onRun };
};

/** The tasks waiting for a view of the app, and how to add and finish them. */
export type QueuedTasks = ReturnType<typeof useEditorTasks>;

/**
 * Runs tasks in the editor it's rendered in, once that editor has loaded its
 * scene, which would otherwise undo them. Being inside the editor, it can't
 * reach one that's leaving.
 */
export const EditorTasks = ({
  tasks,
  onRun,
}: Pick<QueuedTasks, "tasks" | "onRun">) => {
  const { api } = useApp();

  useEffect(() => {
    if (!tasks.length) {
      return;
    }
    let active = true;
    api.onEvent("editor:initialize").then((api) => {
      if (active) {
        tasks.forEach((task) => runTask(api, task));
        onRun(tasks);
      }
    });
    return () => {
      active = false;
    };
  }, [api, tasks, onRun]);

  return null;
};
