// Postgres connection seam.
//
// Every database call in the app goes through here, which is what keeps the
// storage choice swappable: nothing outside src/lib/db.ts and the migration
// runner knows which driver is underneath.
//
// Configuration is a single DATABASE_URL, so this works unchanged on a local
// Postgres, a managed provider (Neon, Render, Fly) or a self-hosted one.
// TLS comes from the connection string's `sslmode`, which the driver honours.

import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  // Reused across hot reloads in development, so a reload does not leak a pool
  // per module instance.
  var __enginexPool: Pool | undefined;
}

export function databaseUrl(): string {
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a Postgres database, e.g. " +
        "postgres://user:pass@host:5432/enginex (see .env.example).",
    );
  }
  return url;
}

/**
 * How many connections this instance holds open.
 *
 * A long-running server can afford a pool. A serverless function cannot: every
 * warm instance keeps its own, so a modest traffic spike opens a connection
 * storm that a small Postgres plan answers with "too many clients already". On a
 * serverless platform (Vercel sets VERCEL=1) the default therefore drops to one
 * connection, which a pooled connection string multiplexes anyway. Either way
 * DATABASE_POOL_MAX wins when it is set.
 */
function poolSize(): number {
  const fallback = process.env.VERCEL ? 1 : 10;
  const max = Number(process.env.DATABASE_POOL_MAX ?? fallback);
  return Number.isFinite(max) && max > 0 ? max : fallback;
}

function createPool(): Pool {
  return new Pool({
    connectionString: databaseUrl(),
    max: poolSize(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getPool(): Pool {
  if (!globalThis.__enginexPool) {
    globalThis.__enginexPool = createPool();
    // A pool-level error (a backend restart, a dropped idle connection) must not
    // take the process down: without a listener Node treats it as unhandled.
    globalThis.__enginexPool.on("error", (err) => {
      console.error("[pg] idle client error:", err.message);
    });
  }
  return globalThis.__enginexPool;
}

/** Run a query and return the rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/** Run a query that should match at most one row. */
export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run several statements in one transaction. Used where a partial write would
 * leave the workspace inconsistent (replacing drafts, resetting a tenant).
 */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A rollback failure must not mask the original error.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Only used by tests and scripts that need the process to exit cleanly. */
export async function closePool(): Promise<void> {
  if (globalThis.__enginexPool) {
    const pool = globalThis.__enginexPool;
    globalThis.__enginexPool = undefined;
    await pool.end();
  }
}
