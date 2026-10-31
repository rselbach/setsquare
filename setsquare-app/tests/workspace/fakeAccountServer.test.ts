import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";

import { contentWith } from "./helpers";
import { fakeAccountServer } from "./fakeAccountServer";

import type { WorkspaceCommand } from "../../workspace/api";
import type { DrawingContent, DrawingId } from "../../workspace/types";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const OTHER_PNG = "data:image/png;base64,iVBORw0KGgoA";
const id = "greendale" as DrawingId;

const setup = (options?: { fileBudget?: number }) => {
  const server = fakeAccountServer({ userId: "troy", ...options });
  const send = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await server.fetch(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        "X-CSRF-Token": server.session.csrfToken,
        "X-Setsquare-Account": "troy",
        ...headers,
      },
    });
    return { status: response.status, body: await response.json() };
  };
  const command = (requestId: string, command: WorkspaceCommand) =>
    send("POST", "/api/commands", { requestId, command });
  const create = (content: DrawingContent = contentWith("Greendale", "troy")) =>
    command("create", {
      kind: "createDrawing",
      id,
      folderId: null,
      name: "Greendale",
      content,
      fileIds: [],
    });
  const save = (
    requestId: string,
    baseRevision: number,
    content: DrawingContent,
    fileIds: string[] = [],
  ) =>
    command(requestId, {
      kind: "saveDrawing",
      id,
      content,
      fileIds,
      baseRevision,
    });
  const upload = (dataURL: string, version?: number) =>
    send("POST", "/api/files", {
      files: [
        {
          id: "abed-image",
          mimeType: "image/png",
          dataURL,
          created: 1,
          ...(version ? { version } : {}),
        },
      ],
    });
  return { server, send, command, create, save, upload };
};

it("answers a save from an older revision with the current metadata", async () => {
  const { create, save } = setup();
  expect((await create()).status).toBe(200);
  const saved = await save("annie", 1, contentWith("Greendale", "annie"));
  expect(saved.body.result.result).toMatchObject({
    ok: true,
    meta: { revision: 2 },
  });
  const stale = await save("abed", 1, contentWith("Greendale", "abed"));
  expect(stale.status).toBe(200);
  expect(stale.body.result.result).toMatchObject({
    ok: false,
    reason: "conflict",
    meta: { revision: 2 },
  });
  expect(stale.body.snapshot.drawings[0].revision).toBe(2);
});

it("replays a request id's receipt and refuses it for another command", async () => {
  const { server, create, save } = setup();
  await create();
  const first = await save("annie", 1, contentWith("Greendale", "annie"));
  const replay = await save("annie", 1, contentWith("Greendale", "annie"));
  expect(replay).toEqual(first);
  expect(server.drawing(id)?.meta.revision).toBe(2);
  const reused = await save("annie", 1, contentWith("Greendale", "abed"));
  expect(reused).toMatchObject({
    status: 409,
    body: { error: "request_reused" },
  });
});

it("requires declared images to match the drawing and to be uploaded", async () => {
  const { create, save, upload } = setup();
  await create();
  const image = API.createElement({
    type: "image",
    fileId: "abed-image" as FileId,
  });
  const content = { ...contentWith("Greendale"), elements: [image] };
  expect(await save("undeclared", 1, content)).toMatchObject({
    status: 400,
    body: { error: "invalid_files" },
  });
  expect(
    await save("extra", 1, contentWith("Greendale"), ["abed-image"]),
  ).toMatchObject({ status: 400, body: { error: "invalid_files" } });
  expect(await save("missing", 1, content, ["abed-image"])).toMatchObject({
    status: 400,
    body: { error: "missing_files" },
  });
  expect((await upload(PNG)).status).toBe(200);
  expect((await save("saved", 1, content, ["abed-image"])).status).toBe(200);
});

it("refuses other bytes at an uploaded image version", async () => {
  const { server, upload } = setup();
  expect(await upload("data:image/png;base64,AAAA")).toMatchObject({
    status: 400,
    body: { error: "invalid_image" },
  });
  expect((await upload(PNG)).status).toBe(200);
  expect((await upload(PNG)).status).toBe(200);
  expect(await upload(OTHER_PNG)).toMatchObject({
    status: 409,
    body: { error: "image_collision" },
  });
  expect(server.image("abed-image")?.dataURL).toBe(PNG);
  expect((await upload(OTHER_PNG, 2)).status).toBe(200);
  expect(server.image("abed-image")).toMatchObject({
    dataURL: OTHER_PNG,
    version: 2,
  });
});

it("pages image reads at the byte budget", async () => {
  const { send } = setup({ fileBudget: 10 });
  const files = ["annie", "abed"].map((name) => ({
    id: name,
    mimeType: "image/png",
    dataURL: PNG,
    created: 1,
  }));
  expect((await send("POST", "/api/files", { files })).status).toBe(200);
  const page = await send("GET", "/api/files?ids=annie,abed");
  expect(page.body.files.map((file: { id: string }) => file.id)).toEqual([
    "annie",
  ]);
  expect(page.body.remaining).toEqual(["abed"]);
  expect(await send("GET", "/api/files?ids=annie,pierce")).toMatchObject({
    status: 404,
    body: { error: "not_found" },
  });
});

it("authenticates before reading a body", async () => {
  const { server, send, create } = setup();
  await create();
  const huge = { padding: "x".repeat(12 * 1024 * 1024) };
  expect(await send("POST", "/api/commands", huge)).toMatchObject({
    status: 413,
    body: { error: "invalid_request" },
  });
  expect(await send("POST", "/api/commands", { requestId: "x" })).toMatchObject(
    { status: 400, body: { error: "invalid_request" } },
  );
  expect(
    await send("GET", "/api/workspace", undefined, {
      "X-Setsquare-Account": "abed",
    }),
  ).toMatchObject({ status: 401, body: { error: "account_changed" } });

  server.rotateCsrfToken();
  expect((await send("GET", "/api/workspace")).status).toBe(200);
  expect(await send("POST", "/api/commands", huge)).toMatchObject({
    status: 403,
    body: { error: "csrf_failed" },
  });

  server.expireSession();
  expect(await send("GET", `/api/drawings/${id}`)).toMatchObject({
    status: 401,
    body: { error: "unauthenticated" },
  });
});

it("applies a command whose response it loses, and fails or stalls others", async () => {
  const { server, create, send } = setup();
  server.failNext("POST /api/commands", "lost-response");
  await expect(create()).rejects.toThrow(TypeError);
  expect(server.drawing(id)?.meta.revision).toBe(1);

  server.failNext("GET /api/workspace", { status: 503, error: "proxy" });
  expect((await send("GET", "/api/workspace")).status).toBe(503);
  server.failNext("GET /api/workspace", "offline");
  await expect(send("GET", "/api/workspace")).rejects.toThrow(TypeError);
  server.failNext("GET /api/workspace", "stall");
  const stalled = await Promise.race([
    send("GET", "/api/workspace").then(() => "answered"),
    new Promise((resolve) => setTimeout(resolve, 20, "stalled")),
  ]);
  expect(stalled).toBe("stalled");
  expect((await send("GET", "/api/workspace")).status).toBe(200);
});
