import { createHash } from "node:crypto";

import { z } from "zod";

import { transaction } from "./database";

import { ApiError } from "./errors";

import {
  contentSchema,
  drawingMetaSchema,
  folderSchema,
  thumbnailSchema,
} from "./validation";

import type { Pool, PoolClient } from "pg";

import type {
  CommandResponse,
  CommandResult,
  DrawingData,
  WorkspaceCommand,
  WorkspaceData,
} from "../../setsquare-app/workspace/api";
import type {
  DrawingContent,
  DrawingMeta,
  Folder,
  ItemRef,
  ParentId,
} from "../../setsquare-app/workspace/types";

type Queryable = Pick<PoolClient, "query">;
const DAY = 24 * 60 * 60 * 1000;
const OK = { ok: true } as const;
const NOT_FOUND = { ok: false, reason: "notFound" } as const;
const folderMeta = `jsonb_build_object(
  'id', f.id, 'name', f.name, 'parentId', f.parent_id,
  'createdAt', f.created_at, 'updatedAt', f.updated_at, 'trashedAt', f.trashed_at
)`;
const drawingMeta = `jsonb_build_object(
  'id', d.id, 'name', d.name, 'folderId', d.folder_id,
  'createdAt', d.created_at, 'updatedAt', d.updated_at, 'openedAt', d.opened_at,
  'trashedAt', d.trashed_at, 'revision', d.revision,
  'fileIds', COALESCE((SELECT jsonb_agg(a.file_id ORDER BY a.file_id)
    FROM drawing_assets a WHERE a.owner_id = d.owner_id AND a.drawing_id = d.id), '[]'::jsonb)
)`;
const dataSchema = z.object({
  folders: z.array(folderSchema),
  drawings: z.array(drawingMetaSchema),
});
const drawingSchema = z.object({
  meta: drawingMetaSchema,
  content: contentSchema,
});

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const namedContent = (
  content: DrawingContent,
  name: string | null,
): DrawingContent => ({
  ...content,
  appState: { ...content.appState, name },
});

const filesIn = (content: DrawingContent) =>
  [
    ...new Set(
      content.elements.flatMap((element) =>
        element.type === "image" && element.fileId ? [element.fileId] : [],
      ),
    ),
  ].sort();

const checkFiles = (content: DrawingContent, declared: readonly string[]) => {
  const ids = filesIn(content);
  if (canonical(ids) !== canonical([...new Set(declared)].sort())) {
    throw new ApiError(
      400,
      "invalid_files",
      "Image references must match the drawing",
    );
  }
  return ids;
};

const folderById = async (db: Queryable, owner: string, id: string) => {
  const result = await db.query(
    `SELECT ${folderMeta} AS data FROM folders f WHERE owner_id = $1 AND id = $2`,
    [owner, id],
  );
  return result.rows.length ? folderSchema.parse(result.rows[0].data) : null;
};

const drawingById = async (
  db: Queryable,
  owner: string,
  id: string,
): Promise<DrawingData | null> => {
  const result = await db.query(
    `SELECT jsonb_build_object('meta', ${drawingMeta}, 'content', d.content) AS data FROM drawings d WHERE d.owner_id = $1 AND d.id = $2`,
    [owner, id],
  );
  return result.rows.length ? drawingSchema.parse(result.rows[0].data) : null;
};

const snapshot = async (
  db: Queryable,
  owner: string,
): Promise<WorkspaceData> => {
  const result = await db.query(
    `SELECT jsonb_build_object(
    'folders', COALESCE((SELECT jsonb_agg(${folderMeta} ORDER BY f.id) FROM folders f WHERE f.owner_id = $1), '[]'::jsonb),
    'drawings', COALESCE((SELECT jsonb_agg(${drawingMeta} ORDER BY d.id) FROM drawings d WHERE d.owner_id = $1), '[]'::jsonb)
  ) AS data`,
    [owner],
  );
  return dataSchema.parse(result.rows[0].data);
};

const trashedFolder = (folders: readonly Folder[], id: ParentId): boolean => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  while (id !== null) {
    if (seen.has(id)) {
      throw new ApiError(
        409,
        "invalid_tree",
        "The folder tree contains a cycle",
      );
    }
    seen.add(id);
    const folder = byId.get(id);
    if (!folder) {
      return false;
    }
    if (folder.trashedAt !== null) {
      return true;
    }
    id = folder.parentId;
  }
  return false;
};

const checkParent = async (db: Queryable, owner: string, id: ParentId) => {
  if (id === null) {
    return;
  }
  if (!(await folderById(db, owner, id))) {
    throw new ApiError(
      404,
      "not_found",
      "The destination folder does not exist",
    );
  }
  if (trashedFolder((await snapshot(db, owner)).folders, id)) {
    throw new ApiError(
      409,
      "target_trashed",
      "The destination folder is in the Trash",
    );
  }
};

const setFiles = async (
  db: Queryable,
  owner: string,
  id: string,
  fileIds: readonly string[],
) => {
  const found = await db.query(
    "SELECT file_id FROM assets WHERE owner_id = $1 AND file_id = ANY($2::text[]) FOR KEY SHARE",
    [owner, fileIds],
  );
  if (found.rows.length !== fileIds.length) {
    throw new ApiError(
      400,
      "missing_files",
      "Upload every image before saving the drawing",
    );
  }
  await db.query(
    "DELETE FROM drawing_assets WHERE owner_id = $1 AND drawing_id = $2",
    [owner, id],
  );
  if (fileIds.length) {
    await db.query(
      "INSERT INTO drawing_assets(owner_id, drawing_id, file_id) SELECT $1, $2, unnest($3::text[])",
      [owner, id, fileIds],
    );
  }
};

const insertFolder = async (
  db: Queryable,
  owner: string,
  folder: Folder,
  importing = false,
) => {
  if (folder.parentId !== null) {
    const parent = await folderById(db, owner, folder.parentId);
    if (!parent || parent.id === folder.id) {
      throw new ApiError(
        404,
        "not_found",
        "The destination folder does not exist",
      );
    }
    if (!importing) {
      await checkParent(db, owner, folder.parentId);
    }
  }
  await db.query(
    `INSERT INTO folders(owner_id, id, parent_id, name, created_at, updated_at, trashed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      owner,
      folder.id,
      folder.parentId,
      folder.name,
      folder.createdAt,
      folder.updatedAt,
      folder.trashedAt,
    ],
  );
};

const insertDrawing = async (
  db: Queryable,
  owner: string,
  meta: DrawingMeta,
  content: DrawingContent,
  importing = false,
) => {
  if (importing) {
    if (
      meta.folderId !== null &&
      !(await folderById(db, owner, meta.folderId))
    ) {
      throw new ApiError(
        404,
        "not_found",
        "The destination folder does not exist",
      );
    }
  } else {
    await checkParent(db, owner, meta.folderId);
  }
  const fileIds = checkFiles(content, meta.fileIds);
  await db.query(
    `INSERT INTO drawings(owner_id, id, folder_id, name, created_at, updated_at, opened_at, trashed_at, revision, content)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      owner,
      meta.id,
      meta.folderId,
      meta.name,
      meta.createdAt,
      meta.updatedAt,
      meta.openedAt,
      meta.trashedAt,
      meta.revision,
      JSON.stringify(namedContent(content, meta.name)),
    ],
  );
  await setFiles(db, owner, meta.id, fileIds);
};

const freshMeta = (
  id: DrawingMeta["id"],
  folderId: ParentId,
  name: string | null,
  at: number,
  fileIds: DrawingMeta["fileIds"],
): DrawingMeta => ({
  id,
  name,
  folderId,
  createdAt: at,
  updatedAt: at,
  openedAt: null,
  trashedAt: null,
  revision: 1,
  fileIds,
});

/** Owns atomic mutations and snapshots of private account workspaces. */
export class WorkspaceDatabase {
  constructor(
    readonly pool: Pool,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot(owner: string) {
    return snapshot(this.pool, owner);
  }

  async getDrawing(owner: string, id: string, opened = false) {
    if (!opened) {
      return drawingById(this.pool, owner, id);
    }
    return transaction(this.pool, async (client) => {
      await client.query(
        "UPDATE drawings SET opened_at = $3 WHERE owner_id = $1 AND id = $2",
        [owner, id, this.now()],
      );
      return drawingById(client, owner, id);
    });
  }

  async getThumbnails(owner: string, ids: readonly string[]) {
    const result = await this.pool.query(
      "SELECT id, thumbnail FROM drawings WHERE owner_id = $1 AND id = ANY($2::text[])",
      [owner, ids],
    );
    if (result.rows.length !== new Set(ids).size) {
      throw new ApiError(404, "not_found", "A drawing does not exist");
    }
    return result.rows.flatMap(
      (row): Array<[string, ReturnType<typeof thumbnailSchema.parse>]> =>
        row.thumbnail ? [[row.id, thumbnailSchema.parse(row.thumbnail)]] : [],
    );
  }

  async command(
    owner: string,
    requestId: string,
    command: WorkspaceCommand,
  ): Promise<CommandResponse> {
    const hash = createHash("sha256").update(canonical(command)).digest("hex");
    return transaction(this.pool, async (client) => {
      // A workspace tree and its mutation receipts have one writer per account.
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
        owner,
      ]);
      const receipt = await client.query(
        "SELECT payload_hash, result FROM mutation_receipts WHERE owner_id = $1 AND request_id = $2",
        [owner, requestId],
      );
      if (receipt.rows.length) {
        if (receipt.rows[0].payload_hash !== hash) {
          throw new ApiError(
            409,
            "request_reused",
            "That request id was used with different arguments",
          );
        }
        return {
          result: receipt.rows[0].result,
          snapshot: await snapshot(client, owner),
        };
      }
      const result = await this.apply(client, owner, command);
      await client.query(
        "INSERT INTO mutation_receipts(owner_id, request_id, payload_hash, result, created_at) VALUES($1,$2,$3,$4,$5)",
        [owner, requestId, hash, JSON.stringify(result), this.now()],
      );
      return { result, snapshot: await snapshot(client, owner) };
    });
  }

  private async apply(
    client: PoolClient,
    owner: string,
    command: WorkspaceCommand,
  ): Promise<CommandResult> {
    const now = this.now();
    switch (command.kind) {
      case "createFolder": {
        const folder = {
          id: command.id,
          parentId: command.parentId,
          name: command.name,
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
        };
        if (await folderById(client, owner, folder.id)) {
          throw new ApiError(409, "id_exists", "That folder id already exists");
        }
        await insertFolder(client, owner, folder);
        return { kind: "folder", folder };
      }
      case "renameFolder": {
        const result = await client.query(
          "UPDATE folders SET name = $3, updated_at = $4 WHERE owner_id = $1 AND id = $2",
          [owner, command.id, command.name, now],
        );
        return { kind: "change", result: result.rowCount ? OK : NOT_FOUND };
      }
      case "createDrawing": {
        if (await drawingById(client, owner, command.id)) {
          throw new ApiError(
            409,
            "id_exists",
            "That drawing id already exists",
          );
        }
        const meta = freshMeta(
          command.id,
          command.folderId,
          command.name,
          now,
          filesIn(command.content),
        );
        checkFiles(command.content, command.fileIds);
        await insertDrawing(client, owner, meta, command.content);
        return { kind: "drawing", drawing: meta };
      }
      case "duplicateDrawing": {
        const source = await drawingById(client, owner, command.sourceId);
        if (!source) {
          return { kind: "drawing", drawing: null };
        }
        if (await drawingById(client, owner, command.id)) {
          throw new ApiError(
            409,
            "id_exists",
            "That drawing id already exists",
          );
        }
        const meta = freshMeta(
          command.id,
          source.meta.folderId,
          command.name,
          now,
          source.meta.fileIds,
        );
        await insertDrawing(client, owner, meta, source.content);
        return { kind: "drawing", drawing: meta };
      }
      case "saveDrawing":
      case "renameDrawing": {
        const existing = await drawingById(client, owner, command.id);
        if (!existing) {
          return { kind: "save", result: NOT_FOUND };
        }
        if (existing.meta.revision !== command.baseRevision) {
          return {
            kind: "save",
            result: { ok: false, reason: "conflict", meta: existing.meta },
          };
        }
        const content =
          command.kind === "saveDrawing"
            ? command.content
            : namedContent(existing.content, command.name);
        const fileIds = checkFiles(
          content,
          command.kind === "saveDrawing"
            ? command.fileIds
            : existing.meta.fileIds,
        );
        const name = content.appState.name || null;
        const updated = await client.query(
          `UPDATE drawings SET name = $4, content = $5, revision = revision + 1, updated_at = $6
          WHERE owner_id = $1 AND id = $2 AND revision = $3 RETURNING id`,
          [
            owner,
            command.id,
            command.baseRevision,
            name,
            JSON.stringify(namedContent(content, name)),
            now,
          ],
        );
        if (!updated.rowCount) {
          throw new ApiError(
            409,
            "concurrent_write",
            "The drawing changed while it was saved",
          );
        }
        await setFiles(client, owner, command.id, fileIds);
        const saved = await drawingById(client, owner, command.id);
        if (!saved) {
          throw new Error("A saved drawing disappeared in its transaction");
        }
        return { kind: "save", result: { ok: true, meta: saved.meta } };
      }
      case "saveThumbnail": {
        const saved = await client.query(
          "UPDATE drawings SET thumbnail = $3 WHERE owner_id = $1 AND id = $2 AND revision = $4",
          [
            owner,
            command.id,
            JSON.stringify(command.thumbnail),
            command.thumbnail.revision,
          ],
        );
        if (saved.rowCount) {
          return { kind: "change", result: OK };
        }
        const exists = await drawingById(client, owner, command.id);
        return { kind: "change", result: exists ? OK : NOT_FOUND };
      }
      case "deleteThumbnail":
        await client.query(
          "UPDATE drawings SET thumbnail = NULL WHERE owner_id = $1 AND id = $2",
          [owner, command.id],
        );
        return { kind: "done" };
      case "move":
        return this.move(client, owner, command.item, command.target);
      case "trash":
      case "restore":
      case "deleteForever":
        return this.changeItem(client, owner, command.kind, command.item);
      case "emptyTrash": {
        const data = await snapshot(client, owner);
        await this.deleteRoots(
          client,
          owner,
          data.folders
            .filter((folder) => folder.trashedAt !== null)
            .map((folder) => folder.id),
          data.drawings
            .filter((drawing) => drawing.trashedAt !== null)
            .map((drawing) => drawing.id),
        );
        return { kind: "done" };
      }
      case "importFolder": {
        const existing = await folderById(client, owner, command.folder.id);
        if (existing) {
          if (canonical(existing) !== canonical(command.folder)) {
            throw new ApiError(
              409,
              "import_collision",
              "A different folder already has that id",
            );
          }
          return { kind: "folder", folder: existing };
        }
        await insertFolder(client, owner, command.folder, true);
        return { kind: "folder", folder: command.folder };
      }
      case "importDrawing": {
        const { meta, content } = command.drawing;
        checkFiles(content, meta.fileIds);
        const existing = await drawingById(client, owner, meta.id);
        if (existing) {
          const normalized = {
            meta: { ...meta, fileIds: [...meta.fileIds].sort() },
            content: namedContent(content, meta.name),
          };
          if (canonical(existing) !== canonical(normalized)) {
            throw new ApiError(
              409,
              "import_collision",
              "A different drawing already has that id",
            );
          }
          return { kind: "drawing", drawing: existing.meta };
        }
        await insertDrawing(client, owner, meta, content, true);
        return {
          kind: "drawing",
          drawing: { ...meta, fileIds: filesIn(content) },
        };
      }
    }
  }

  private async move(
    client: PoolClient,
    owner: string,
    item: ItemRef,
    target: ParentId,
  ): Promise<CommandResult> {
    const data = await snapshot(client, owner);
    const existing =
      item.kind === "folder"
        ? data.folders.find((folder) => folder.id === item.id)
        : data.drawings.find((drawing) => drawing.id === item.id);
    if (
      !existing ||
      (target !== null && !data.folders.some((folder) => folder.id === target))
    ) {
      return { kind: "move", result: NOT_FOUND };
    }
    if (item.kind === "folder") {
      if (item.id === target) {
        return { kind: "move", result: { ok: false, reason: "intoItself" } };
      }
      const parents = new Map(
        data.folders.map((folder) => [folder.id, folder.parentId]),
      );
      let parent = target;
      while (parent !== null) {
        if (parent === item.id) {
          return {
            kind: "move",
            result: { ok: false, reason: "intoDescendant" },
          };
        }
        parent = parents.get(parent) ?? null;
      }
    }
    if (trashedFolder(data.folders, target)) {
      return { kind: "move", result: { ok: false, reason: "targetTrashed" } };
    }
    // what's in the Trash comes out only through restore, as in the app
    if (
      existing.trashedAt !== null ||
      trashedFolder(
        data.folders,
        "folderId" in existing ? existing.folderId : existing.parentId,
      )
    ) {
      return { kind: "move", result: NOT_FOUND };
    }
    const table = item.kind === "folder" ? "folders" : "drawings";
    const column = item.kind === "folder" ? "parent_id" : "folder_id";
    await client.query(
      `UPDATE ${table} SET ${column} = $3 WHERE owner_id = $1 AND id = $2`,
      [owner, item.id, target],
    );
    return { kind: "move", result: OK };
  }

  private async changeItem(
    client: PoolClient,
    owner: string,
    kind: "trash" | "restore" | "deleteForever",
    item: ItemRef,
  ): Promise<CommandResult> {
    const table = item.kind === "folder" ? "folders" : "drawings";
    if (kind === "deleteForever") {
      const result = await client.query(
        `DELETE FROM ${table} WHERE owner_id = $1 AND id = $2`,
        [owner, item.id],
      );
      return { kind: "change", result: result.rowCount ? OK : NOT_FOUND };
    }
    if (kind === "trash") {
      const result = await client.query(
        `UPDATE ${table} SET trashed_at = COALESCE(trashed_at, $3) WHERE owner_id = $1 AND id = $2`,
        [owner, item.id, this.now()],
      );
      return { kind: "change", result: result.rowCount ? OK : NOT_FOUND };
    }
    const record =
      item.kind === "folder"
        ? await folderById(client, owner, item.id)
        : (await drawingById(client, owner, item.id))?.meta;
    if (!record) {
      return { kind: "change", result: NOT_FOUND };
    }
    const parent = "parentId" in record ? record.parentId : record.folderId;
    const destination = trashedFolder(
      (await snapshot(client, owner)).folders,
      parent,
    )
      ? null
      : parent;
    const column = item.kind === "folder" ? "parent_id" : "folder_id";
    await client.query(
      `UPDATE ${table} SET trashed_at = NULL, ${column} = $3 WHERE owner_id = $1 AND id = $2`,
      [owner, item.id, destination],
    );
    return { kind: "change", result: OK };
  }

  private async deleteRoots(
    client: PoolClient,
    owner: string,
    folders: readonly string[],
    drawings: readonly string[],
  ) {
    await client.query(
      "DELETE FROM folders WHERE owner_id = $1 AND id = ANY($2::text[])",
      [owner, folders],
    );
    await client.query(
      "DELETE FROM drawings WHERE owner_id = $1 AND id = ANY($2::text[])",
      [owner, drawings],
    );
  }

  /** Removes expired trash, old mutation receipts, and images after their unreferenced grace period. */
  async collect() {
    const now = this.now();
    const owners = await this.pool.query("SELECT id FROM users");
    for (const row of owners.rows) {
      await transaction(this.pool, async (client) => {
        const owner: string = row.id;
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
          owner,
        ]);
        const data = await snapshot(client, owner);
        const expired = (at: number | null) =>
          at !== null && now - at >= 30 * DAY;
        await this.deleteRoots(
          client,
          owner,
          data.folders
            .filter((folder) => expired(folder.trashedAt))
            .map((folder) => folder.id),
          data.drawings
            .filter((drawing) => expired(drawing.trashedAt))
            .map((drawing) => drawing.id),
        );
        await client.query(
          `DELETE FROM assets a WHERE owner_id = $1 AND GREATEST(uploaded_at, last_retrieved) < $2
          AND NOT EXISTS (SELECT 1 FROM drawing_assets r WHERE r.owner_id = a.owner_id AND r.file_id = a.file_id)`,
          [owner, now - DAY],
        );
        // A browser resumes an interrupted import by replaying its import receipts.
        await client.query(
          "DELETE FROM mutation_receipts WHERE owner_id = $1 AND created_at <= $2 AND request_id NOT LIKE 'import-%'",
          [owner, now - 30 * DAY],
        );
      });
    }
    await this.pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
    await this.pool.query("DELETE FROM auth_attempts WHERE expires_at <= $1", [
      now,
    ]);
  }
}
