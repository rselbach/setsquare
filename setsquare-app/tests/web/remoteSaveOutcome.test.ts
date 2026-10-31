import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { AppState } from "@setsquare/setsquare/types";

import { commandSchema } from "../../../setsquare-server/src/validation";
import { createDrawingPersistence } from "../../web/drawingPersistence";
import { imageFileIds } from "../../web/persistence/saveContent";
import { replayUnsaved } from "../../web/unsavedJournal";
import { parseFiles } from "../../workspace/remote/parse";
import { RemoteWorkspaceStore } from "../../workspace/remote/RemoteWorkspaceStore";
import { newDrawingMeta } from "../../workspace/types";
import { contentWith } from "../workspace/helpers";

import type { CommandResponse } from "../../workspace/api";
import type { SaveResult } from "../../workspace/types";

const appState: AppState = {
  ...getDefaultAppState(),
  width: 800,
  height: 600,
  offsetTop: 0,
  offsetLeft: 0,
  name: "Request outcomes",
};
const stores: RemoteWorkspaceStore[] = [];
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  localStorage.clear();
});

// Only the HTTP boundary is simulated. Persistence, image fallback, account
// caching, request serialization and transport retries use production code.
const fixture = async () => {
  let meta = newDrawingMeta(
    { name: appState.name, folderId: null, fileIds: [] },
    1000,
  );
  let content = contentWith(appState.name, "original");
  const [image] = parseFiles({
    files: [
      {
        id: "cached-image",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,AAAA",
        created: 1000,
      },
    ],
  }).files;
  const failures: {
    files: "offline" | "invalid" | null;
    command:
      | "lost-response"
      | "server-error"
      | "expired"
      | "missing-files"
      | null;
  } = { files: null, command: null };
  const requests: ReturnType<typeof commandSchema.parse>[] = [];
  const receipts = new Map<string, CommandResponse>();
  const onSessionExpired = vi.fn();
  let uploads = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/workspace") {
      return response({ folders: [], drawings: [meta] });
    }
    if (path.startsWith("/api/drawings/")) {
      return response({ meta, content });
    }
    if (path.startsWith("/api/files")) {
      if (init?.method === "POST") {
        uploads++;
      }
      if (failures.files === "offline") {
        throw new TypeError("Image upload connection lost");
      }
      if (failures.files === "invalid") {
        return response({ error: "invalid_image" }, 400);
      }
      return response({ files: [image] });
    }
    if (path !== "/api/commands") {
      throw new Error(`Unexpected request: ${path}`);
    }
    const request = commandSchema.parse(JSON.parse(String(init?.body)));
    requests.push(request);
    if (failures.command === "expired") {
      return response({ error: "csrf_failed" }, 403);
    }
    if (failures.command === "missing-files") {
      failures.command = null;
      failures.files = "offline";
      return response({ error: "missing_files" }, 400);
    }
    const receipt = receipts.get(request.requestId);
    if (receipt) {
      return response(receipt);
    }
    const { command } = request;
    if (command.kind !== "saveDrawing") {
      throw new Error(`Unexpected command: ${command.kind}`);
    }
    const saved: SaveResult =
      command.baseRevision === meta.revision
        ? {
            ok: true,
            meta: {
              ...meta,
              revision: meta.revision + 1,
              fileIds: imageFileIds(command.content.elements),
            },
          }
        : { ok: false, reason: "conflict", meta };
    if (saved.ok) {
      meta = saved.meta;
      content = command.content;
    }
    const result: CommandResponse = {
      result: { kind: "save", result: saved },
      snapshot: { folders: [], drawings: [meta] },
    };
    receipts.set(request.requestId, result);
    if (failures.command === "lost-response") {
      failures.command = "expired";
      throw new TypeError("Command committed but acknowledgement was lost");
    }
    if (failures.command === "server-error") {
      failures.command = "expired";
      return response({ error: "proxy_failed_after_commit" }, 503);
    }
    return response(result);
  };
  // opens the account as a page load does, with any recovery draft
  const load = async () => {
    const store = await RemoteWorkspaceStore.open({
      session: {
        kind: "signedIn",
        user: {
          id: `outcomes-${meta.id}`,
          login: "troy-barnes",
          name: "Troy Barnes",
          avatarUrl: "https://avatars.githubusercontent.com/u/123",
        },
        csrfToken: "outcome-tests",
      },
      ownerWindow: window,
      onSessionExpired,
      fetch,
    });
    stores.push(store);
    const drawing = await store.openDrawing(meta.id);
    if (!drawing) {
      throw new Error("The fixture drawing is missing");
    }
    const persistence = createDrawingPersistence({
      store,
      drawing: await replayUnsaved(store, drawing),
      ownerWindow: window,
      onNotFound: vi.fn(),
    });
    return { store, persistence };
  };
  const { store, persistence } = await load();
  return {
    store,
    persistence,
    load,
    image,
    failures,
    requests,
    onSessionExpired,
    saved: () => ({ meta, content }),
    uploads: () => uploads,
  };
};

it.each(["cached fallback", "missing_files repair"])(
  "releases content when image preparation fails during %s",
  async (source) => {
    const { store, persistence, image, failures, requests, saved, uploads } =
      await fixture();
    await store.stageFiles({ [image.id]: image });
    if (source === "cached fallback") {
      failures.files = "offline";
    } else {
      failures.command = "missing-files";
    }
    const loaded = await persistence.fileStorage.getFiles([image.id]);
    expect(loaded.loadedFiles).toEqual([image]);
    expect(persistence.fileStorage.isFileSaved(image)).toBe(true);
    persistence.save(
      [API.createElement({ type: "image", fileId: image.id })],
      appState,
      { [image.id]: image },
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("error");
    expect(uploads()).toBe(2);
    expect(requests).toHaveLength(source === "cached fallback" ? 0 : 1);

    failures.files = "invalid";
    persistence.save(
      contentWith(appState.name, "corrected").elements,
      appState,
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(uploads()).toBe(2);
    expect(saved().content.elements.map((element) => element.id)).toEqual([
      "corrected",
    ]);
    expect(persistence.unsaved()).toBeNull();
  },
);

it.each(["lost-response", "server-error"] as const)(
  "recovers the same receipt on reload after %s followed by an internal authentication refusal",
  async (failure) => {
    const {
      store,
      persistence,
      load,
      failures,
      requests,
      onSessionExpired,
      saved,
    } = await fixture();
    failures.command = failure;
    persistence.save(
      contentWith(appState.name, "committed").elements,
      appState,
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("expired");
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(saved().meta.revision).toBe(2);

    failures.command = null;
    await persistence.retry();
    expect(requests).toHaveLength(2);

    store.close();
    const reloaded = (await load()).persistence;
    await reloaded.retry();
    expect(reloaded.getSaveState().kind).toBe("saved");
    expect(requests[2]).toEqual(requests[0]);
    expect(saved().content.elements.map((element) => element.id)).toEqual([
      "committed",
    ]);
    expect(reloaded.unsaved()).toBeNull();
  },
);
