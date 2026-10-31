import { webcrypto } from "node:crypto";

import { AccountCache } from "../../workspace/remote/AccountCache";
import { FileSync } from "../../workspace/remote/fileSync";
import { LocalImport } from "../../workspace/remote/localImport";
import { SnapshotState } from "../../workspace/remote/snapshot";
import { AccountClient } from "../../workspace/remote/transport";

import { workspaceFixture } from "./helpers";

import type { WorkspaceCommand } from "../../workspace/api";
import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { FolderId } from "../../workspace/types";

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const caches: AccountCache[] = [];
const fixtures: Array<ReturnType<typeof workspaceFixture>> = [];
let accounts = 0;

// confirms every import, and refuses drawings named in `refuse`
const importServer = (refuse: readonly string[] = []) => {
  const sent: Array<{ requestId: string; command: WorkspaceCommand }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
    const body: { requestId: string; command: WorkspaceCommand } = JSON.parse(
      String(init?.body),
    );
    const { command } = body;
    if (command.kind === "importFolder") {
      sent.push(body);
      return response({
        result: { kind: "folder", folder: command.folder },
        snapshot: { folders: [command.folder], drawings: [] },
      });
    }
    if (command.kind !== "importDrawing") {
      throw new Error(`Unexpected ${command.kind}`);
    }
    const { meta } = command.drawing;
    if (refuse.includes(meta.name ?? "")) {
      return response({ error: "invalid_request" }, 400);
    }
    sent.push(body);
    return response({
      result: { kind: "drawing", drawing: meta },
      snapshot: { folders: [], drawings: [meta] },
    });
  });
  return { sent, fetch };
};

const importer = async (
  fetch: typeof globalThis.fetch,
  account = `greendale-${++accounts}`,
) => {
  const client = new AccountClient({
    session: {
      kind: "signedIn",
      user: {
        id: account,
        login: "troy-barnes",
        name: "Troy Barnes",
        avatarUrl: "https://avatars.githubusercontent.com/u/123",
      },
      csrfToken: "greendale-csrf-token",
    },
    fetch,
    onSessionExpired: () => {},
  });
  const cache = await AccountCache.open(window, account);
  caches.push(cache);
  return new LocalImport(
    new SnapshotState(client, () => crypto.randomUUID()),
    new FileSync(client, cache),
    cache,
    window,
  );
};

const browser = async (): Promise<LocalWorkspaceStore> => {
  const fixture = workspaceFixture();
  fixtures.push(fixture);
  return fixture.open();
};

beforeAll(() => {
  vi.spyOn(window, "crypto", "get").mockReturnValue(webcrypto as Crypto);
});

afterAll(() => vi.restoreAllMocks());

afterEach(() => {
  for (const cache of caches.splice(0)) {
    cache.close();
  }
  for (const fixture of fixtures.splice(0)) {
    fixture.close();
  }
});

describe("LocalImport", () => {
  it("imports parent folders before their children", async () => {
    const local = await browser();
    const child = await local.createFolder(null, "Study room");
    const parent = await local.createFolder(null, "Greendale");
    await local.move({ kind: "folder", id: child.id }, parent.id);
    const { sent, fetch } = importServer();
    await (await importer(fetch)).run(local);
    expect(
      sent.map(({ command }) =>
        command.kind === "importFolder" ? command.folder.id : null,
      ),
    ).toEqual([parent.id, child.id]);
  });

  it("refuses a workspace whose folders form a cycle", async () => {
    const local = await browser();
    const study = await local.createFolder(null, "Study room");
    const library = await local.createFolder(study.id, "Library");
    const snapshot = local.getSnapshot();
    vi.spyOn(local, "getSnapshot").mockReturnValue({
      ...snapshot,
      folders: new Map(snapshot.folders).set(study.id, {
        ...study,
        parentId: library.id as FolderId,
      }),
    });
    const { fetch } = importServer();
    await expect((await importer(fetch)).run(local)).rejects.toThrow(
      "folder cycle",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names each import by its content so another device's retry repeats it", async () => {
    const local = await browser();
    await local.createDrawing({ folderId: null, name: "Study group" });
    const first = importServer();
    const second = importServer();
    await (await importer(first.fetch)).run(local);
    await (await importer(second.fetch)).run(local);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0].requestId).toMatch(/^import-[0-9a-f]{64}$/);
    expect(second.sent.map(({ requestId }) => requestId)).toEqual([
      first.sent[0].requestId,
    ]);
  });

  it("skips drawings the server refuses and counts them as still pending", async () => {
    const local = await browser();
    const refused = await local.createDrawing({
      folderId: null,
      name: "Too much Chang",
    });
    await local.createDrawing({ folderId: null, name: "Study group" });
    const { fetch } = importServer(["Too much Chang"]);
    const account = await importer(fetch);
    expect(await account.pending(local)).toBe(2);
    const result = await account.run(local);
    expect(result.imported).toBe(1);
    expect(result.skipped.map(({ id }) => id)).toEqual([refused.id]);
    expect(await account.pending(local)).toBe(1);
  });

  it("shares one run between overlapping calls", async () => {
    const local = await browser();
    await local.createDrawing({ folderId: null, name: "Study group" });
    const { sent, fetch } = importServer();
    const account = await importer(fetch);
    const running = account.run(local);
    expect(account.run(local)).toBe(running);
    await running;
    expect(sent).toHaveLength(1);
  });
});
