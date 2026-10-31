import { randomUUID } from "node:crypto";

import { WorkspaceDatabase } from "../src/workspace";

import {
  account,
  command,
  content,
  imageContent,
  pixel,
  testDatabase,
  testServer,
} from "./helpers";

import type { FastifyInstance } from "fastify";
import type { TestAccount } from "./helpers";

let db: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
let troy: TestAccount;
let abed: TestAccount;
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
  abed = await account(db.pool, clock, "102", "abed-nadir");
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const createDrawing = (id = "plan", folderId: string | null = null) =>
  command(app, troy, {
    kind: "createDrawing",
    id,
    folderId,
    name: "Greendale",
    content: content(),
    fileIds: [],
  });

const textContent = (text: string, key: string, name?: string) => ({
  ...content(name),
  elements: [
    {
      id: "annie",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 25,
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
      fontSize: 20,
      fontFamily: 1,
      baseFontSize: null,
      text,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: text,
      autoResize: true,
      lineHeight: 1.25,
    },
  ],
  appState: {
    ...content(name).appState,
    lockedMultiSelections: { [key]: true },
  },
});

it("isolates every read and mutation, including parents and image ids", async () => {
  expect((await createDrawing()).statusCode).toBe(200);
  expect(
    (
      await command(app, troy, {
        kind: "createFolder",
        id: "campus",
        parentId: null,
        name: "Campus",
      })
    ).statusCode,
  ).toBe(200);
  const other = await app.inject({
    url: "/api/workspace",
    headers: abed.headers,
  });
  expect(other.json()).toEqual({ folders: [], drawings: [] });
  expect(
    (await app.inject({ url: "/api/drawings/plan", headers: abed.headers }))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: "/api/drawings/plan/content",
        headers: abed.headers,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: "/api/thumbnails?ids=plan",
        headers: abed.headers,
      })
    ).statusCode,
  ).toBe(404);
  const rename = await command(app, abed, {
    kind: "renameDrawing",
    id: "plan",
    name: "Stolen",
    baseRevision: 1,
  });
  expect(rename.json().result.result).toEqual({
    ok: false,
    reason: "notFound",
  });
  const parent = await command(app, abed, {
    kind: "createDrawing",
    id: "different",
    folderId: "campus",
    name: "Plan",
    content: content("Plan"),
    fileIds: [],
  });
  expect(parent.statusCode).toBe(404);
  const owner = await app.inject({
    url: "/api/drawings/plan/content",
    headers: troy.headers,
  });
  expect(owner.json().meta.name).toBe("Greendale");
});

it("checks revisions atomically when two browsers save together", async () => {
  await createDrawing();
  const [first, second] = await Promise.all(
    ["Paintball", "Dreamatorium"].map((name) =>
      command(app, troy, {
        kind: "saveDrawing",
        id: "plan",
        content: content(name),
        fileIds: [],
        baseRevision: 1,
      }),
    ),
  );
  expect(first.statusCode).toBe(200);
  expect(second.statusCode).toBe(200);
  expect(
    [first.json().result.result, second.json().result.result].filter(
      (result) => result.ok,
    ),
  ).toHaveLength(1);
  const conflict = [
    first.json().result.result,
    second.json().result.result,
  ].find((result) => !result.ok);
  expect(conflict).toMatchObject({
    ok: false,
    reason: "conflict",
    meta: { revision: 2 },
  });
  const saved = await app.inject({
    url: "/api/drawings/plan/content",
    headers: troy.headers,
  });
  expect(saved.json().meta.revision).toBe(2);
  expect(saved.json().content.appState.name).toBe(saved.json().meta.name);
});

it("deduplicates concurrent request retries and refuses changed arguments", async () => {
  const requestId = randomUUID();
  const args = {
    kind: "createDrawing",
    id: "plan",
    folderId: null,
    name: "Greendale",
    content: content(),
    fileIds: [],
  };
  const responses = await Promise.all([
    command(app, troy, args, requestId),
    command(app, troy, args, requestId),
  ]);
  expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
  expect(responses[0].json()).toEqual(responses[1].json());
  const changed = await command(
    app,
    troy,
    { ...args, name: "Different" },
    requestId,
  );
  expect(changed.statusCode).toBe(409);
  const after = await app.inject({
    url: "/api/workspace",
    headers: troy.headers,
  });
  expect(after.json().drawings).toHaveLength(1);
});

it("retries a save after later changes without bumping its revision again", async () => {
  await createDrawing();
  const requestId = randomUUID();
  const edit = {
    kind: "saveDrawing",
    id: "plan",
    content: content("Paintball"),
    fileIds: [],
    baseRevision: 1,
  };
  expect(
    (await command(app, troy, edit, requestId)).json().result.result.meta
      .revision,
  ).toBe(2);
  expect(
    (
      await command(app, troy, {
        kind: "renameDrawing",
        id: "plan",
        name: "Study room",
        baseRevision: 2,
      })
    ).json().result.result.meta.revision,
  ).toBe(3);
  const replay = await command(app, troy, edit, requestId);
  expect(replay.json().result.result.meta.revision).toBe(2);
  expect(replay.json().snapshot.drawings[0].revision).toBe(3);
});

it("removes U+0000 from saved text and keys so retries return the stored receipt", async () => {
  await createDrawing();
  const requestId = randomUUID();
  const edit = {
    kind: "saveDrawing",
    id: "plan",
    content: textContent("a\u0000b", "study\u0000group"),
    fileIds: [],
    baseRevision: 1,
  };
  const saved = await command(app, troy, edit, requestId);
  expect(saved.statusCode).toBe(200);
  expect(saved.json().result.result.meta.revision).toBe(2);
  const loaded = (
    await app.inject({
      url: "/api/drawings/plan/content",
      headers: troy.headers,
    })
  ).json().content;
  expect(loaded.elements[0]).toMatchObject({
    text: "ab",
    originalText: "ab",
  });
  expect(loaded.appState.lockedMultiSelections).toEqual({ studygroup: true });
  const retry = await command(app, troy, edit, requestId);
  expect(retry.statusCode).toBe(200);
  expect(retry.json().result).toEqual(saved.json().result);
});

it("replaces lone surrogates in names, text and keys so saves store and retries return the stored receipt", async () => {
  const high = "\ud83d";
  const low = "\ude00";
  const importedFolder = {
    id: "library",
    name: `Library ${low}`,
    parentId: null,
    createdAt: 100,
    updatedAt: 200,
    trashedAt: null,
  };
  const commands = [
    {
      kind: "createFolder",
      id: "campus",
      parentId: null,
      name: `Campus ${high}`,
    },
    { kind: "importFolder", folder: importedFolder },
    {
      kind: "createDrawing",
      id: "plan",
      folderId: null,
      name: `Plan ${low}`,
      content: textContent(`a${high}b`, `study${low}group`),
      fileIds: [],
    },
    {
      kind: "saveDrawing",
      id: "plan",
      content: textContent(
        `Launch ${high}`,
        `study${high}group`,
        `Plan ${low}`,
      ),
      fileIds: [],
      baseRevision: 1,
    },
    {
      kind: "importDrawing",
      drawing: {
        meta: {
          id: "imported",
          folderId: null,
          name: `Imported ${high}`,
          createdAt: 100,
          updatedAt: 200,
          openedAt: null,
          trashedAt: null,
          revision: 1,
          fileIds: [],
        },
        content: textContent(`${low}c`, low),
      },
    },
  ];
  for (const value of commands) {
    const requestId = randomUUID();
    const first = await command(app, troy, value, requestId);
    expect(first.statusCode, value.kind).toBe(200);
    const retry = await command(app, troy, value, requestId);
    expect(retry.statusCode, value.kind).toBe(200);
    expect(retry.json().result).toEqual(first.json().result);
  }
  expect(
    (await command(app, troy, { kind: "importFolder", folder: importedFolder }))
      .statusCode,
  ).toBe(200);
  const workspace = (
    await app.inject({ url: "/api/workspace", headers: troy.headers })
  ).json();
  expect(
    workspace.folders.map((folder: { name: string }) => folder.name).sort(),
  ).toEqual(["Campus \ufffd", "Library \ufffd"]);
  expect(
    workspace.drawings.map((drawing: { name: string }) => drawing.name).sort(),
  ).toEqual(["Imported \ufffd", "Plan \ufffd"]);
  const load = async (id: string) =>
    (
      await app.inject({
        url: `/api/drawings/${id}/content`,
        headers: troy.headers,
      })
    ).json().content;
  const plan = await load("plan");
  expect(plan.elements[0].text).toBe("Launch \ufffd");
  expect(plan.appState.lockedMultiSelections).toEqual({
    "study\ufffdgroup": true,
  });
  const imported = await load("imported");
  expect(imported.elements[0].originalText).toBe("\ufffdc");
  expect(imported.appState.lockedMultiSelections).toEqual({ "\ufffd": true });
});

it("collects mutation receipts after 30 days but keeps import receipts", async () => {
  await createDrawing("plan");
  await command(
    app,
    troy,
    {
      kind: "importFolder",
      folder: {
        id: "campus",
        parentId: null,
        name: "Campus",
        createdAt: 100,
        updatedAt: 200,
        trashedAt: null,
      },
    },
    "import-campus",
  );
  const receipts = async () =>
    (
      await db.pool.query(
        "SELECT request_id FROM mutation_receipts ORDER BY request_id",
      )
    ).rows.map((row) => row.request_id);
  const workspace = new WorkspaceDatabase(db.pool, clock);
  now += 29 * 24 * 60 * 60 * 1000;
  await createDrawing("study-room");
  expect(await receipts()).toHaveLength(3);
  await workspace.collect();
  expect(await receipts()).toHaveLength(3);
  now += 2 * 24 * 60 * 60 * 1000;
  await workspace.collect();
  expect(await receipts()).toHaveLength(2);
  expect(await receipts()).toContain("import-campus");
  now += 30 * 24 * 60 * 60 * 1000;
  await workspace.collect();
  expect(await receipts()).toEqual(["import-campus"]);
});

it("cannot create a folder cycle through concurrent moves", async () => {
  for (const id of ["troy", "abed"]) {
    expect(
      (
        await command(app, troy, {
          kind: "createFolder",
          id,
          parentId: null,
          name: id,
        })
      ).statusCode,
    ).toBe(200);
  }
  const results = await Promise.all([
    command(app, troy, {
      kind: "move",
      item: { kind: "folder", id: "troy" },
      target: "abed",
    }),
    command(app, troy, {
      kind: "move",
      item: { kind: "folder", id: "abed" },
      target: "troy",
    }),
  ]);
  expect(
    results.filter((result) => result.json().result.result.ok),
  ).toHaveLength(1);
  expect(
    results.find((result) => !result.json().result.result.ok)?.json().result
      .result.reason,
  ).toBe("intoDescendant");
});

it("commits images before references and keeps each version private and immutable", async () => {
  const args = {
    kind: "createDrawing",
    id: "plan",
    folderId: null,
    name: "Greendale",
    content: imageContent(),
    fileIds: ["pixel"],
  };
  expect((await command(app, troy, args, "upload-pending")).statusCode).toBe(
    400,
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/files",
        headers: troy.headers,
        payload: { files: [pixel] },
      })
    ).statusCode,
  ).toBe(200);
  expect((await command(app, troy, args, "upload-pending")).statusCode).toBe(
    200,
  );
  expect(
    (await app.inject({ url: "/api/files?ids=pixel", headers: abed.headers }))
      .statusCode,
  ).toBe(404);
  expect((await command(app, abed, { ...args, id: "other" })).statusCode).toBe(
    400,
  );
  const loaded = await app.inject({
    url: "/api/files?ids=pixel",
    headers: troy.headers,
  });
  expect(loaded.json().files[0].dataURL).toBe(pixel.dataURL);
  const changed = { ...pixel, dataURL: "data:image/png;base64,iVBORw0KGgo=" };
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/files",
        headers: troy.headers,
        payload: { files: [changed] },
      })
    ).statusCode,
  ).toBe(409);
  const invalid = await command(app, troy, {
    kind: "saveDrawing",
    id: "plan",
    content: imageContent(),
    fileIds: [],
    baseRevision: 1,
  });
  expect(invalid.statusCode).toBe(400);
  expect(
    (
      await app.inject({
        url: "/api/drawings/plan/content",
        headers: troy.headers,
      })
    ).json().meta.revision,
  ).toBe(1);
});

it("accepts a newer SVG format version without allowing stale replacements", async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128"/></svg>';
  const original = {
    id: "greendale-logo",
    mimeType: "image/svg+xml",
    created: now,
    version: 1,
    dataURL: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  };
  const migrated = {
    ...original,
    version: 2,
    dataURL: `data:image/svg+xml;base64,${Buffer.from(
      svg.replace("<rect ", '<rect fill="blue" '),
    ).toString("base64")}`,
  };
  const save = (file: typeof original) =>
    app.inject({
      method: "POST",
      url: "/api/files",
      headers: troy.headers,
      payload: { files: [file] },
    });
  expect((await save(original)).statusCode).toBe(200);
  expect((await save(migrated)).statusCode).toBe(200);
  expect((await save(migrated)).statusCode).toBe(200);
  expect((await save(original)).statusCode).toBe(409);
  const loaded = await app.inject({
    url: "/api/files?ids=greendale-logo",
    headers: troy.headers,
  });
  expect(loaded.json().files[0]).toMatchObject({
    version: 2,
    dataURL: migrated.dataURL,
  });
});

it("retains staged uploads for a day before collecting unreferenced images", async () => {
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/files",
        headers: troy.headers,
        payload: { files: [pixel] },
      })
    ).statusCode,
  ).toBe(200);
  const workspace = new WorkspaceDatabase(db.pool, clock);
  now += 20 * 60 * 60 * 1000;
  await workspace.collect();
  expect((await db.pool.query("SELECT 1 FROM assets")).rows).toHaveLength(1);
  now += 5 * 60 * 60 * 1000;
  await workspace.collect();
  expect((await db.pool.query("SELECT 1 FROM assets")).rows).toHaveLength(0);
});

it("accepts the editor's SVG exports and JFIF images without changing their bytes", async () => {
  const svg =
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
  const files = [
    {
      id: "greendale-svg",
      mimeType: "image/svg+xml",
      dataURL: `data:image/svg+xml;base64,${Buffer.from(svg).toString(
        "base64",
      )}`,
      created: now,
    },
    {
      id: "greendale-jfif",
      mimeType: "image/jfif",
      dataURL: `data:image/jfif;base64,${Buffer.from([
        255, 216, 255, 224,
      ]).toString("base64")}`,
      created: now,
    },
  ];
  const saved = await app.inject({
    method: "POST",
    url: "/api/files",
    headers: troy.headers,
    payload: { files },
  });
  expect(saved.statusCode).toBe(200);
  const loaded = await app.inject({
    url: "/api/files?ids=greendale-svg,greendale-jfif",
    headers: troy.headers,
  });
  expect(
    loaded
      .json()
      .files.map((file: { dataURL: string }) => file.dataURL)
      .sort(),
  ).toEqual(files.map((file) => file.dataURL).sort());
});

it("preserves imported ids and metadata without overwriting an existing drawing", async () => {
  const folder = {
    id: "campus",
    parentId: null,
    name: "Campus",
    createdAt: 100,
    updatedAt: 200,
    trashedAt: null,
  };
  expect(
    (await command(app, troy, { kind: "importFolder", folder })).statusCode,
  ).toBe(200);
  expect(
    (await command(app, troy, { kind: "importFolder", folder })).statusCode,
  ).toBe(200);
  const drawing = {
    meta: {
      id: "plan",
      folderId: "campus",
      name: "Greendale",
      createdAt: 100,
      updatedAt: 200,
      openedAt: 300,
      trashedAt: null,
      revision: 7,
      fileIds: [],
    },
    content: content(),
  };
  expect(
    (await command(app, troy, { kind: "importDrawing", drawing })).statusCode,
  ).toBe(200);
  expect(
    (await command(app, troy, { kind: "importDrawing", drawing })).statusCode,
  ).toBe(200);
  const saved = await app.inject({
    url: "/api/drawings/plan/content",
    headers: troy.headers,
  });
  expect(saved.json()).toEqual(drawing);
  expect(
    (
      await command(app, troy, {
        kind: "importDrawing",
        drawing: {
          meta: { ...drawing.meta, name: "Different" },
          content: content("Different"),
        },
      })
    ).statusCode,
  ).toBe(409);
});

it("duplicates drawings and restores children out of a trashed parent", async () => {
  await command(app, troy, {
    kind: "createFolder",
    id: "campus",
    parentId: null,
    name: "Campus",
  });
  await createDrawing("plan", "campus");
  const copy = await command(app, troy, {
    kind: "duplicateDrawing",
    sourceId: "plan",
    id: "copy",
    name: "Greendale copy",
  });
  expect(copy.json().result.drawing).toMatchObject({
    id: "copy",
    name: "Greendale copy",
    folderId: "campus",
    revision: 1,
  });
  await command(app, troy, {
    kind: "trash",
    item: { kind: "folder", id: "campus" },
  });
  const moved = await command(app, troy, {
    kind: "move",
    item: { kind: "drawing", id: "copy" },
    target: "campus",
  });
  expect(moved.json().result.result).toEqual({
    ok: false,
    reason: "targetTrashed",
  });
  await command(app, troy, {
    kind: "restore",
    item: { kind: "drawing", id: "copy" },
  });
  await command(app, troy, {
    kind: "deleteForever",
    item: { kind: "folder", id: "campus" },
  });
  const data = (
    await app.inject({ url: "/api/workspace", headers: troy.headers })
  ).json();
  expect(data.folders).toHaveLength(0);
  expect(data.drawings).toMatchObject([{ id: "copy", folderId: null }]);
  expect(
    (
      await command(app, troy, {
        kind: "saveDrawing",
        id: "plan",
        content: content(),
        fileIds: [],
        baseRevision: 1,
      })
    ).json().result.result,
  ).toEqual({ ok: false, reason: "notFound" });
});

it("rejects stale thumbnails and purges expired trash with reference-aware image cleanup", async () => {
  await app.inject({
    method: "POST",
    url: "/api/files",
    headers: troy.headers,
    payload: { files: [pixel] },
  });
  await command(app, troy, {
    kind: "createDrawing",
    id: "plan",
    folderId: null,
    name: "Greendale",
    content: imageContent(),
    fileIds: ["pixel"],
  });
  await command(app, troy, {
    kind: "renameDrawing",
    id: "plan",
    name: "Study room",
    baseRevision: 1,
  });
  await command(app, troy, {
    kind: "saveThumbnail",
    id: "plan",
    thumbnail: { src: pixel.dataURL, revision: 1 },
  });
  expect(
    (
      await app.inject({
        url: "/api/thumbnails?ids=plan",
        headers: troy.headers,
      })
    ).json(),
  ).toEqual({ thumbnails: [] });
  await command(app, troy, {
    kind: "saveThumbnail",
    id: "plan",
    thumbnail: { src: pixel.dataURL, revision: 2 },
  });
  expect(
    (
      await app.inject({
        url: "/api/thumbnails?ids=plan",
        headers: troy.headers,
      })
    ).json().thumbnails,
  ).toHaveLength(1);
  await command(app, troy, {
    kind: "trash",
    item: { kind: "drawing", id: "plan" },
  });
  const workspace = new WorkspaceDatabase(db.pool, clock);
  now += 29 * 24 * 60 * 60 * 1000;
  await workspace.collect();
  expect((await db.pool.query("SELECT 1 FROM assets")).rows).toHaveLength(1);
  now += 2 * 24 * 60 * 60 * 1000;
  await workspace.collect();
  expect((await db.pool.query("SELECT 1 FROM drawings")).rows).toHaveLength(0);
  expect((await db.pool.query("SELECT 1 FROM assets")).rows).toHaveLength(0);
});
