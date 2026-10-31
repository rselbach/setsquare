import { createHash } from "node:crypto";

import { GitHubOAuth, SessionDatabase } from "../src/auth";
import { loadConfig } from "../src/config";

import {
  account,
  command,
  config,
  content,
  testDatabase,
  testServer,
} from "./helpers";

import type { FastifyInstance } from "fastify";
import type { TestAccount } from "./helpers";

let db: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
let troy: TestAccount;
let now = 1_700_000_000_000;
const clock = () => now;

beforeAll(async () => {
  db = await testDatabase();
  app = await testServer(db.pool, clock);
});
beforeEach(async () => {
  await db.pool.query("TRUNCATE users, auth_attempts CASCADE");
  now = 1_700_000_000_000;
  troy = await account(db.pool, clock);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await app.close();
  await db.close();
});

it("requires a valid session, CSRF token, origin, and account pin", async () => {
  expect((await app.inject({ url: "/api/workspace" })).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: "/api/workspace",
        headers: { cookie: troy.headers.cookie },
      })
    ).statusCode,
  ).toBe(401);
  const edit = {
    requestId: "create",
    command: {
      kind: "createDrawing",
      id: "plan",
      folderId: null,
      name: "Greendale",
      content: content(),
      fileIds: [],
    },
  };
  const { "x-csrf-token": omitted, ...headers } = troy.headers;
  expect(omitted).toBe(troy.csrfToken);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/commands",
        headers,
        payload: edit,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/commands",
        headers: { ...troy.headers, origin: "https://greendale.example" },
        payload: edit,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/commands",
        headers: { ...troy.headers, "sec-fetch-site": "cross-site" },
        payload: edit,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/commands",
        headers: troy.headers,
        payload: edit,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: "POST", url: "/api/auth/logout", headers }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: troy.headers,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: "/api/workspace", headers: troy.headers }))
      .statusCode,
  ).toBe(401);
});

it("rejects an old tab after another account replaced its cookie", async () => {
  const abed = await account(db.pool, clock, "102", "abed-nadir");
  const staleHeaders = { ...troy.headers, cookie: abed.headers.cookie };
  const response = await app.inject({
    method: "POST",
    url: "/api/commands",
    headers: staleHeaders,
    payload: {
      requestId: "stale",
      command: {
        kind: "createDrawing",
        id: "plan",
        folderId: null,
        name: "Greendale",
        content: content(),
        fileIds: [],
      },
    },
  });
  expect(response.statusCode).toBe(401);
  expect(response.json().error).toBe("account_changed");
  const metadata = await app.inject({
    url: "/api/workspace",
    headers: staleHeaders,
  });
  expect(metadata.statusCode).toBe(401);
  expect(
    (await app.inject({ url: "/api/session", headers: staleHeaders })).json()
      .user.id,
  ).toBe(abed.user.id);
  expect(
    (await app.inject({ url: "/api/workspace", headers: abed.headers })).json()
      .drawings,
  ).toHaveLength(0);
});

it("expires sessions server-side and stores no raw session credential", async () => {
  const stored = await db.pool.query("SELECT token_hash FROM sessions");
  expect(stored.rows[0].token_hash).not.toBe(troy.token);
  expect(stored.rows[0].token_hash).toBe(
    createHash("sha256").update(troy.token).digest("hex"),
  );
  now += 31 * 24 * 60 * 60 * 1000;
  expect(
    (await app.inject({ url: "/api/session", headers: troy.headers })).json(),
  ).toEqual({ kind: "signedOut" });
  expect(
    (await app.inject({ url: "/api/workspace", headers: troy.headers }))
      .statusCode,
  ).toBe(401);
});

it("keeps account identity stable when the GitHub login changes", async () => {
  await command(app, troy, {
    kind: "createFolder",
    id: "campus",
    parentId: null,
    name: "Campus",
  });
  const renamed = await new SessionDatabase(db.pool, clock).create({
    githubId: "101",
    login: "captain-troy",
    name: "Troy Barnes",
    avatarUrl: "https://avatars.githubusercontent.com/u/101",
  });
  expect(renamed.user.id).toBe(troy.user.id);
  expect(renamed.user.login).toBe("captain-troy");
  expect((await db.pool.query("SELECT id FROM users")).rows).toHaveLength(1);
  expect(
    (await app.inject({ url: "/api/workspace", headers: troy.headers })).json()
      .folders,
  ).toHaveLength(1);
});

it("binds OAuth state to the browser and consumes the attempt only once", async () => {
  const login = await app.inject({
    url: "/api/auth/github?returnTo=%2Fd%2Fplan",
  });
  expect(login.statusCode).toBe(302);
  const destination = new URL(login.headers.location ?? "");
  const state = destination.searchParams.get("state");
  expect(state).toBeTruthy();
  const cookie = login.cookies.find(
    (entry) => entry.name === "setsquare_oauth",
  );
  expect(cookie?.httpOnly).toBe(true);
  const callbackUrl = `/api/auth/github/callback?state=${state}&code=greendale`;
  expect((await app.inject({ url: callbackUrl })).statusCode).toBe(400);
  const callback = await app.inject({
    url: callbackUrl,
    headers: { cookie: `setsquare_oauth=${cookie?.value}` },
  });
  expect(callback.statusCode).toBe(302);
  expect(callback.headers.location).toBe("/d/plan");
  const sessionCookie = callback.cookies.find(
    (entry) => entry.name === "setsquare_session",
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
  });
  const loggedIn = await app.inject({
    url: "/api/session",
    headers: { cookie: `setsquare_session=${sessionCookie?.value}` },
  });
  expect(loggedIn.json()).toMatchObject({
    kind: "signedIn",
    user: { id: troy.user.id, login: "troy-barnes" },
  });
  expect(
    (
      await app.inject({
        url: callbackUrl,
        headers: { cookie: `setsquare_oauth=${cookie?.value}` },
      })
    ).statusCode,
  ).toBe(400);
});

it("rejects expired OAuth attempts and external return addresses", async () => {
  expect(
    (
      await app.inject({
        url: "/api/auth/github?returnTo=https%3A%2F%2Fgreendale.example%2F",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        url: "/api/auth/github?returnTo=%2Fapi%2Fauth%2Flogout",
      })
    ).statusCode,
  ).toBe(400);
  const login = await app.inject({ url: "/api/auth/github" });
  const state = new URL(login.headers.location ?? "").searchParams.get("state");
  const cookie = login.cookies.find(
    (entry) => entry.name === "setsquare_oauth",
  );
  now += 11 * 60 * 1000;
  const callback = await app.inject({
    url: `/api/auth/github/callback?state=${state}&code=greendale`,
    headers: { cookie: `setsquare_oauth=${cookie?.value}` },
  });
  expect(callback.statusCode).toBe(400);
});

it("returns to a path on this origin when the return path starts with two slashes", async () => {
  for (const returnTo of [
    "/.//city-college.example/x",
    "/a/..//city-college.example/x",
    `${config.origin}//city-college.example/x`,
  ]) {
    const login = await app.inject({
      url: `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,
    });
    expect(login.statusCode).toBe(302);
    const state = new URL(login.headers.location ?? "").searchParams.get(
      "state",
    );
    const cookie = login.cookies.find(
      (entry) => entry.name === "setsquare_oauth",
    );
    const callback = await app.inject({
      url: `/api/auth/github/callback?state=${state}&code=greendale`,
      headers: { cookie: `setsquare_oauth=${cookie?.value}` },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/city-college.example/x");
  }
  expect(
    (
      await app.inject({
        url: "/api/auth/github?returnTo=%2F.%2F%2Fapi%2Fauth%2Flogout",
      })
    ).statusCode,
  ).toBe(400);
});

it("bounds sign-in attempts by return length, source address, and total", async () => {
  const start = (returnTo = "/", remoteAddress = "203.0.113.5") =>
    app.inject({
      url: `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,
      remoteAddress,
    });
  expect((await start(`/${"a".repeat(2047)}`)).statusCode).toBe(302);
  expect((await start(`/${"a".repeat(2048)}`)).statusCode).toBe(400);
  for (let attempt = 1; attempt < 30; attempt++) {
    expect((await start()).statusCode).toBe(302);
  }
  const limited = await start();
  expect(limited.statusCode).toBe(429);
  expect(limited.json().error).toBe("too_many_attempts");
  expect((await start("/", "198.51.100.7")).statusCode).toBe(302);
  now += 11 * 60 * 1000;
  expect((await start()).statusCode).toBe(302);
  expect(
    (await db.pool.query("SELECT count(*)::int AS count FROM auth_attempts"))
      .rows[0].count,
  ).toBe(1);
  await db.pool.query(
    `INSERT INTO auth_attempts(state_hash, verifier, return_to, source_hash, expires_at)
    SELECT 'greendale-' || i, 'verifier', '/', 'source-' || i, $1 FROM generate_series(1, 9999) i`,
    [now + 60_000],
  );
  const busy = await start("/", "198.51.100.8");
  expect(busy.statusCode).toBe(503);
  expect(busy.json().error).toBe("sign_in_busy");
});

it("uses the OAuth library to verify state and exchange the PKCE verifier with GitHub", async () => {
  const github = new GitHubOAuth(config.origin, {
    clientId: "test-client",
    clientSecret: "test-secret",
  });
  const verifier = "greendale".repeat(8);
  const authorization = await github.authorizationUrl("troy-state", verifier);
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorization.searchParams.get("code_challenge")).toBe(
    createHash("sha256").update(verifier).digest("base64url"),
  );
  expect(authorization.searchParams.get("scope")).toBe("");
  const called: Array<{ url: string; body: string }> = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, options?: RequestInit) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);
      called.push({ url: url.href, body: String(options?.body ?? "") });
      if (url.href === "https://github.com/login/oauth/access_token") {
        const body = new URLSearchParams(String(options?.body));
        expect(body.get("code_verifier")).toBe(verifier);
        // GitHub refuses a code with 200 and an error body
        if (body.get("code") === "expired") {
          return Response.json({
            error: "bad_verification_code",
            error_description: "The code passed is incorrect or expired.",
          });
        }
        return Response.json({
          access_token: "external-test-token",
          token_type: "bearer",
          scope: "",
        });
      }
      expect(url.href).toBe("https://api.github.com/user");
      return Response.json({
        id: 101,
        login: "troy-barnes",
        name: "Troy Barnes",
        avatar_url: "https://avatars.githubusercontent.com/u/101",
      });
    },
  );
  // GitHub names its issuer in the callback (RFC 9207)
  const callbackWith = (code: string, issuer: string) =>
    new URL(
      `${config.origin}/api/auth/github/callback?${new URLSearchParams({
        code,
        state: "troy-state",
        iss: issuer,
      })}`,
    );
  const callback = callbackWith("greendale", "https://github.com/login/oauth");
  expect(
    await github.authenticate(callback, "troy-state", verifier),
  ).toMatchObject({ githubId: "101", login: "troy-barnes" });
  expect(called).toHaveLength(2);
  await expect(
    github.authenticate(callback, "abed-state", verifier),
  ).rejects.toThrow();
  await expect(
    github.authenticate(
      callbackWith("greendale", "https://city-college.example"),
      "troy-state",
      verifier,
    ),
  ).rejects.toThrow('unexpected "iss"');
  expect(called).toHaveLength(2);
  await expect(
    github.authenticate(
      callbackWith("expired", "https://github.com/login/oauth"),
      "troy-state",
      verifier,
    ),
  ).rejects.toMatchObject({ error: "bad_verification_code" });
});

it("requires HTTPS and OAuth configuration for production", async () => {
  expect(
    loadConfig({
      DATABASE_URL: config.databaseUrl,
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
    }).github,
  ).toBe(null);
  expect(() =>
    loadConfig({ NODE_ENV: "production", DATABASE_URL: config.databaseUrl }),
  ).toThrow();
  expect(() =>
    loadConfig({
      NODE_ENV: "production",
      APP_ORIGIN: "https://setsquare.example",
      DATABASE_URL: config.databaseUrl,
    }),
  ).toThrow();
  const deployed = {
    NODE_ENV: "production",
    APP_ORIGIN: "https://setsquare.example",
    DATABASE_URL: config.databaseUrl,
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "secret",
  };
  expect(() => loadConfig(deployed)).toThrow("ALLOWED_GITHUB_IDS");
  expect(() =>
    loadConfig({ ...deployed, ALLOWED_GITHUB_IDS: "troy-barnes" }),
  ).toThrow("numeric");
  expect(() =>
    loadConfig({
      ...deployed,
      ALLOWED_GITHUB_IDS: "101",
      ALLOW_ANY_GITHUB_ACCOUNT: "true",
    }),
  ).toThrow("not both");
  expect(
    loadConfig({ ...deployed, ALLOW_ANY_GITHUB_ACCOUNT: "true" })
      .allowedGithubIds,
  ).toBe(null);
  expect(
    loadConfig({ DATABASE_URL: config.databaseUrl }).allowedGithubIds,
  ).toBe(null);
  const production = loadConfig({
    ...deployed,
    ALLOWED_GITHUB_IDS: "101, 102",
  });
  expect(production.production).toBe(true);
  expect(production.allowedGithubIds).toEqual(["101", "102"]);
  const secureApp = await testServer(db.pool, clock, production);
  try {
    const login = await secureApp.inject({ url: "/api/auth/github" });
    expect(
      login.cookies.find((entry) => entry.name === "__Host-setsquare-oauth"),
    ).toMatchObject({ secure: true, httpOnly: true, path: "/" });
  } finally {
    await secureApp.close();
  }
});

it("parses proxy trust as off, a hop count, or proxy addresses", () => {
  const trustProxy = (TRUST_PROXY?: string) =>
    loadConfig({ DATABASE_URL: config.databaseUrl, TRUST_PROXY }).trustProxy;
  expect(trustProxy()).toBe(false);
  expect(trustProxy("")).toBe(false);
  expect(trustProxy("1")).toBe(1);
  expect(trustProxy(" 2 ")).toBe(2);
  expect(trustProxy("10.0.0.1, 172.16.0.0/12,fd00::/8")).toEqual([
    "10.0.0.1",
    "172.16.0.0/12",
    "fd00::/8",
  ]);
  for (const value of ["0", "true", "loopback", "10.0.0.0/33", "1.5", "-1"]) {
    expect(() => trustProxy(value)).toThrow("TRUST_PROXY");
  }
});

it("admits only allowed GitHub accounts and cuts off existing sessions", async () => {
  const signIn = async (server: FastifyInstance) => {
    const login = await server.inject({ url: "/api/auth/github" });
    const state = new URL(login.headers.location ?? "").searchParams.get(
      "state",
    );
    const cookie = login.cookies.find(
      (entry) => entry.name === "setsquare_oauth",
    );
    return server.inject({
      url: `/api/auth/github/callback?state=${state}&code=greendale`,
      headers: { cookie: `setsquare_oauth=${cookie?.value}` },
    });
  };
  const closed = await testServer(db.pool, clock, {
    allowedGithubIds: ["999"],
  });
  const open = await testServer(db.pool, clock, { allowedGithubIds: ["101"] });
  try {
    expect(
      (await closed.inject({ url: "/api/workspace", headers: troy.headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await closed.inject({ url: "/api/session", headers: troy.headers })
      ).json(),
    ).toEqual({ kind: "signedOut" });
    expect(
      (await open.inject({ url: "/api/workspace", headers: troy.headers }))
        .statusCode,
    ).toBe(200);
    await db.pool.query("TRUNCATE users CASCADE");
    const refused = await signIn(closed);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("account_not_allowed");
    expect(
      refused.cookies.find((entry) => entry.name === "setsquare_session"),
    ).toBeUndefined();
    expect((await db.pool.query("SELECT id FROM users")).rows).toHaveLength(0);
    const admitted = await signIn(open);
    expect(admitted.statusCode).toBe(302);
    const session = admitted.cookies.find(
      (entry) => entry.name === "setsquare_session",
    );
    expect(
      (
        await open.inject({
          url: "/api/session",
          headers: { cookie: `setsquare_session=${session?.value}` },
        })
      ).json(),
    ).toMatchObject({ kind: "signedIn", user: { login: "troy-barnes" } });
  } finally {
    await closed.close();
    await open.close();
  }
});
