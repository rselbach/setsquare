import { checkRemoteChanges } from "../../../web/persistence/remoteChanges";
import { newDrawingMeta } from "../../../workspace/types";
import { contentWith } from "../../workspace/helpers";

import type { RemoteSession } from "../../../web/persistence/remoteChanges";
import type { DrawingContent } from "../../../workspace/types";
import type { WorkspaceStore } from "../../../workspace/WorkspaceStore";

const NOTHING_CHANGED = { scene: null, files: false };
const meta = {
  ...newDrawingMeta({ name: "Greendale", folderId: null, fileIds: [] }, 1),
  revision: 5,
};
const content = contentWith("Greendale", "troy", "abed");

const sessionAt = (revision: number) => {
  const status = {
    gone: false,
    pending: false,
    request: false,
    generation: "g1",
  };
  const session: RemoteSession = {
    gone: () => status.gone,
    revision: () => revision,
    generation: () => status.generation,
    hasPending: () => status.pending,
    hasRequest: () => status.request,
    conflicted: vi.fn(),
    readFailed: vi.fn(),
    reloaded: vi.fn(),
  };
  return { session, status };
};

const storeWith = (
  loadDrawingContent: () => Promise<DrawingContent | null> = async () =>
    content,
) =>
  ({
    getDrawingMeta: vi.fn(async () => meta),
    loadDrawingContent: vi.fn(loadDrawingContent),
  } as Partial<WorkspaceStore> as WorkspaceStore);

describe("checkRemoteChanges", () => {
  it("loads a newer revision into a session with nothing to save", async () => {
    const { session } = sessionAt(4);
    expect(await checkRemoteChanges(storeWith(), meta.id, session)).toEqual({
      scene: content,
      files: true,
    });
    expect(session.reloaded).toHaveBeenCalledWith(5, content);
  });

  it("reads nothing more when the session has the newest revision", async () => {
    const store = storeWith();
    const { session } = sessionAt(5);
    expect(await checkRemoteChanges(store, meta.id, session)).toEqual(
      NOTHING_CHANGED,
    );
    expect(store.loadDrawingContent).not.toHaveBeenCalled();
  });

  it("reads nothing for a session that ended", async () => {
    const store = storeWith();
    const { session, status } = sessionAt(4);
    status.gone = true;
    expect(await checkRemoteChanges(store, meta.id, session)).toEqual(
      NOTHING_CHANGED,
    );
    expect(store.getDrawingMeta).not.toHaveBeenCalled();
  });

  it.each(
    Object.entries({
      "an edit made during the download conflicts": {
        during: { pending: true },
        conflicts: true,
      },
      "a save sent during the download neither loads nor conflicts": {
        during: { pending: true, request: true },
        conflicts: false,
      },
      "an edit saved during the download is not overwritten": {
        during: { generation: "g2" },
        conflicts: false,
      },
    }),
  )("%s", async (_, tc) => {
    const { session, status } = sessionAt(4);
    const store = storeWith(async () => {
      Object.assign(status, tc.during);
      return content;
    });
    expect(await checkRemoteChanges(store, meta.id, session)).toEqual(
      NOTHING_CHANGED,
    );
    expect(session.reloaded).not.toHaveBeenCalled();
    expect(session.conflicted).toHaveBeenCalledTimes(tc.conflicts ? 1 : 0);
  });

  it("reports a session with edits as conflicting before downloading", async () => {
    const store = storeWith();
    const { session, status } = sessionAt(4);
    status.pending = true;
    await checkRemoteChanges(store, meta.id, session);
    expect(session.conflicted).toHaveBeenCalledWith(meta);
    expect(store.loadDrawingContent).not.toHaveBeenCalled();
  });

  it("reports a failed read", async () => {
    const failure = new Error("The library Wi-Fi is down");
    const { session } = sessionAt(4);
    const store = storeWith(async () => {
      throw failure;
    });
    expect(await checkRemoteChanges(store, meta.id, session)).toEqual(
      NOTHING_CHANGED,
    );
    expect(session.readFailed).toHaveBeenCalledWith(failure);
  });
});
