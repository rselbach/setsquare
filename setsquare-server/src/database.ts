import { readFile } from "node:fs/promises";

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

/** Applies each migration once, including when several servers start together. */
export const migrate = async (pool: Pool) => {
  const sql = await readFile(
    new URL("../migrations/001-initial.sql", import.meta.url),
    "utf8",
  );
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(731894127493::bigint)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)",
    );
    const result = await client.query(
      "SELECT version FROM schema_migrations WHERE version = 1",
    );
    if (result.rowCount) {
      return;
    }
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(version) VALUES(1)");
  });
};
