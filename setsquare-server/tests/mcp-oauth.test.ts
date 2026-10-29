import { createHash } from "node:crypto";

import { migrate } from "../src/database";

import { account, config, testDatabase, testServer } from "./helpers";

import type { FastifyInstance } from "fastify";
import type { TestAccount } from "./helpers";

let db: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
let troy: TestAccount;
let abed: TestAccount;
let now = Date.UTC(2026, 9, 29);
const clock = () => now;
const resource = `${config.origin}/mcp`;
const redirect = "https://client.example/callback";
const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");

beforeAll(async () => {
  db = await testDatabase();
  app = await testServer(db.pool, clock);
});
beforeEach(async () => {
  now = Date.UTC(2026, 9, 29);
  await db.pool.query("TRUNCATE users, mcp_clients CASCADE");
  troy = await account(db.pool, clock);
  abed = await account(db.pool, clock, "102", "abed");
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

const form = (
  url: string,
  payload: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    payload: new URLSearchParams(payload).toString(),
  });

const register = async (method = "none") => {
  const response = await app.inject({
    method: "POST",
    url: "/oauth/register",
    payload: {
      client_name: "Drawing assistant",
      redirect_uris: [redirect],
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
};

const authorization = (clientId: string, extra: Record<string, string> = {}) =>
  `/oauth/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "drawings:read drawings:write",
    resource,
    state: "client-state",
    ...extra,
  })}`;

const consent = async (clientId: string, who = troy) => {
  const response = await app.inject({
    url: authorization(clientId),
    headers: who.headers,
  });
  expect(response.statusCode).toBe(200);
  const nonce = /name="consent" value="([^"]+)"/.exec(response.body)?.[1];
  expect(nonce).toBeTruthy();
  return nonce!;
};

const code = async (clientId: string, who = troy) => {
  const nonce = await consent(clientId, who);
  const response = await form(
    "/oauth/authorize",
    { consent: nonce, csrf_token: who.csrfToken, decision: "allow" },
    who.headers,
  );
  expect(response.statusCode).toBe(303);
  const callback = new URL(String(response.headers.location));
  expect(callback.searchParams.get("state")).toBe("client-state");
  expect(callback.searchParams.get("iss")).toBe(config.origin);
  return callback.searchParams.get("code")!;
};

const exchange = (
  clientId: string,
  code: string,
  extra: Record<string, string> = {},
) =>
  form("/oauth/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
    resource,
    ...extra,
  });
const refresh = (clientId: string, refreshToken: string) =>
  form("/oauth/token", {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    resource,
  });
const connect = async () => {
  const client = await register();
  const authorizationCode = await code(client.client_id);
  const response = await exchange(client.client_id, authorizationCode);
  expect(response.statusCode).toBe(200);
  return { client, code: authorizationCode, tokens: response.json() };
};
const mcp = async (
  token: string,
  method: string,
  params: unknown = {},
  server = app,
) => {
  const response = await server.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      host: new URL(config.origin).host,
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    },
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
  const event = response.body
    .split("\n")
    .find((line) => line.startsWith("data: "));
  return {
    response,
    body: event ? JSON.parse(event.slice(6)) : response.json(),
  };
};

it("completes OAuth and persists isolated, retryable, revision-checked MCP edits", async () => {
  const { tokens } = await connect();
  const args = { requestId: "create-plan", drawingId: "plan", name: "Plan" };
  const create = () =>
    mcp(tokens.access_token, "tools/call", {
      name: "create_drawing",
      arguments: args,
    });
  expect((await create()).body.result.isError).toBeUndefined();
  expect((await create()).body.result.isError).toBeUndefined();
  const read = (
    await mcp(tokens.access_token, "tools/call", {
      name: "get_drawing",
      arguments: { drawingId: "plan" },
    })
  ).body.result.structuredContent;
  expect(read.meta.revision).toBe(1);
  const update = {
    requestId: "save-plan",
    drawingId: "plan",
    baseRevision: 1,
    content: {
      ...read.content,
      appState: { ...read.content.appState, name: "Updated" },
    },
  };
  expect(
    (
      await mcp(tokens.access_token, "tools/call", {
        name: "update_drawing",
        arguments: update,
      })
    ).body.result.structuredContent.result.meta.revision,
  ).toBe(2);
  expect(
    (
      await mcp(tokens.access_token, "tools/call", {
        name: "update_drawing",
        arguments: update,
      })
    ).body.result.isError,
  ).toBeUndefined();
  expect(
    (
      await mcp(tokens.access_token, "tools/call", {
        name: "update_drawing",
        arguments: { ...update, requestId: "stale" },
      })
    ).body.result.structuredContent.error,
  ).toBe("conflict");
  const otherClient = await register();
  const otherTokens = (
    await exchange(
      otherClient.client_id,
      await code(otherClient.client_id, abed),
    )
  ).json();
  expect(
    (
      await mcp(otherTokens.access_token, "tools/call", {
        name: "get_drawing",
        arguments: { drawingId: "plan" },
      })
    ).body.result.structuredContent.error,
  ).toBe("not_found");
});

it("returns to consent after sign-in and rejects unregistered redirects and audiences", async () => {
  const client = await register();
  const login = await app.inject(authorization(client.client_id));
  expect(login.statusCode).toBe(302);
  expect(String(login.headers.location)).toContain(
    "/api/auth/github?returnTo=",
  );
  const invalid: Array<Record<string, string>> = [
    { redirect_uri: "https://attacker.example/callback" },
    { resource: "https://other.example/mcp" },
    { scope: "drawings:admin" },
  ];
  for (const extra of invalid) {
    const denied = await app.inject({
      url: authorization(client.client_id, extra),
      headers: troy.headers,
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.headers.location).toBeUndefined();
  }
});

it("binds consent to the session, protects it from CSRF, and consumes it once", async () => {
  const client = await register();
  const nonce = await consent(client.client_id);
  const input = {
    consent: nonce,
    csrf_token: troy.csrfToken,
    decision: "allow",
  };
  expect(
    (
      await form(
        "/oauth/authorize",
        { ...input, csrf_token: "wrong" },
        troy.headers,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await form(
        "/oauth/authorize",
        { ...input, csrf_token: abed.csrfToken },
        abed.headers,
      )
    ).statusCode,
  ).toBe(400);
  expect((await form("/oauth/authorize", input, troy.headers)).statusCode).toBe(
    303,
  );
  expect((await form("/oauth/authorize", input, troy.headers)).statusCode).toBe(
    400,
  );
  const denied = await form(
    "/oauth/authorize",
    { ...input, consent: await consent(client.client_id), decision: "deny" },
    troy.headers,
  );
  expect(
    new URL(String(denied.headers.location)).searchParams.get("error"),
  ).toBe("access_denied");
});

it("binds authorization codes to the client, redirect, resource and PKCE verifier", async () => {
  const client = await register();
  const other = await register();
  const authorizationCode = await code(client.client_id);
  for (const [id, extra] of [
    [other.client_id, {}],
    [client.client_id, { code_verifier: "w".repeat(64) }],
    [client.client_id, { redirect_uri: "https://attacker.example/callback" }],
    [client.client_id, { resource: "https://other.example/mcp" }],
  ] as Array<[string, Record<string, string>]>) {
    expect((await exchange(id, authorizationCode, extra)).statusCode).toBe(400);
  }
  expect((await exchange(client.client_id, authorizationCode)).statusCode).toBe(
    200,
  );
});

it("revokes the grant when an authorization code is replayed", async () => {
  const connection = await connect();
  expect(
    (await exchange(connection.client.client_id, connection.code)).json().error,
  ).toBe("invalid_grant");
  expect(
    (await mcp(connection.tokens.access_token, "ping")).response.statusCode,
  ).toBe(401);
});

it("rotates refresh tokens and revokes their family on replay", async () => {
  const { client, tokens } = await connect();
  const rotated = await refresh(client.client_id, tokens.refresh_token);
  expect(rotated.statusCode).toBe(200);
  expect(rotated.json().refresh_token).not.toBe(tokens.refresh_token);
  expect(
    (await mcp(rotated.json().access_token, "ping")).response.statusCode,
  ).toBe(200);
  expect(
    (await refresh(client.client_id, tokens.refresh_token)).json().error,
  ).toBe("invalid_grant");
  expect(
    (await mcp(rotated.json().access_token, "ping")).response.statusCode,
  ).toBe(401);
  expect(
    (await refresh(client.client_id, rotated.json().refresh_token)).statusCode,
  ).toBe(400);
});

it("expires access tokens, grants and authorization codes", async () => {
  const { client, tokens } = await connect();
  now += 16 * 60_000;
  expect((await mcp(tokens.access_token, "ping")).response.statusCode).toBe(
    401,
  );
  const rotated = (
    await refresh(client.client_id, tokens.refresh_token)
  ).json();
  expect(rotated.access_token).toBeTruthy();
  const authorizationCode = await code(client.client_id);
  now += 6 * 60_000;
  expect((await exchange(client.client_id, authorizationCode)).statusCode).toBe(
    400,
  );
  now += 31 * 24 * 60 * 60_000;
  expect(
    (await refresh(client.client_id, rotated.refresh_token)).statusCode,
  ).toBe(400);
});

it("authenticates confidential clients and stores only hashed secrets and tokens", async () => {
  const client = await register("client_secret_basic");
  const authorizationCode = await code(client.client_id);
  expect((await exchange(client.client_id, authorizationCode)).statusCode).toBe(
    401,
  );
  const response = await form(
    "/oauth/token",
    {
      grant_type: "authorization_code",
      code: authorizationCode,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource,
    },
    {
      authorization: `Basic ${Buffer.from(
        `${client.client_id}:${client.client_secret}`,
      ).toString("base64")}`,
    },
  );
  expect(response.statusCode).toBe(200);
  const storedClient = (
    await db.pool.query("SELECT secret_hash FROM mcp_clients WHERE id = $1", [
      client.client_id,
    ])
  ).rows[0];
  expect(storedClient.secret_hash).toBe(
    createHash("sha256").update(client.client_secret).digest("hex"),
  );
  const storedTokens = (
    await db.pool.query("SELECT token_hash FROM mcp_tokens")
  ).rows.map((row) => row.token_hash);
  expect(storedTokens).not.toContain(response.json().access_token);
  expect(storedTokens).not.toContain(response.json().refresh_token);
});

it("revokes access through OAuth or the account's connections page", async () => {
  const { client, tokens } = await connect();
  const stranger = await register();
  expect(
    (
      await form("/oauth/revoke", {
        client_id: stranger.client_id,
        token: tokens.refresh_token,
      })
    ).statusCode,
  ).toBe(200);
  expect((await mcp(tokens.access_token, "ping")).response.statusCode).toBe(
    200,
  );
  expect(
    (
      await form("/oauth/revoke", {
        client_id: client.client_id,
        token: tokens.refresh_token,
      })
    ).statusCode,
  ).toBe(200);
  expect((await mcp(tokens.access_token, "ping")).response.statusCode).toBe(
    401,
  );
  const second = await connect();
  const page = await app.inject({
    url: "/oauth/connections",
    headers: troy.headers,
  });
  const grantId = /name="grant_id" value="([^"]+)"/.exec(page.body)![1];
  await form(
    "/oauth/connections",
    { grant_id: grantId, csrf_token: abed.csrfToken },
    abed.headers,
  );
  expect(
    (await mcp(second.tokens.access_token, "ping")).response.statusCode,
  ).toBe(200);
  await form(
    "/oauth/connections",
    { grant_id: grantId, csrf_token: troy.csrfToken },
    troy.headers,
  );
  expect(
    (await mcp(second.tokens.access_token, "ping")).response.statusCode,
  ).toBe(401);
});

it("shares grants across instances and applies migrations idempotently", async () => {
  const { tokens } = await connect();
  await migrate(db.pool);
  expect(
    (
      await db.pool.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
    ).rows,
  ).toEqual([{ version: 1 }, { version: 2 }]);
  const second = await testServer(db.pool, clock);
  try {
    expect(
      (await mcp(tokens.access_token, "ping", {}, second)).response.statusCode,
    ).toBe(200);
  } finally {
    await second.close();
  }
});

it("serializes simultaneous refreshes and rejects scope escalation", async () => {
  const { client, tokens } = await connect();
  const replies = await Promise.all([
    refresh(client.client_id, tokens.refresh_token),
    refresh(client.client_id, tokens.refresh_token),
  ]);
  expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 400]);
  const issued = replies.find((reply) => reply.statusCode === 200)!.json();
  expect((await mcp(issued.access_token, "ping")).response.statusCode).toBe(
    401,
  );
  const another = await connect();
  const reduced = await form("/oauth/token", {
    grant_type: "refresh_token",
    client_id: another.client.client_id,
    refresh_token: another.tokens.refresh_token,
    resource,
    scope: "drawings:read",
  });
  expect(reduced.statusCode).toBe(200);
  const expanded = await form("/oauth/token", {
    grant_type: "refresh_token",
    client_id: another.client.client_id,
    refresh_token: reduced.json().refresh_token,
    resource,
    scope: "drawings:read drawings:write",
  });
  expect(expanded.json().error).toBe("invalid_scope");
});
