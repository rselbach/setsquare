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
  'fileIds', COALESCE((SELECT jsonb_agg(a.file_id ORDER BY a.file_id COLLATE "C")
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

const drawingMetaById = async (db: Queryable, owner: string, id: string) => {
  const result = await db.query(
    `SELECT ${drawingMeta} AS data FROM drawings d WHERE d.owner_id = $1 AND d.id = $2`,
    [owner, id],
  );
  return result.rows.length
    ? drawingMetaSchema.parse(result.rows[0].data)
    : null;
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

// the folder and its ancestors, nearest first; a repeated folder closes a cycle
const ancestors = async (db: Queryable, owner: string, id: ParentId) => {
  if (id === null) {
    return [];
  }
  const result = await db.query(
    `WITH RECURSIVE up(id, parent_id, trashed, depth, path, cycle) AS (
      SELECT id, parent_id, trashed_at IS NOT NULL, 0, ARRAY[id], false
      FROM folders WHERE owner_id = $1 AND id = $2
      UNION ALL
      SELECT f.id, f.parent_id, f.trashed_at IS NOT NULL, up.depth + 1, up.path || f.id, f.id = ANY(up.path)
      FROM up JOIN folders f ON f.owner_id = $1 AND f.id = up.parent_id
      WHERE NOT up.cycle
    ) SELECT id, trashed, cycle FROM up ORDER BY depth`,
    [owner, id],
  );
  return result.rows as Array<{ id: string; trashed: boolean; cycle: boolean }>;
};

const trashedFolder = (
  chain: Awaited<ReturnType<typeof ancestors>>,
): boolean => {
  for (const folder of chain) {
    if (folder.cycle) {
      throw new ApiError(
        409,
        "invalid_tree",
        "The folder tree contains a cycle",
      );
    }
    if (folder.trashed) {
      return true;
    }
  }
  return false;
};

const checkParent = async (
  db: Queryable,
  owner: string,
  id: ParentId,
  importing: boolean,
) => {
  const chain = await ancestors(db, owner, id);
  if (id !== null && !chain.length) {
    throw new ApiError(
      404,
      "not_found",
      "The destination folder does not exist",
    );
  }
  if (!importing && trashedFolder(chain)) {
    throw new ApiError(
      409,
      "target_trashed",
      "The destination folder is in the Trash",
    );
  }
};

// an item's containing folder and whether it is itself in the Trash
const placement = async (db: Queryable, owner: string, item: ItemRef) => {
  const result = await db.query(
    item.kind === "folder"
      ? "SELECT parent_id AS parent, trashed_at IS NOT NULL AS trashed FROM folders WHERE owner_id = $1 AND id = $2"
      : "SELECT folder_id AS parent, trashed_at IS NOT NULL AS trashed FROM drawings WHERE owner_id = $1 AND id = $2",
    [owner, item.id],
  );
  return result.rows[0] as { parent: ParentId; trashed: boolean } | undefined;
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
  await checkParent(db, owner, folder.parentId, importing);
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
  await checkParent(db, owner, meta.folderId, importing);
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

  /**
   * Applies a command once per request id and returns its result. Callers that
   * need the tree read a snapshot after this commits, outside the account lock.
   */
  async command(
    owner: string,
    requestId: string,
    command: WorkspaceCommand,
  ): Promise<CommandResult> {
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
        return receipt.rows[0].result;
      }
      const result = await this.apply(client, owner, command);
      await client.query(
        "INSERT INTO mutation_receipts(owner_id, request_id, payload_hash, result, created_at) VALUES($1,$2,$3,$4,$5)",
        [owner, requestId, hash, JSON.stringify(result), this.now()],
      );
      return result;
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
        const existing = await drawingMetaById(client, owner, command.id);
        if (!existing) {
          return { kind: "save", result: NOT_FOUND };
        }
        if (existing.revision !== command.baseRevision) {
          return {
            kind: "save",
            result: { ok: false, reason: "conflict", meta: existing },
          };
        }
        const saving = command.kind === "saveDrawing";
        const name =
          (saving ? command.content.appState.name : command.name) || null;
        const fileIds = saving
          ? checkFiles(command.content, command.fileIds)
          : existing.fileIds;
        // a rename rewrites only the stored scene's name
        const updated = await client.query(
          `UPDATE drawings SET name = $4, revision = revision + 1, updated_at = $6,
            content = COALESCE($5::jsonb, jsonb_set(content, '{appState,name}', COALESCE(to_jsonb($4::text), 'null')))
          WHERE owner_id = $1 AND id = $2 AND revision = $3`,
          [
            owner,
            command.id,
            command.baseRevision,
            name,
            saving ? JSON.stringify(namedContent(command.content, name)) : null,
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
        if (saving) {
          await setFiles(client, owner, command.id, fileIds);
        }
        const meta = {
          ...existing,
          name,
          updatedAt: now,
          revision: existing.revision + 1,
          fileIds,
        };
        return { kind: "save", result: { ok: true, meta } };
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
      case "emptyTrash":
        await this.deleteTrash(client, owner, Number.MAX_SAFE_INTEGER);
        return { kind: "done" };
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
    const existing = await placement(client, owner, item);
    const chain = await ancestors(client, owner, target);
    if (!existing || (target !== null && !chain.length)) {
      return { kind: "move", result: NOT_FOUND };
    }
    if (item.kind === "folder") {
      if (item.id === target) {
        return { kind: "move", result: { ok: false, reason: "intoItself" } };
      }
      if (chain.some((folder) => folder.id === item.id)) {
        return {
          kind: "move",
          result: { ok: false, reason: "intoDescendant" },
        };
      }
    }
    if (trashedFolder(chain)) {
      return { kind: "move", result: { ok: false, reason: "targetTrashed" } };
    }
    // what's in the Trash comes out only through restore, as in the app
    if (
      existing.trashed ||
      trashedFolder(await ancestors(client, owner, existing.parent))
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
    const record = await placement(client, owner, item);
    if (!record) {
      return { kind: "change", result: NOT_FOUND };
    }
    const destination = trashedFolder(
      await ancestors(client, owner, record.parent),
    )
      ? null
      : record.parent;
    const column = item.kind === "folder" ? "parent_id" : "folder_id";
    await client.query(
      `UPDATE ${table} SET trashed_at = NULL, ${column} = $3 WHERE owner_id = $1 AND id = $2`,
      [owner, item.id, destination],
    );
    return { kind: "change", result: OK };
  }

  private async deleteTrash(
    client: PoolClient,
    owner: string,
    trashedBy: number,
  ) {
    await client.query(
      "DELETE FROM folders WHERE owner_id = $1 AND trashed_at <= $2",
      [owner, trashedBy],
    );
    await client.query(
      "DELETE FROM drawings WHERE owner_id = $1 AND trashed_at <= $2",
      [owner, trashedBy],
    );
  }

  /**
   * Removes expired sessions and sign-in attempts, expired trash, old mutation
   * receipts, and images after their unreferenced grace period. A failing step
   * or account is reported to onFailure and the remaining ones still run.
   */
  async collect(onFailure: (error: unknown, ownerId?: string) => void) {
    const now = this.now();
    await this.pool
      .query("DELETE FROM sessions WHERE expires_at <= $1", [now])
      .catch(onFailure);
    await this.pool
      .query("DELETE FROM auth_attempts WHERE expires_at <= $1", [now])
      .catch(onFailure);
    const owners = await this.pool.query("SELECT id FROM users");
    for (const row of owners.rows) {
      const owner: string = row.id;
      await transaction(this.pool, async (client) => {
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
          owner,
        ]);
        await this.deleteTrash(client, owner, now - 30 * DAY);
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
      }).catch((error) => onFailure(error, owner));
    }
  }
}
