import type { BinaryFileData } from "@setsquare/setsquare/types";

import { transaction } from "./database";
import { ApiError } from "./errors";
import { filesSchema } from "./validation";

import type { Pool } from "pg";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const imageMatches = (bytes: Buffer, mime: string) => {
  switch (mime) {
    case "image/png":
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg":
    case "image/jfif":
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(
        bytes.subarray(0, 6).toString("ascii"),
      );
    case "image/webp":
      return (
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "image/bmp":
      return bytes.subarray(0, 2).toString("ascii") === "BM";
    case "image/x-icon":
      return bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
    case "image/avif":
      return (
        bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
        /avif|avis/.test(bytes.subarray(8, 32).toString("ascii"))
      );
    case "image/svg+xml": {
      const text = bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .replace(/<!DOCTYPE\s+svg\s+[^>\u005B]*>/i, "");
      return (
        /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(text) &&
        !/<!DOCTYPE|<!ENTITY|<script\b/i.test(text)
      );
    }
    default:
      return false;
  }
};

const imageBytes = (file: BinaryFileData) => {
  const match = /^data:([^;]+);base64,(.*)$/.exec(file.dataURL);
  if (!match || match[1] !== file.mimeType) {
    throw new ApiError(
      400,
      "invalid_image",
      "Image content does not match its media type",
    );
  }
  const bytes = Buffer.from(match[2], "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_FILE_BYTES ||
    bytes.toString("base64") !== match[2] ||
    !imageMatches(bytes, file.mimeType)
  ) {
    throw new ApiError(
      400,
      "invalid_image",
      "Upload a supported image no larger than 5 MiB",
    );
  }
  return bytes;
};

/** Stores private images independently of the drawings that reference them. */
export class FileDatabase {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = Date.now,
  ) {}

  async get(owner: string, ids: readonly string[]) {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE assets SET last_retrieved = $3 WHERE owner_id = $1 AND file_id = ANY($2::text[])
        RETURNING file_id, mime_type, bytes, created_at, last_retrieved, version`,
        [owner, ids, this.now()],
      );
      if (result.rows.length !== new Set(ids).size) {
        throw new ApiError(404, "not_found", "An image does not exist");
      }
      const files = result.rows.map((row) => ({
        id: row.file_id,
        mimeType: row.mime_type,
        dataURL: `data:${row.mime_type};base64,${row.bytes.toString("base64")}`,
        created: Number(row.created_at),
        lastRetrieved: Number(row.last_retrieved),
        version: row.version,
      }));
      return filesSchema.parse({ files });
    });
  }

  async save(owner: string, files: readonly BinaryFileData[]) {
    if (new Set(files.map((file) => file.id)).size !== files.length) {
      throw new ApiError(
        400,
        "duplicate_files",
        "An image id appears more than once",
      );
    }
    const uploads = files.map((file) => ({ file, bytes: imageBytes(file) }));
    return transaction(this.pool, async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
        owner,
      ]);
      for (const { file, bytes } of uploads) {
        const result = await client.query(
          "SELECT mime_type, bytes, version FROM assets WHERE owner_id = $1 AND file_id = $2",
          [owner, file.id],
        );
        if (result.rows.length) {
          const existing = result.rows[0];
          if (
            (existing.mime_type !== file.mimeType ||
              !bytes.equals(existing.bytes)) &&
            (file.version ?? 1) <= existing.version
          ) {
            throw new ApiError(
              409,
              "image_collision",
              "That image version already has different content",
            );
          }
          await client.query(
            `UPDATE assets SET last_retrieved = $3, version = GREATEST(version, $4),
            mime_type = $5, bytes = $6 WHERE owner_id = $1 AND file_id = $2`,
            [
              owner,
              file.id,
              this.now(),
              file.version ?? 1,
              file.mimeType,
              bytes,
            ],
          );
          continue;
        }
        const now = this.now();
        await client.query(
          `INSERT INTO assets(owner_id, file_id, mime_type, bytes, created_at, uploaded_at, last_retrieved, version)
          VALUES($1,$2,$3,$4,$5,$6,$6,$7)`,
          [
            owner,
            file.id,
            file.mimeType,
            bytes,
            file.created,
            now,
            file.version ?? 1,
          ],
        );
      }
      return filesSchema.parse({ files });
    });
  }
}
