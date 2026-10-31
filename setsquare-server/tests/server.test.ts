import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrate } from "../src/database";
import { buildServer } from "../src/server";

import {
  account,
  command,
  config,
  content,
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
  ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
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
