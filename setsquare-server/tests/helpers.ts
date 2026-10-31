import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";

import pg from "pg";

import { SessionDatabase } from "../src/auth";

import { migrate } from "../src/database";

import { buildServer } from "../src/server";

import { contentSchema } from "../src/validation";

import type { FastifyInstance } from "fastify";

import type { AccountUser } from "../../setsquare-app/workspace/api";

import type { OAuthProvider } from "../src/auth";
import type { ServerConfig } from "../src/config";

/** The migration directory shipped with the server. */
export const migrationsDirectory = new URL("../migrations/", import.meta.url);

/** The schema_migrations rows a fully migrated database should hold. */
export const migrationVersions = async () =>
  (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .map((filename) => ({ version: Number(filename.slice(0, 3)) }))
    .sort((left, right) => left.version - right.version);

/** A temporary schema containing only this test run's data. */
export const testDatabase = async () => {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgresql:///postgres?host=/tmp";
  const admin = new pg.Pool({ connectionString: url });
  const schema = `setsquare_backend_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });
  await migrate(pool);
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
};

/** The local test deployment settings without a deployed authentication bypass. */
export const config: ServerConfig = {
  production: false,
  origin: "http://localhost:3001",
  databaseUrl: "postgresql:///postgres?host=/tmp",
  port: 3002,
  host: "127.0.0.1",
  staticDir: "/tmp/setsquare-backend-no-build",
  github: { clientId: "test-client", clientSecret: "test-secret" },
  allowedGithubIds: null,
  trustProxy: false,
};

/** A provider whose external calls can be exercised without GitHub credentials. */
export const fakeProvider: OAuthProvider = {
  async authorizationUrl(state, verifier) {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("state", state);
    url.searchParams.set("verifier", verifier);
    return url;
  },
  async authenticate(callback, state, verifier) {
    if (
      callback.searchParams.get("state") !== state ||
      !verifier ||
      callback.searchParams.get("code") !== "greendale"
    ) {
      throw new Error("Invalid test provider authorization");
    }
    return {
      githubId: "101",
      login: "troy-barnes",
      name: "Troy Barnes",
      avatarUrl: "https://avatars.githubusercontent.com/u/101",
    };
  },
};

/** Starts an API server with real storage and an external identity-provider stub. */
export const testServer = (
  pool: pg.Pool,
  now: () => number,
  overrides: Partial<ServerConfig> = {},
) =>
  buildServer({
    config: { ...config, ...overrides },
    pool,
    provider: fakeProvider,
    now,
    cleanup: false,
  });

/** An account's headers used to exercise the HTTP authorization boundary. */
export type TestAccount = {
  user: AccountUser;
  headers: Record<string, string>;
  token: string;
  csrfToken: string;
};

/** Creates a test session through the same database operation OAuth uses. */
export const account = async (
  pool: pg.Pool,
  now: () => number,
  githubId = "101",
  login = "troy-barnes",
): Promise<TestAccount> => {
  const saved = await new SessionDatabase(pool, now).create({
    githubId,
    login,
    name: "Troy Barnes",
    avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}`,
  });
  return {
    ...saved,
    headers: {
      cookie: `setsquare_session=${saved.token}`,
      origin: config.origin,
      "x-setsquare-account": saved.user.id,
      "x-csrf-token": saved.csrfToken,
    },
  };
};

/** Applies one HTTP command with a fresh request id by default. */
export const command = (
  app: FastifyInstance,
  who: TestAccount,
  value: unknown,
  requestId: string = randomUUID(),
) =>
  app.inject({
    method: "POST",
    url: "/api/commands",
    headers: who.headers,
    payload: { requestId, command: value },
  });

/** A valid empty scene stored by the browser editor. */
export const content = (name: string | null = "Greendale") =>
  contentSchema.parse({
    elements: [],
    appState: {
      name,
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      lockedMultiSelections: {},
    },
  });

/** A valid scene containing one referenced image. */
export const imageContent = () =>
  contentSchema.parse({
    ...content(),
    elements: [
      {
        id: "abed",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        angle: 0,
        strokeColor: "#000000",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roundness: null,
        roughness: 1,
        opacity: 100,
        seed: 1,
        version: 1,
        versionNonce: 1,
        index: "a0",
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: 1,
        created: 1,
        link: null,
        locked: false,
        fileId: "pixel",
        status: "saved",
        scale: [1, 1],
        crop: null,
      },
    ],
  });

/** A small real PNG accepted by the image upload boundary. */
export const pixel = {
  id: "pixel",
  mimeType: "image/png",
  created: 1,
  dataURL:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
};
