import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { vi } from "vitest";

import { migrate } from "../src/database";
import { buildServer } from "../src/server";

import {
  account,
  command,
  config,
  content,
  migrationVersions,
  migrationsDirectory,
  pixel,
  testDatabase,
  testServer,
} from "./helpers";

let db: Awaited<ReturnType<typeof testDatabase>>;

beforeAll(async () => {
  db = await testDatabase();
});
afterAll(async () => {
  await db.close();
});

it("applies migrations safely when servers start concurrently", async () => {
  await Promise.all([migrate(db.pool), migrate(db.pool), migrate(db.pool)]);
  expect(
    (
      await db.pool.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
    ).rows,
  ).toEqual(await migrationVersions());
});

const migrationsCopy = async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "setsquare-migrations-test-"),
  );
  await cp(migrationsDirectory, directory, { recursive: true });
  return directory;
};

it("applies migration files that no code lists", async () => {
  const fresh = await testDatabase();
  const directory = await migrationsCopy();
  try {
    await writeFile(
      path.join(directory, "900-study-groups.sql"),
      "CREATE TABLE study_groups (name text PRIMARY KEY);",
    );
    await migrate(fresh.pool, pathToFileURL(`${directory}/`));
    expect(
      (await fresh.pool.query("SELECT name FROM study_groups")).rows,
    ).toEqual([]);
    expect(
      (
        await fresh.pool.query(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
      ).rows,
    ).toEqual([...(await migrationVersions()), { version: 900 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await fresh.close();
  }
});

it("records checksums for databases migrated before checksums existed", async () => {
  const fresh = await testDatabase();
  try {
    await fresh.pool.query(
      "ALTER TABLE schema_migrations DROP COLUMN checksum",
    );
    await migrate(fresh.pool);
    const initial = await readFile(
      new URL("001-initial.sql", migrationsDirectory),
    );
    expect(
      (
        await fresh.pool.query(
          "SELECT version, checksum FROM schema_migrations ORDER BY version",
        )
      ).rows[0],
    ).toEqual({
      version: 1,
      checksum: createHash("sha256").update(initial).digest("hex"),
    });
    expect(
      (
        await fresh.pool.query(
          "SELECT count(*)::int AS missing FROM schema_migrations WHERE checksum IS NULL",
        )
      ).rows,
    ).toEqual([{ missing: 0 }]);
  } finally {
    await fresh.close();
  }
});

it.each([
  [
    "an applied migration changed",
    async (directory: string) =>
      writeFile(path.join(directory, "001-initial.sql"), "SELECT 1;"),
    "Migration 001-initial.sql changed after it was applied",
  ],
  [
    "an applied migration is missing",
    async (directory: string) => rm(path.join(directory, "001-initial.sql")),
    "Migration version 1 was applied, but no migration file has that version",
  ],
  [
    "two migrations share a version",
    async (directory: string) =>
      writeFile(path.join(directory, "001-duplicate.sql"), "SELECT 1;"),
    "Migrations 001-duplicate.sql and 001-initial.sql share version 1",
  ],
  [
    "a migration is misnamed",
    async (directory: string) =>
      writeFile(path.join(directory, "5-greendale.sql"), "SELECT 1;"),
    "Migration 5-greendale.sql must be named like 001-description.sql",
  ],
])("refuses to migrate when %s", async (_, change, want) => {
  const directory = await migrationsCopy();
  try {
    await change(directory);
    await expect(
      migrate(db.pool, pathToFileURL(`${directory}/`)),
    ).rejects.toThrow(want);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("serves static navigation while keeping API and missing asset requests out of the SPA", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "setsquare-static-test-"),
  );
  await mkdir(path.join(directory, "assets"));
  await writeFile(
    path.join(directory, "index.html"),
    "<!doctype html><title>Setsquare</title><main>Greendale</main>",
  );
  await writeFile(
    path.join(directory, "assets/app-abc123.js"),
    "globalThis.greendale = true;",
  );
  await writeFile(
    path.join(directory, "sw.js"),
    "self.addEventListener('fetch', () => {});",
  );
  const app = await testServer(db.pool, Date.now, { staticDir: directory });
  try {
    for (const url of ["/", "/index.html", "/d/greendale"]) {
      const page = await app.inject({ url, headers: { accept: "text/html" } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("<main>Greendale</main>");
      expect(page.headers["cache-control"]).toBe("no-cache");
      expect(page.headers["x-frame-options"]).toBe("DENY");
      expect(page.headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
    }
    const asset = await app.inject({ url: "/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    const missing = await app.inject({
      url: "/assets/missing.js",
      headers: { accept: "text/html" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain("<main>");
    const api = await app.inject({
      url: "/api/absent",
      headers: { accept: "text/html" },
    });
    expect(api.statusCode).toBe(404);
    expect(api.headers["content-type"]).toContain("application/json");
    expect(api.headers["cache-control"]).toBe("no-store");
    const serviceWorker = await app.inject({ url: "/sw.js" });
    expect(serviceWorker.headers["cache-control"]).toBe("no-cache");
  } finally {
    await app.close();
    await rm(directory, { recursive: true });
  }
});

it("validates input before storage and hides internal database errors", async () => {
  const app = await testServer(db.pool, Date.now);
  try {
    const troy = await account(db.pool, Date.now, "501", "troy-barnes");
    const create = {
      kind: "createDrawing",
      id: "greendale",
      folderId: null,
      name: "Greendale",
      content: content(),
      fileIds: [],
    };
    expect(
      (await command(app, troy, { ...create, ownerId: "attacker" })).statusCode,
    ).toBe(400);
    expect(
      (
        await command(app, troy, {
          ...create,
          content: {
            elements: [{ id: "wrong", type: "image" }],
            appState: content().appState,
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await command(app, troy, { ...create, id: "../../private" })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: `/api/files?ids=${Array(101).fill("pixel").join(",")}`,
          headers: troy.headers,
        })
      ).statusCode,
    ).toBe(400);
    const invalidImage = await app.inject({
      method: "POST",
      url: "/api/files",
      headers: troy.headers,
      payload: { files: [{ ...pixel, dataURL: "data:image/png;base64,AAAA" }] },
    });
    expect(invalidImage.statusCode).toBe(400);
    expect(invalidImage.json().message).not.toContain("assets");
    const large = await app.inject({
      method: "POST",
      url: "/api/files",
      headers: troy.headers,
      payload: {
        files: [
          {
            ...pixel,
            dataURL: `data:image/png;base64,${"A".repeat(13 * 1024 * 1024)}`,
          },
        ],
      },
    });
    expect(large.statusCode).toBe(413);
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: { ...troy.headers, "content-type": "text/plain" },
      payload: "greendale",
    });
    expect(unsupported.statusCode).toBe(400);
    expect((await command(app, troy, create)).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

it("logs stored rows that fail their schema and returns 500, not 400", async () => {
  const app = await testServer(db.pool, Date.now);
  try {
    const abed = await account(db.pool, Date.now, "502", "abed-nadir");
    const created = await command(app, abed, {
      kind: "createDrawing",
      id: "dreamatorium",
      folderId: null,
      name: "Dreamatorium",
      content: content(),
      fileIds: [],
    });
    expect(created.statusCode).toBe(200);
    await db.pool.query(
      "UPDATE drawings SET name = repeat('x', 300) WHERE owner_id = $1",
      [abed.user.id],
    );
    const log = vi.spyOn(app.log, "error");
    const response = await app.inject({
      url: "/api/workspace",
      headers: abed.headers,
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe("server_error");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({
      err: { name: "StoredDataError" },
    });
  } finally {
    await app.close();
    vi.restoreAllMocks();
  }
});

it("authenticates before reading bodies and limits them to 1 MiB outside drawing uploads", async () => {
  const app = await testServer(db.pool, Date.now);
  try {
    for (const url of ["/api/commands", "/api/files", "/api/auth/logout"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/json" },
        payload: "{",
      });
      expect(response.statusCode, url).toBe(401);
    }
    const troy = await account(db.pool, Date.now, "502", "troy-barnes");
    const padded = { greendale: "A".repeat(2 * 1024 * 1024) };
    for (const url of ["/api/auth/logout", "/greendale"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: troy.headers,
        payload: padded,
      });
      expect(response.statusCode, url).toBe(413);
    }
    const image = Buffer.concat([
      Buffer.from(pixel.dataURL.split(",")[1], "base64"),
      Buffer.alloc(2 * 1024 * 1024),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: "/api/files",
      headers: troy.headers,
      payload: {
        files: [
          {
            ...pixel,
            id: "greendale-large",
            dataURL: `data:image/png;base64,${image.toString("base64")}`,
          },
        ],
      },
    });
    expect(upload.statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

it("uses local mode only when development has no OAuth provider", async () => {
  const app = await buildServer({
    config: { ...config, github: null },
    pool: db.pool,
    cleanup: false,
  });
  try {
    expect((await app.inject({ url: "/api/session" })).json()).toEqual({
      kind: "local",
    });
    expect((await app.inject({ url: "/api/auth/github" })).statusCode).toBe(
      503,
    );
    expect((await app.inject({ url: "/api/workspace" })).statusCode).toBe(401);
  } finally {
    await app.close();
  }
});

it("serves before the first cleanup pass finishes", async () => {
  const pending = new Promise<never>(() => {});
  const blocked: string[] = [];
  const pool = Object.create(db.pool, {
    query: {
      value: (text: string) => {
        if (text === "SELECT 1") {
          return db.pool.query(text);
        }
        blocked.push(text);
        return pending;
      },
    },
    connect: { value: () => pending },
  });
  const app = await buildServer({ config, pool, cleanup: true });
  try {
    await vi.waitFor(() => expect(blocked).not.toHaveLength(0));
    expect((await app.inject({ url: "/api/health" })).json()).toEqual({
      ok: true,
    });
  } finally {
    await app.close();
  }
});
