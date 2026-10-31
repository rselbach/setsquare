import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import pg from "pg";

import type { Pool, PoolClient } from "pg";

/** Opens the PostgreSQL connection pool for a server instance. */
export const openDatabase = (connectionString: string): Pool =>
  new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });

/** Commits a unit of storage work using one connection. */
export const transaction = async <T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Transaction rollback failed",
      );
    }
    throw error;
  } finally {
    client.release();
  }
};

const migrationPattern = /^(\d{3})-[a-z0-9-]+\.sql$/;

// the schema migrations in a directory, keyed and ordered by version
const readMigrations = async (directory: URL) => {
  const filenames = (await readdir(directory))
    .filter((filename) => !filename.startsWith("."))
    .sort();
  const migrations = new Map<
    number,
    { filename: string; sql: string; checksum: string }
  >();
  for (const filename of filenames) {
    const match = migrationPattern.exec(filename);
    if (!match) {
      throw new Error(
        `Migration ${filename} must be named like 001-description.sql`,
      );
    }
    const version = Number(match[1]);
    const duplicate = migrations.get(version);
    if (duplicate) {
      throw new Error(
        `Migrations ${duplicate.filename} and ${filename} share version ${version}`,
      );
    }
    const bytes = await readFile(new URL(filename, directory));
    migrations.set(version, {
      filename,
      sql: bytes.toString("utf8"),
      checksum: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return migrations;
};

/** Applies each migration file once, including when several servers start together. */
export const migrate = async (
  pool: Pool,
  directory = new URL("../migrations/", import.meta.url),
) => {
  const migrations = await readMigrations(directory);
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(731894127493::bigint)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)",
    );
    await client.query(
      "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
    );
    const applied = await client.query<{
      version: number;
      checksum: string | null;
    }>("SELECT version, checksum FROM schema_migrations");
    for (const { version, checksum } of applied.rows) {
      const migration = migrations.get(version);
      if (!migration) {
        throw new Error(
          `Migration version ${version} was applied, but no migration file has that version, so this build may be older than the database`,
        );
      }
      if (checksum === null) {
        await client.query(
          "UPDATE schema_migrations SET checksum = $2 WHERE version = $1",
          [version, migration.checksum],
        );
        continue;
      }
      if (checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.filename} changed after it was applied`,
        );
      }
    }
    const appliedVersions = new Set(applied.rows.map((row) => row.version));
    for (const [version, migration] of migrations) {
      if (appliedVersions.has(version)) {
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations(version, checksum) VALUES($1, $2)",
        [version, migration.checksum],
      );
    }
  });
};
