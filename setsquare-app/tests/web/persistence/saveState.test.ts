import { getDefaultAppState } from "@setsquare/setsquare/appState";

import type { FileId } from "@setsquare/element/types";

import { FileSaveError } from "../../../data/FileManager";
import {
  createSaveState,
  openingState,
  saveFailure,
  transition,
} from "../../../web/persistence/saveState";
import {
  emptyDrawingContent,
  splitAppState,
} from "../../../workspace/drawingAppState";
import { ApiError, RequestFailure } from "../../../workspace/remote/ApiError";
import { newDrawingMeta } from "../../../workspace/types";

import type {
  DrawingSaveState,
  SaveEvent,
} from "../../../web/persistence/saveState";
import type { RecoveredDrawing } from "../../../web/unsavedJournal";

const meta = newDrawingMeta(
  { name: "Greendale", folderId: null, fileIds: [] },
  1,
);
const failure = new Error("Troy unplugged the router");

const states: Record<string, DrawingSaveState> = {
  saved: { kind: "saved" },
  unsaved: { kind: "unsaved" },
  error: { kind: "error", error: failure },
  rejected: { kind: "rejected", error: failure },
  saving: { kind: "saving" },
  conflict: { kind: "conflict", meta },
  missing: { kind: "missing" },
  expired: { kind: "expired" },
};

const events: Record<string, SaveEvent> = {
  edited: { type: "edited" },
  sending: { type: "sending" },
  sent: { type: "sent", pending: false },
  conflict: { type: "conflict", meta },
  missing: { type: "missing" },
  failed: { type: "failed", kind: "rejected", error: failure },
  copied: { type: "copied" },
};

// the table in saveState.ts, row by row, in the order of `events`
// prettier-ignore
const table: Record<string, string[]> = {
  //         edited     sending   sent     conflict    missing    failed      copied
  saved:    ["unsaved", "saving", "saved", "conflict", "missing", "rejected", "saved"],
  unsaved:  ["unsaved", "saving", "saved", "conflict", "missing", "rejected", "saved"],
  error:    ["unsaved", "saving", "saved", "conflict", "missing", "rejected", "saved"],
  rejected: ["unsaved", "saving", "saved", "conflict", "missing", "rejected", "saved"],
  saving:   ["·",       "saving", "saved", "conflict", "missing", "rejected", "saved"],
  conflict: ["·",       "·",      "saved", "conflict", "missing", "rejected", "saved"],
  missing:  ["·",       "·",      "saved", "·",        "missing", "rejected", "saved"],
  expired:  ["·",       "·",      "saved", "conflict", "missing", "·",        "saved"],
};

describe("transition", () => {
  const cases = Object.entries(table).flatMap(([from, row]) =>
    Object.entries(events).map(
      ([on, event], index) =>
        [
          `${from} on ${on}`,
          { state: states[from], event, want: row[index] },
        ] as const,
    ),
  );

  it.each(cases)("%s", (_, tc) => {
    const next = transition(tc.state, tc.event);
    if (tc.want === "·") {
      expect(next).toBe(tc.state);
      return;
    }
    expect(next).not.toBe(tc.state);
    expect(next.kind).toBe(tc.want);
  });

  it("ends a save unsaved while newer edits wait", () => {
    expect(
      transition({ kind: "saving" }, { type: "sent", pending: true }),
    ).toEqual({ kind: "unsaved" });
  });

  it("carries the failure and the conflicting revision", () => {
    expect(transition({ kind: "saving" }, events.failed)).toEqual({
      kind: "rejected",
      error: failure,
    });
    expect(transition({ kind: "saving" }, events.conflict)).toEqual({
      kind: "conflict",
      meta,
    });
  });
});

describe("saveFailure", () => {
  const imageError = new FileSaveError(
    new Map([
      ["star-burns" as FileId, new ApiError(413, "too_large")],
      ["chang" as FileId, new ApiError(401, "unauthorized")],
    ]),
  );
  it.each(
    Object.entries({
      "an expired session": {
        error: new ApiError(401, "unauthorized"),
        kind: "expired",
        uncertain: false,
      },
      "a refused request": {
        error: new ApiError(413, "too_large"),
        kind: "rejected",
        uncertain: false,
      },
      "an unexplained error": {
        error: failure,
        kind: "error",
        uncertain: true,
      },
      "a request that may have committed": {
        error: new RequestFailure("unknown", new ApiError(413, "too_large")),
        kind: "rejected",
        uncertain: true,
      },
      "a request that did not commit": {
        error: new RequestFailure("not-committed", failure),
        kind: "error",
        uncertain: false,
      },
      "an image upload one of whose images found the session expired": {
        error: imageError,
        kind: "expired",
        uncertain: false,
      },
    }),
  )("classifies %s", (_, tc) => {
    const { event, uncertain } = saveFailure(tc.error);
    expect(event).toMatchObject({ type: "failed", kind: tc.kind });
    expect(uncertain).toBe(tc.uncertain);
  });
});

describe("openingState", () => {
  const content = emptyDrawingContent("Greendale");
  const { view } = splitAppState(getDefaultAppState());
  const drawing: RecoveredDrawing = {
    meta: { ...meta, revision: 3 },
    content,
    view: null,
  };
  const draft = (baseRevision: number) => ({
    id: meta.id,
    baseRevision,
    elements: [],
    appState: { ...content.appState, ...view },
  });
  const cases: Record<
    string,
    { opened: RecoveredDrawing; want: DrawingSaveState["kind"] }
  > = {
    "a drawing with no draft": { opened: drawing, want: "saved" },
    "a draft of the current revision": {
      opened: { ...drawing, recovered: draft(3) },
      want: "unsaved",
    },
    "a draft of an older revision": {
      opened: { ...drawing, recovered: draft(2) },
      want: "conflict",
    },
    "a draft of an older revision with a request to resend": {
      opened: {
        ...drawing,
        recovered: {
          ...draft(2),
          request: { requestId: "dean-pelton", baseRevision: 2, content },
        },
      },
      want: "unsaved",
    },
    "a drawing the server no longer has": {
      opened: { ...drawing, recovered: draft(3), unavailable: "missing" },
      want: "missing",
    },
  };

  it.each(Object.entries(cases))("opens %s", (_, tc) => {
    expect(openingState(tc.opened).kind).toBe(tc.want);
  });
});

describe("createSaveState", () => {
  it("tells listeners of changes, and of nothing else", () => {
    const state = createSaveState({ kind: "conflict", meta });
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);
    state.dispatch({ type: "edited" });
    expect(listener).not.toHaveBeenCalled();
    state.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    state.dispatch({ type: "copied" });
    expect(state.get()).toEqual({ kind: "saved" });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    state.dispatch({ type: "edited" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("gives listeners a new state object on refresh", () => {
    const state = createSaveState({ kind: "unsaved" });
    const before = state.get();
    state.refresh();
    expect(state.get()).not.toBe(before);
    expect(state.get()).toEqual(before);
  });
});
