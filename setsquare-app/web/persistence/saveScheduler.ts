import { debounce } from "@setsquare/common";

import type { AppState } from "@setsquare/setsquare/types";

import { SAVE_TO_LOCAL_STORAGE_TIMEOUT } from "../../app_constants";
import { toPrefs } from "../../workspace/drawingAppState";
import { savePrefs } from "../../workspace/prefs";

/**
 * Decides when a session saves: one save at a time, each after a pause in
 * editing, unless a caller waits for everything pending to save.
 */
export const createSaveScheduler = ({
  drain,
  failed,
  keepRecovery,
  recoveryWritten,
}: {
  /** saves until nothing is pending, or until `saveAgain` says to wait */
  drain: () => Promise<void>;
  failed: (error: unknown) => void;
  keepRecovery: () => void;
  recoveryWritten: () => Promise<void>;
}) => {
  let writing = Promise.resolve();
  let queued = 0;
  // while above zero, the queue saves until nothing is pending instead of
  // waiting for a pause in editing between saves
  let settling = 0;
  // set while edits made during a save wait for the debounce, so a drain
  // queued before that save finished doesn't send them at once
  let awaitingPause = false;

  const enqueue = () => {
    queued++;
    writing = writing
      .then(() => (awaitingPause && !settling ? undefined : drain()))
      .catch(failed);
  };
  const save = debounce(() => {
    awaitingPause = false;
    enqueue();
  }, SAVE_TO_LOCAL_STORAGE_TIMEOUT);
  const recovery = debounce(keepRecovery, SAVE_TO_LOCAL_STORAGE_TIMEOUT);
  const prefs = debounce(
    (appState: AppState) => savePrefs(toPrefs(appState)),
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  /** Waits until the queue has saved everything pending or has to stop. */
  const settle = async () => {
    settling++;
    try {
      await writing;
      await recoveryWritten();
    } finally {
      settling--;
    }
  };

  return {
    saveSoon: () => save(),
    keepRecoverySoon: () => recovery(),
    savePrefsSoon: (appState: AppState) => prefs(appState),
    /** Saves now, also when no save was waiting if `needed` says so. */
    flush: (needed: () => boolean) => {
      recovery.flush();
      prefs.flush();
      const before = queued;
      save.flush();
      if (before === queued && needed()) {
        enqueue();
      }
      return settle();
    },
    /** Sends a waiting save now, and waits for every save to end. */
    saveWaiting: () => {
      save.flush();
      return settle();
    },
    enqueue,
    settle,
    /** Resolves once the saves queued so far have ended. */
    idle: () => writing,
    /**
     * Called after a save that left newer edits: whether to save them now.
     * Otherwise they wait for a pause in editing; the recovery draft keeps
     * them meanwhile.
     */
    saveAgain: () => {
      if (settling) {
        return true;
      }
      awaitingPause = true;
      save();
      return false;
    },
    cancelSave: () => save.cancel(),
    cancel: () => {
      save.cancel();
      recovery.cancel();
    },
  };
};

/** When a session saves. */
export type SaveScheduler = ReturnType<typeof createSaveScheduler>;
