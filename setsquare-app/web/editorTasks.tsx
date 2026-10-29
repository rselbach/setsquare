import { useApp } from "@setsquare/setsquare/components/App";
import { useCallback, useEffect, useState } from "react";

import type { SetsquareImperativeAPI } from "@setsquare/setsquare/types";

/** Work for the editor, such as showing an error, given its API. */
export type EditorTask = (api: SetsquareImperativeAPI) => void;

/**
 * Holds work for the editor the app shows, which may still be loading, or
 * not there yet while the app opens another drawing. Render
 * {@link EditorTasks} in the editor to run it there.
 */
export const useEditorTasks = () => {
  const [tasks, setTasks] = useState<readonly EditorTask[]>([]);
  const runInEditor = useCallback(
    (task: EditorTask) => setTasks((tasks) => [...tasks, task]),
    [],
  );
  const onRun = useCallback(
    (ran: readonly EditorTask[]) =>
      setTasks((tasks) => tasks.filter((task) => !ran.includes(task))),
    [],
  );
  return { tasks, runInEditor, onRun };
};

/**
 * Runs tasks in the editor it's rendered in, once that editor has loaded its
 * scene, which would otherwise undo them. Being inside the editor, it can't
 * reach one that's leaving.
 */
export const EditorTasks = ({
  tasks,
  onRun,
}: {
  tasks: readonly EditorTask[];
  onRun: (tasks: readonly EditorTask[]) => void;
}) => {
  const { api } = useApp();

  useEffect(() => {
    if (!tasks.length) {
      return;
    }
    let active = true;
    api.onEvent("editor:initialize").then((api) => {
      if (active) {
        tasks.forEach((task) => task(api));
        onRun(tasks);
      }
    });
    return () => {
      active = false;
    };
  }, [api, tasks, onRun]);

  return null;
};
