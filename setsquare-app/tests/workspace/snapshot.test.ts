import { emptyDrawingContent } from "../../workspace/drawingAppState";
import { SnapshotState } from "../../workspace/remote/snapshot";
import { AccountClient } from "../../workspace/remote/transport";
import { newDrawingMeta } from "../../workspace/types";

import { fakeAccountServer } from "./fakeAccountServer";

import type { WorkspaceData } from "../../workspace/api";
import type { DrawingId, DrawingMeta } from "../../workspace/types";

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const meta = (name: string) =>
  newDrawingMeta({ name, folderId: null, fileIds: [] }, 1000);

const workspace = (...drawings: DrawingMeta[]): WorkspaceData => ({
  folders: [],
  drawings,
});

let accounts = 0;

// answers each request only when the test says so
const heldServer = () => {
  const held: Array<{ path: string; answer: (value: unknown) => void }> = [];
  const fetch: typeof globalThis.fetch = (input) =>
    new Promise((resolve) => {
      held.push({
        path: String(input),
        answer: (value) => resolve(response(value)),
      });
    });
  return { held, fetch };
};

const snapshotOf = (
  fetch: typeof globalThis.fetch,
  session = fakeAccountServer({ userId: `greendale-${++accounts}` }).session,
) => {
  let requests = 0;
  return new SnapshotState(
    new AccountClient({ session, fetch, onSessionExpired: () => {} }),
    () => `request-${++requests}`,
  );
};

describe("SnapshotState", () => {
  it("publishes a command's snapshot and reads drawings the server has", async () => {
    const server = fakeAccountServer({ userId: `greendale-${++accounts}` });
    const state = snapshotOf(server.fetch, server.session);
    const listener = vi.fn();
    state.subscribe(listener);
    const id = "dreamatorium" as DrawingId;
    const { result } = await state.command({
      kind: "createDrawing",
      id,
      folderId: null,
      name: "Dreamatorium",
      content: emptyDrawingContent("Dreamatorium"),
      fileIds: [],
    });
    expect(result.kind).toBe("drawing");
    expect([...state.getSnapshot().drawings.keys()]).toEqual([id]);
    expect(listener).toHaveBeenCalledTimes(1);
    const drawing = await state.readDrawing(`/api/drawings/${id}`);
    expect(drawing?.meta.openedAt).not.toBeNull();
    expect(state.getSnapshot().drawings.get(id)).toEqual(drawing?.meta);
    expect(await state.readDrawing("/api/drawings/missing")).toBeNull();
    expect(server.commands.map(({ requestId }) => requestId)).toEqual([
      "request-1",
    ]);
  });

  it("holds reads until this tab's earlier commands settle", async () => {
    const { held, fetch } = heldServer();
    const state = snapshotOf(fetch);
    const saving = state.command({ kind: "emptyTrash" });
    const refreshing = state.refresh();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(held[0].path).toBe("/api/commands");
    held[0].answer({
      result: { kind: "change", result: { ok: true } },
      snapshot: workspace(meta("Pierce")),
    });
    await saving;
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(held[1].path).toBe("/api/workspace");
    const shirley = meta("Shirley");
    held[1].answer(workspace(shirley));
    await refreshing;
    expect([...state.getSnapshot().drawings.values()]).toEqual([shirley]);
  });

  it("keeps running commands after one fails", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ error: "invalid_request" }, 400))
      .mockResolvedValueOnce(
        response({
          result: { kind: "change", result: { ok: true } },
          snapshot: workspace(),
        }),
      );
    const state = snapshotOf(fetch);
    const failed = state.command({ kind: "emptyTrash" });
    const next = state.command({ kind: "emptyTrash" });
    await expect(failed).rejects.toThrow("invalid_request");
    expect((await next).result).toEqual({
      kind: "change",
      result: { ok: true },
    });
  });

  it("drops a snapshot that started before the one already shown", async () => {
    const { held, fetch } = heldServer();
    const state = snapshotOf(fetch);
    const older = state.refresh();
    const newer = state.refresh();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    const annie = meta("Annie");
    held[1].answer(workspace(annie));
    await newer;
    held[0].answer(workspace(meta("Britta")));
    await older;
    expect([...state.getSnapshot().drawings.values()]).toEqual([annie]);
  });

  it("stops publishing once closed", async () => {
    const { held, fetch } = heldServer();
    const state = snapshotOf(fetch);
    const listener = vi.fn();
    state.subscribe(listener);
    const refreshing = state.refresh();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    state.close();
    held[0].answer(workspace(meta("Chang")));
    await refreshing;
    expect(state.getSnapshot().drawings.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
