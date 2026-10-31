import { createHash } from "node:crypto";

import { migrate } from "../src/database";
import { McpOAuthStore, registrationSource } from "../src/mcp/oauth-store";

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

const registration = (
  method = "none",
  server = app,
  remoteAddress = "127.0.0.1",
  headers: Record<string, string> = {},
) =>
  server.inject({
    method: "POST",
    url: "/oauth/register",
    remoteAddress,
    headers,
    payload: {
      client_name: "Drawing assistant",
      redirect_uris: [redirect],
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
    },
  });

const register = async (method = "none") => {
  const response = await registration(method);
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

const consent = async (
  clientId: string,
  who = troy,
  extra: Record<string, string> = {},
) => {
  const response = await app.inject({
    url: authorization(clientId, extra),
    headers: who.headers,
  });
  expect(response.statusCode).toBe(200);
  const nonce = /name="consent" value="([^"]+)"/.exec(response.body)?.[1];
  expect(nonce).toBeTruthy();
  return nonce!;
};

const code = async (
  clientId: string,
  who = troy,
  scope = "drawings:read drawings:write",
) => {
  const nonce = await consent(clientId, who);
  const response = await form(
    "/oauth/authorize",
    { consent: nonce, csrf_token: who.csrfToken, decision: "allow", scope },
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

it("stores lone surrogates from client names and MCP edits as U+FFFD", async () => {
  const registration = await app.inject({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "\ud800", redirect_uris: [redirect] },
  });
  expect(registration.statusCode).toBe(201);
  expect(registration.json().client_name).toBe("\ufffd");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/oauth/register",
        payload: { redirect_uris: [`${redirect}\ud83d`] },
      })
    ).statusCode,
  ).toBe(400);
  const { tokens } = await connect();
  await mcp(tokens.access_token, "tools/call", {
    name: "create_drawing",
    arguments: { requestId: "create-plan", drawingId: "plan", name: "Plan" },
  });
  const read = (
    await mcp(tokens.access_token, "tools/call", {
      name: "get_drawing",
      arguments: { drawingId: "plan" },
    })
  ).body.result.structuredContent;
  const update = () =>
    mcp(tokens.access_token, "tools/call", {
      name: "update_drawing",
      arguments: {
        requestId: "save-plan",
        drawingId: "plan",
        baseRevision: 1,
        content: {
          ...read.content,
          appState: { ...read.content.appState, name: "Launch \ud83d" },
        },
      },
    });
  const saved = (await update()).body.result;
  expect(saved.isError).toBeUndefined();
  expect(saved.structuredContent.result.meta.name).toBe("Launch \ufffd");
  expect((await update()).body.result.structuredContent).toEqual(
    saved.structuredContent,
  );
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

it("offers read-only or read-and-edit consent only for requested permissions", async () => {
  const client = await register();
  const page = await app.inject({
    url: authorization(client.client_id),
    headers: troy.headers,
  });
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain(
    'type="radio" name="scope" value="drawings:read">',
  );
  expect(page.body).toContain(
    'type="radio" name="scope" value="drawings:read drawings:write" checked>',
  );
  for (const explicit of [true, false]) {
    const url = new URL(
      authorization(client.client_id, { scope: "drawings:read" }),
      config.origin,
    );
    if (!explicit) {
      url.searchParams.delete("scope");
    }
    const readOnly = await app.inject({
      url: `${url.pathname}${url.search}`,
      headers: troy.headers,
    });
    expect(readOnly.statusCode).toBe(200);
    expect(readOnly.body).toContain(
      'type="radio" name="scope" value="drawings:read" checked>',
    );
    expect(readOnly.body).not.toContain("drawings:write");
  }
});

it.each(["drawings:read", "drawings:read drawings:write"])(
  "grants and refreshes the selected permissions: %s",
  async (scope) => {
    const client = await register();
    const authorizationCode = await code(client.client_id, troy, scope);
    const response = await exchange(client.client_id, authorizationCode);
    expect(response.statusCode).toBe(200);
    const tokens = response.json();
    expect(tokens.scope).toBe(scope);
    const refreshed = await refresh(client.client_id, tokens.refresh_token);
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().scope).toBe(scope);

    const canWrite = scope.includes("drawings:write");
    for (const token of [tokens.access_token, refreshed.json().access_token]) {
      const read = await mcp(token, "tools/call", {
        name: "list_workspace",
        arguments: {},
      });
      expect(read.response.statusCode).toBe(200);
      expect(read.body.result.isError).toBeUndefined();
      const write = await mcp(token, "tools/call", {
        name: "create_folder",
        arguments: {
          requestId: "consented",
          folderId: "folder",
          name: "Plans",
        },
      });
      expect(write.response.statusCode).toBe(canWrite ? 200 : 403);
      if (canWrite) {
        expect(write.body.result.isError).toBeUndefined();
      } else {
        expect(write.response.headers["www-authenticate"]).toContain(
          'scope="drawings:read drawings:write", error="insufficient_scope"',
        );
      }
    }
    const connections = await app.inject({
      url: "/oauth/connections",
      headers: troy.headers,
    });
    expect(connections.body).toContain(
      canWrite ? "Read and edit drawings" : "Read drawings",
    );
    if (!canWrite) {
      const expanded = await form("/oauth/token", {
        grant_type: "refresh_token",
        client_id: client.client_id,
        refresh_token: refreshed.json().refresh_token,
        resource,
        scope: "drawings:read drawings:write",
      });
      expect(expanded.statusCode).toBe(400);
      expect(expanded.json().error).toBe("invalid_scope");
    }
  },
);

it("rejects missing, invalid, and unrequested consent scopes without issuing a grant", async () => {
  const client = await register();
  const nonce = await consent(client.client_id, troy, {
    scope: "drawings:read",
  });
  const input = {
    consent: nonce,
    csrf_token: troy.csrfToken,
    decision: "allow",
  };
  for (const scope of [
    undefined,
    "",
    "drawings:admin",
    "drawings:write",
    "drawings:read drawings:write",
  ]) {
    const rejected = await form(
      "/oauth/authorize",
      { ...input, ...(scope === undefined ? {} : { scope }) },
      troy.headers,
    );
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe(
      scope ? "invalid_scope" : "invalid_request",
    );
    expect(rejected.headers.location).toBeUndefined();
  }
  expect((await db.pool.query("SELECT id FROM mcp_grants")).rows).toEqual([]);
  expect(
    (await db.pool.query("SELECT token_hash FROM mcp_codes")).rows,
  ).toEqual([]);
  const approved = await form(
    "/oauth/authorize",
    { ...input, scope: "drawings:read" },
    troy.headers,
  );
  expect(approved.statusCode).toBe(303);
  const callback = new URL(String(approved.headers.location));
  const tokens = await exchange(
    client.client_id,
    callback.searchParams.get("code")!,
  );
  expect(tokens.json().scope).toBe("drawings:read");
});

it("binds consent to the session, protects it from CSRF, and consumes it once", async () => {
  const client = await register();
  const nonce = await consent(client.client_id);
  const input = {
    consent: nonce,
    csrf_token: troy.csrfToken,
    decision: "allow",
    scope: "drawings:read drawings:write",
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
    {
      consent: await consent(client.client_id),
      csrf_token: troy.csrfToken,
      decision: "deny",
    },
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
  ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  const second = await testServer(db.pool, clock);
  try {
    expect(
      (await mcp(tokens.access_token, "ping", {}, second)).response.statusCode,
    ).toBe(200);
  } finally {
    await second.close();
  }
});

it("rejects MCP access tokens of accounts outside the allowlist", async () => {
  const { tokens } = await connect();
  const closed = await testServer(db.pool, clock, {
    allowedGithubIds: ["102"],
  });
  const open = await testServer(db.pool, clock, { allowedGithubIds: ["101"] });
  try {
    expect(
      (await mcp(tokens.access_token, "ping", {}, closed)).response.statusCode,
    ).toBe(401);
    expect(
      (await mcp(tokens.access_token, "ping", {}, open)).response.statusCode,
    ).toBe(200);
  } finally {
    await closed.close();
    await open.close();
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

it("limits client registrations to 30 per source address per hour", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 30; i++) {
    statuses.push((await registration()).statusCode);
  }
  expect(statuses).toEqual(Array(30).fill(201));
  const limited = await registration();
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toEqual({
    error: "temporarily_unavailable",
    error_description: expect.any(String),
  });
  expect((await registration("none", app, "127.0.0.2")).statusCode).toBe(201);
  now += 61 * 60_000;
  expect((await registration()).statusCode).toBe(201);
});

it("counts registrations by forwarded address only when the proxy is trusted", async () => {
  const proxied = await testServer(db.pool, clock, { trustProxy: 1 });
  try {
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await registration("none", proxied, "10.0.0.1", {
            "x-forwarded-for": "198.51.100.1",
          })
        ).statusCode,
      ).toBe(201);
    }
    expect(
      (
        await registration("none", proxied, "10.0.0.1", {
          "x-forwarded-for": "198.51.100.1",
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await registration("none", proxied, "10.0.0.1", {
          "x-forwarded-for": "203.0.113.7",
        })
      ).statusCode,
    ).toBe(201);
    for (let i = 0; i < 29; i++) {
      expect(
        (
          await registration("none", app, "10.0.0.2", {
            "x-forwarded-for": `198.51.100.${i}`,
          })
        ).statusCode,
      ).toBe(201);
    }
    expect(
      (
        await registration("none", app, "10.0.0.2", {
          "x-forwarded-for": "203.0.113.7",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await registration("none", app, "10.0.0.2", {
          "x-forwarded-for": "203.0.113.8",
        })
      ).statusCode,
    ).toBe(429);
  } finally {
    await proxied.close();
  }
});

it("counts IPv6 registrations by /64 and IPv4-mapped ones as IPv4", () => {
  expect(registrationSource("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
  expect(registrationSource("2001:DB8:1:2:ffff:abcd:1:9")).toBe(
    "2001:db8:1:2::/64",
  );
  expect(registrationSource("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
  expect(registrationSource("::1")).toBe("0:0:0:0::/64");
  expect(registrationSource("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  expect(registrationSource("::ffff:203.0.113.5")).toBe("203.0.113.5");
  expect(registrationSource("::ffff:cb00:7105")).toBe("203.0.113.5");
  expect(registrationSource("203.0.113.5")).toBe("203.0.113.5");
});

it("purges never-authorized clients after a day and keeps authorized ones", async () => {
  const store = new McpOAuthStore(db.pool, resource, clock);
  const clients = async () =>
    (await db.pool.query("SELECT id FROM mcp_clients")).rows
      .map((row) => row.id)
      .sort();
  await register();
  const pending = await register();
  const denied = await register();
  await form(
    "/oauth/authorize",
    {
      consent: await consent(denied.client_id),
      csrf_token: troy.csrfToken,
      decision: "deny",
    },
    troy.headers,
  );
  const { client: authorized } = await connect();
  now += 25 * 60 * 60_000;
  await consent(pending.client_id);
  const fresh = await register();
  await store.collect();
  expect(await clients()).toEqual(
    [pending, authorized, fresh].map((client) => client.client_id).sort(),
  );
  now += 31 * 24 * 60 * 60_000;
  await store.collect();
  expect(
    (await db.pool.query("SELECT count(*)::int AS count FROM mcp_grants"))
      .rows[0].count,
  ).toBe(0);
  expect(await clients()).toEqual([authorized.client_id]);
  expect(
    (await app.inject({ url: authorization(authorized.client_id) })).headers
      .location,
  ).toMatch(/^\/api\/auth\/github\?/);
});
