import { FileSaveError } from "../../data/FileManager";
import {
  apiFailureCause,
  apiFailureKind,
  RequestFailure,
} from "../../workspace/remote/ApiError";

import type { DrawingMeta } from "../../workspace/types";
import type { RecoveredDrawing } from "../unsavedJournal";

/** Whether this session's latest edit has reached persistent storage. */
export type DrawingSaveState =
  | { kind: "saved" | "unsaved" | "saving" | "expired" | "missing" }
  | { kind: "error" | "rejected"; error: unknown }
  | { kind: "conflict"; meta: DrawingMeta };

/** What happens to a drawing's saves. */
export type SaveEvent =
  | { type: "edited" }
  | { type: "sending" }
  | { type: "sent"; pending: boolean }
  | { type: "conflict"; meta: DrawingMeta }
  | { type: "missing" }
  | { type: "failed"; kind: "expired" | "rejected" | "error"; error: unknown }
  | { type: "copied" };

/** Whether saving has stopped until the user acts or the page reloads. */
export const halted = (state: DrawingSaveState) =>
  state.kind === "conflict" ||
  state.kind === "missing" ||
  state.kind === "expired";

/**
 * Every change of save state. `·` keeps the state; `sent` ends `unsaved`
 * when newer edits wait, and `failed` ends in the failure's kind.
 *
 * | state \ event       | edited  | sending | sent  | conflict | missing | failed | copied |
 * | ------------------- | ------- | ------- | ----- | -------- | ------- | ------ | ------ |
 * | saved, unsaved      | unsaved | saving  | saved | conflict | missing | kind   | saved  |
 * | error, rejected     | unsaved | saving  | saved | conflict | missing | kind   | saved  |
 * | saving              | ·       | saving  | saved | conflict | missing | kind   | saved  |
 * | conflict            | ·       | ·       | saved | conflict | missing | kind   | saved  |
 * | missing             | ·       | ·       | saved | ·        | missing | kind   | saved  |
 * | expired             | ·       | ·       | saved | conflict | missing | ·      | saved  |
 *
 * The save loop sends nothing while `halted`, so `sent` only leaves a halted
 * state when it raced a focus check, as a save can.
 */
export const transition = (
  state: DrawingSaveState,
  event: SaveEvent,
): DrawingSaveState => {
  switch (event.type) {
    case "edited":
      return halted(state) || state.kind === "saving"
        ? state
        : { kind: "unsaved" };
    case "sending":
      return halted(state) ? state : { kind: "saving" };
    case "sent":
      return { kind: event.pending ? "unsaved" : "saved" };
    case "conflict":
      return state.kind === "missing"
        ? state
        : { kind: "conflict", meta: event.meta };
    case "missing":
      return { kind: "missing" };
    case "failed":
      // an expired session refuses every save until the page reloads
      if (state.kind === "expired") {
        return state;
      }
      return event.kind === "expired"
        ? { kind: "expired" }
        : { kind: event.kind, error: event.error };
    case "copied":
      return { kind: "saved" };
  }
};

/** The state a drawing opens in, from what recovery found. */
export const openingState = (drawing: RecoveredDrawing): DrawingSaveState => {
  const { recovered } = drawing;
  if (drawing.unavailable) {
    return { kind: "missing" };
  }
  if (!recovered) {
    return { kind: "saved" };
  }
  return recovered.baseRevision !== drawing.meta.revision && !recovered.request
    ? { kind: "conflict", meta: drawing.meta }
    : { kind: "unsaved" };
};

/**
 * Classifies a failed save, and whether its request may have committed
 * anyway, so it has to be resent exactly as it was.
 */
export const saveFailure = (
  error: unknown,
): { event: SaveEvent; uncertain: boolean } => {
  const cause = apiFailureCause(error);
  const kinds =
    cause instanceof FileSaveError
      ? [...cause.errors.values()].map(apiFailureKind)
      : [apiFailureKind(cause)];
  const kind = kinds.includes("expired")
    ? "expired"
    : kinds.includes("rejected")
      ? "rejected"
      : "error";
  return {
    event: { type: "failed", kind, error: cause },
    uncertain:
      error instanceof RequestFailure
        ? error.outcome === "unknown"
        : kind === "error",
  };
};

/** Holds a session's save state; only `dispatch` changes it. */
export const createSaveState = (initial: DrawingSaveState) => {
  let state = initial;
  const listeners = new Set<() => void>();
  const publish = (next: DrawingSaveState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    get: () => state,
    dispatch: (event: SaveEvent) => {
      const next = transition(state, event);
      if (next !== state) {
        publish(next);
      }
    },
    /** Tells listeners that what they read alongside the state changed. */
    refresh: () => publish({ ...state }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** A session's save state. */
export type SaveState = ReturnType<typeof createSaveState>;
