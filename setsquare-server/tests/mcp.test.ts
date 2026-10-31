import { randomUUID } from "node:crypto";

import { vi } from "vitest";

import { SessionDatabase } from "../src/auth";
import { FileDatabase } from "../src/files";
import {
  McpOAuthStore,
  READ_SCOPE,
  WRITE_SCOPE,
  authorizationSchema,
  clientMetadataSchema,
} from "../src/mcp/oauth-store";
import { WorkspaceDatabase } from "../src/workspace";
import {
  drawingMetaSchema,
  folderSchema,
  thumbnailSchema,
  filesSchema,
} from "../src/validation";

import { config, content, pixel, testServer } from "./helpers";

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

const userId = randomUUID();
const access = "a".repeat(43);
let app: FastifyInstance;
let pool: Pool;
const now = () => Date.UTC(2026, 9, 29);
const headers = {
  host: new URL(config.origin).host,
  authorization: `Bearer ${access}`,
  accept: "application/json, text/event-stream",
};
const grant = () => ({
  id: randomUUID(),
  user_id: userId,
  client_id: "test-client",
  resource: `${config.origin}/mcp`,
  scopes: [READ_SCOPE, WRITE_SCOPE],
  expires_at: String(now() + 60_000),
  access_expires_at: String(now() + 60_000),
  revoked_at: null,
});
const meta = (id = "drawing", folderId: string | null = null) =>
  drawingMetaSchema.parse({
    id,
    name: "Plan",
    folderId,
    revision: 1,
    fileIds: [],
    createdAt: now(),
    updatedAt: now(),
    openedAt: null,
    trashedAt: null,
  });

beforeEach(async () => {
  vi.spyOn(McpOAuthStore.prototype, "verify").mockResolvedValue(grant());
  // HTTP/protocol tests fail if a database call escapes its mocked boundary.
  pool = {
    query: vi.fn(() => {
      throw new Error("Unexpected database access");
    }),
  } as unknown as Pool;
  app = await testServer(pool, now);
});
afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
});

const rpc = async (method: string, params: unknown = {}) => {
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers,
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
  if (String(response.headers["content-type"]).includes("text/event-stream")) {
    const data = response.body
      .split("\n")
      .find((line) => line.startsWith("data: "));
    expect(data, response.body).toBeTruthy();
    return { response, body: JSON.parse(data!.slice(6)) };
  }
  return { response, body: response.json() };
};

it("challenges missing and invalid tokens without accepting browser cookies", async () => {
  for (const extra of [
    {},
    { cookie: "setsquare_session=browser" },
    { authorization: "Bearer invalid" },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { host: headers.host, ...extra },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(
      `${config.origin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(response.headers["www-authenticate"]).toContain(
      `scope="${READ_SCOPE} ${WRITE_SCOPE}"`,
    );
  }
  const unparsed = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { host: headers.host, "content-type": "application/json" },
    payload: "{",
  });
  expect(unparsed.statusCode).toBe(401);
  expect(unparsed.headers["www-authenticate"]).toContain("Bearer");
  vi.mocked(McpOAuthStore.prototype.verify).mockResolvedValue(null);
  expect(
    (await app.inject({ method: "GET", url: "/mcp", headers })).statusCode,
  ).toBe(401);
});

it("publishes discovery for the exact MCP audience and PKCE endpoints", async () => {
  const resource = (
    await app.inject("/.well-known/oauth-protected-resource/mcp")
  ).json();
  expect(resource).toMatchObject({
    resource: `${config.origin}/mcp`,
    authorization_servers: [config.origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [READ_SCOPE, WRITE_SCOPE],
  });
  const metadata = (
    await app.inject("/.well-known/oauth-authorization-server")
  ).json();
  expect(metadata).toMatchObject({
    issuer: config.origin,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    registration_endpoint: `${config.origin}/oauth/register`,
    scopes_supported: [READ_SCOPE, WRITE_SCOPE],
  });
});

it("supports initialization, discovery, notifications, and protocol errors", async () => {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  expect(initialized.response.statusCode).toBe(200);
  expect(initialized.body.result.serverInfo.name).toBe("setsquare");
  expect(initialized.response.headers["mcp-session-id"]).toBeUndefined();
  const tools = await rpc("tools/list");
  expect(
    tools.body.result.tools.map((tool: { name: string }) => tool.name),
  ).toContain("update_drawing");
  const update = tools.body.result.tools.find(
    (tool: { name: string }) => tool.name === "update_drawing",
  );
  expect(update.inputSchema.properties.content.properties.elements.type).toBe(
    "array",
  );
  const notification = await app.inject({
    method: "POST",
    url: "/mcp",
    headers,
    payload: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  expect(notification.statusCode).toBe(202);
  expect((await rpc("not/a/method")).body.error).toBeDefined();
  expect(
    (await rpc("tools/call", { name: "get_drawing", arguments: {} })).body
      .result.isError,
  ).toBe(true);
});

it("serves the current per-request protocol without an initialize handshake", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...headers,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
    },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().result).toBeDefined();
});

it("rejects DNS rebinding and unexpected origins and supports browser preflight", async () => {
  expect(
    (
      await app.inject({
        url: "/mcp",
        headers: { ...headers, host: "attacker.example" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: "/mcp",
        headers: { ...headers, origin: "https://attacker.example" },
      })
    ).statusCode,
  ).toBe(403);
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/mcp",
    headers: { host: headers.host, origin: config.origin },
  });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers["access-control-allow-origin"]).toBe(config.origin);
  expect(
    (await app.inject({ method: "DELETE", url: "/mcp", headers })).statusCode,
  ).toBe(405);
});

it("accepts loopback hosts only in development and never the bind address", async () => {
  const probe = async (server: FastifyInstance, host: string) =>
    (await server.inject({ method: "OPTIONS", url: "/mcp", headers: { host } }))
      .statusCode;
  const production = await testServer(pool, now, { production: true });
  try {
    for (const [host, development, deployed] of [
      [headers.host, 204, 204],
      ["localhost:3002", 204, 403],
      ["127.0.0.1:3002", 204, 403],
      ["[::1]:3002", 204, 403],
      ["0.0.0.0:3002", 403, 403],
    ] as const) {
      expect(await probe(app, host), host).toBe(development);
      expect(await probe(production, host), host).toBe(deployed);
    }
  } finally {
    await production.close();
  }
});

it("challenges writes with read-only tokens before calling workspace code", async () => {
  vi.mocked(McpOAuthStore.prototype.verify).mockResolvedValue({
    ...grant(),
    scopes: [READ_SCOPE],
  });
  const write = vi.spyOn(WorkspaceDatabase.prototype, "command");
  const response = await rpc("tools/call", {
    name: "create_folder",
    arguments: { requestId: "one", folderId: "folder", name: "Plans" },
  });
  expect(response.response.statusCode).toBe(403);
  expect(response.response.headers["www-authenticate"]).toContain(
    'error="insufficient_scope"',
  );
  expect(response.response.headers["www-authenticate"]).toContain(WRITE_SCOPE);
  expect(write).not.toHaveBeenCalled();
});

it("reads only the token's account through tools and drawing resources", async () => {
  const read = vi
    .spyOn(WorkspaceDatabase.prototype, "getDrawing")
    .mockResolvedValue({ meta: meta(), content: content() });
  const result = await rpc("tools/call", {
    name: "get_drawing",
    arguments: { drawingId: "drawing" },
  });
  expect(read).toHaveBeenCalledWith(userId, "drawing");
  expect(result.body.result.structuredContent.url).toBe(
    `${config.origin}/d/drawing`,
  );
  const resource = await rpc("resources/read", {
    uri: "setsquare://drawings/drawing",
  });
  expect(JSON.parse(resource.body.result.contents[0].text).meta.id).toBe(
    "drawing",
  );
  read.mockResolvedValue(null);
  expect(
    (
      await rpc("tools/call", {
        name: "get_drawing",
        arguments: { drawingId: "someone-elses-drawing" },
      })
    ).body.result,
  ).toMatchObject({ isError: true, structuredContent: { error: "not_found" } });
});

it("returns account-owned image content without putting base64 in the text response", async () => {
  const read = vi.spyOn(FileDatabase.prototype, "get").mockResolvedValue({
    ...filesSchema.parse({ files: [pixel] }),
    remaining: ["britta"],
  });
  const { body } = await rpc("tools/call", {
    name: "get_images",
    arguments: { fileIds: [pixel.id, "britta"] },
  });
  expect(read).toHaveBeenCalledWith(userId, [pixel.id, "britta"]);
  expect(body.result.structuredContent.remaining).toEqual(["britta"]);
  expect(body.result.content[1]).toMatchObject({
    type: "image",
    mimeType: "image/png",
    data: pixel.dataURL.split(",")[1],
  });
  expect(body.result.content[0].text).not.toContain("base64");
});

it("preserves revisions and retry IDs and reports conflicts as tool errors", async () => {
  const write = vi
    .spyOn(WorkspaceDatabase.prototype, "command")
    .mockResolvedValue({
      kind: "save",
      result: {
        ok: false,
        reason: "conflict",
        meta: { ...meta(), revision: 2 },
      },
    });
  const result = await rpc("tools/call", {
    name: "update_drawing",
    arguments: {
      requestId: "retry-id",
      drawingId: "drawing",
      baseRevision: 1,
      content: content(),
    },
  });
  expect(write).toHaveBeenCalledWith(
    userId,
    "retry-id",
    expect.objectContaining({
      kind: "saveDrawing",
      id: "drawing",
      baseRevision: 1,
      fileIds: [],
    }),
  );
  expect(result.body.result).toMatchObject({
    isError: true,
    structuredContent: { error: "conflict", meta: { revision: 2 } },
  });
});

it("paginates matching items and hides descendants of trashed folders", async () => {
  vi.spyOn(WorkspaceDatabase.prototype, "getSnapshot").mockResolvedValue({
    folders: [
      folderSchema.parse({
        id: "trash",
        parentId: null,
        name: "Trash",
        createdAt: now(),
        updatedAt: now(),
        trashedAt: now(),
      }),
    ],
    drawings: [meta("a"), meta("b"), meta("hidden", "trash")],
  });
  const first = (
    await rpc("tools/call", {
      name: "list_workspace",
      arguments: { limit: 1, query: "plan" },
    })
  ).body.result.structuredContent;
  expect(first.items.map((item: { id: string }) => item.id)).toEqual(["a"]);
  const second = (
    await rpc("tools/call", {
      name: "list_workspace",
      arguments: { limit: 1, query: "plan", cursor: first.nextCursor },
    })
  ).body.result.structuredContent;
  expect(second.items.map((item: { id: string }) => item.id)).toEqual(["b"]);
  expect(second.nextCursor).toBeNull();
});

it("does not return stale previews or internal database errors", async () => {
  vi.spyOn(WorkspaceDatabase.prototype, "getDrawing").mockResolvedValue({
    meta: { ...meta(), revision: 2 },
    content: content(),
  });
  vi.spyOn(WorkspaceDatabase.prototype, "getThumbnails").mockResolvedValue([
    [
      "drawing",
      thumbnailSchema.parse({ revision: 1, src: "data:image/png;base64,AAAA" }),
    ],
  ]);
  expect(
    (
      await rpc("tools/call", {
        name: "get_drawing_preview",
        arguments: { drawingId: "drawing" },
      })
    ).body.result.structuredContent.error,
  ).toBe("preview_unavailable");
  vi.mocked(WorkspaceDatabase.prototype.getDrawing).mockRejectedValue(
    new Error("secret SQL record"),
  );
  const failed = await rpc("tools/call", {
    name: "get_drawing",
    arguments: { drawingId: "drawing" },
  });
  expect(failed.body.result.isError).toBe(true);
  expect(failed.response.body).not.toContain("secret SQL");
});

it("logs unexpected tool failures once and advises a retry only for transient ones", async () => {
  const log = vi.spyOn(app.log, "error");
  const rename = () =>
    rpc("tools/call", {
      name: "rename_folder",
      arguments: { requestId: "r1", folderId: "f1", name: "Study Room F" },
    });
  vi.spyOn(WorkspaceDatabase.prototype, "command").mockRejectedValueOnce({
    code: "40001",
  });
  const transient = await rename();
  expect(transient.body.result.structuredContent).toMatchObject({
    error: "server_error",
    retryable: true,
  });
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    {
      requestId: expect.any(String),
      tool: "rename_folder",
      errorName: undefined,
      code: "40001",
      message: undefined,
    },
    "MCP tool failed",
  );
  vi.mocked(WorkspaceDatabase.prototype.command).mockRejectedValueOnce(
    Object.assign(new Error("invalid input syntax for type json"), {
      name: "DatabaseError",
      code: "22P02",
      detail: "Token Greendale is invalid",
    }),
  );
  const permanent = await rename();
  expect(permanent.body.result.structuredContent).toEqual({
    error: "server_error",
    retryable: false,
    message:
      "The server could not complete this request. Retrying the same arguments will not help.",
  });
  expect(permanent.response.body).not.toContain("invalid input syntax");
  expect(log).toHaveBeenCalledTimes(2);
  expect(log.mock.calls[1][0]).toMatchObject({
    tool: "rename_folder",
    errorName: "DatabaseError",
    code: "22P02",
  });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/Study Room F|Greendale/);
});

it("reports stored data that fails its schema as a logged server error", async () => {
  const error = vi.spyOn(app.log, "error");
  const warn = vi.spyOn(app.log, "warn");
  vi.mocked(pool.query).mockResolvedValue({
    rows: [{ data: { folders: [{ id: "f1" }], drawings: [] } }],
  } as never);
  const listed = await rpc("tools/call", {
    name: "list_workspace",
    arguments: {},
  });
  expect(listed.body.result.structuredContent).toMatchObject({
    error: "server_error",
    retryable: false,
  });
  expect(error).toHaveBeenCalledOnce();
  expect(error.mock.calls[0][0]).toMatchObject({
    tool: "list_workspace",
    errorName: "StoredDataError",
  });
  const read = await rpc("resources/read", {
    uri: "setsquare://drawings/drawing",
  });
  expect(read.body.error.message).toContain("The drawing could not be read");
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({
      resource: "drawing",
      errorName: "StoredDataError",
    }),
    "MCP resource read failed",
  );
});

it("requires HTTPS or loopback redirects and S256 PKCE", () => {
  for (const redirect of [
    "https://client.example/callback#fragment",
    "https://user:password@client.example/callback",
    "http://client.example/callback",
    "data:text/html,untrusted",
  ]) {
    expect(
      clientMetadataSchema.safeParse({ redirect_uris: [redirect] }).success,
    ).toBe(false);
  }
  expect(
    clientMetadataSchema.safeParse({
      redirect_uris: ["http://127.0.0.1:9000/callback"],
      token_endpoint_auth_method: "none",
    }).success,
  ).toBe(true);
  expect(
    authorizationSchema.safeParse({
      response_type: "code",
      client_id: "client",
      redirect_uri: "https://client.example/callback",
      resource: `${config.origin}/mcp`,
      code_challenge: "a".repeat(43),
      code_challenge_method: "plain",
    }).success,
  ).toBe(false);
});

it("escapes consent and requires browser CSRF before approving access", async () => {
  const signedIn = {
    tokenHash: "session",
    csrfToken: "csrf",
    user: {
      id: userId,
      login: "troy",
      name: "Troy",
      avatarUrl: "https://example.test/avatar",
    },
  };
  vi.spyOn(SessionDatabase.prototype, "find").mockResolvedValue(signedIn);
  vi.spyOn(McpOAuthStore.prototype, "authorize").mockResolvedValue({
    ...clientMetadataSchema.parse({
      client_name: "<script>alert(1)</script>",
      redirect_uris: ["https://client.example/callback"],
    }),
    client_id: "client",
    secretHash: null,
  });
  vi.spyOn(McpOAuthStore.prototype, "consent").mockResolvedValue(
    "b".repeat(43),
  );
  const approve = vi
    .spyOn(McpOAuthStore.prototype, "approve")
    .mockResolvedValue("https://client.example/callback?code=code");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: "client",
    redirect_uri: "https://client.example/callback",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    resource: `${config.origin}/mcp`,
  });
  const consent = await app.inject(`/oauth/authorize?${query}`);
  expect(consent.statusCode).toBe(200);
  expect(consent.headers["referrer-policy"]).toBe("same-origin");
  expect(consent.body).toContain("&lt;script&gt;");
  expect(consent.body).not.toContain("<script>");
  expect(consent.headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(consent.headers["content-security-policy"]).toContain(
    "form-action 'self' https://client.example",
  );
  const payload = new URLSearchParams({
    consent: "b".repeat(43),
    decision: "allow",
    scope: READ_SCOPE,
    csrf_token: "csrf",
  }).toString();
  for (const origin of [undefined, "null", "https://attacker.example"]) {
    const denied = await app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
        ...(origin ? { origin } : {}),
      },
      payload,
    });
    expect(denied.statusCode).toBe(403);
  }
  expect(approve).not.toHaveBeenCalled();
  const allowed = await app.inject({
    method: "POST",
    url: "/oauth/authorize",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: config.origin,
      "sec-fetch-site": "same-origin",
    },
    payload,
  });
  expect(allowed.statusCode).toBe(303);
  expect(allowed.headers["referrer-policy"]).toBe("no-referrer");
  expect(approve).toHaveBeenCalledWith(signedIn, {
    consent: "b".repeat(43),
    decision: "allow",
    scope: READ_SCOPE,
  });
});

it("allows same-origin native forms to revoke connected clients", async () => {
  const signedIn = {
    tokenHash: "session",
    csrfToken: "csrf",
    user: {
      id: userId,
      login: "troy",
      name: "Troy",
      avatarUrl: "https://example.test/avatar",
    },
  };
  const grantId = randomUUID();
  vi.spyOn(SessionDatabase.prototype, "find").mockResolvedValue(signedIn);
  vi.spyOn(McpOAuthStore.prototype, "connections").mockResolvedValue([
    { id: grantId, name: "Drawing assistant", scopes: [READ_SCOPE] },
  ]);
  const disconnect = vi
    .spyOn(McpOAuthStore.prototype, "disconnect")
    .mockResolvedValue(undefined);
  const connections = await app.inject("/oauth/connections");
  expect(connections.statusCode).toBe(200);
  expect(connections.headers["referrer-policy"]).toBe("same-origin");
  expect(connections.body).toContain(`name="grant_id" value="${grantId}"`);
  const revoked = await app.inject({
    method: "POST",
    url: "/oauth/connections",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: config.origin,
      "sec-fetch-site": "same-origin",
    },
    payload: new URLSearchParams({
      grant_id: grantId,
      csrf_token: signedIn.csrfToken,
    }).toString(),
  });
  expect(revoked.statusCode).toBe(303);
  expect(revoked.headers.location).toBe("/oauth/connections");
  expect(revoked.headers["referrer-policy"]).toBe("no-referrer");
  expect(disconnect).toHaveBeenCalledWith(userId, grantId);
});

it("rejects repeated OAuth form parameters", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "client_id=a&client_id=b",
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().error).toBe("invalid_request");
});
