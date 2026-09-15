import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { LatLng } from "./geo";
import type { AdminBikeRoute, BikeRoute } from "./types";

export type { BikeRoute };

/** Routes with at least this many distinct-IP reports auto-hide from the public list. */
export const REPORT_HIDE_THRESHOLD = 3;

const LOCAL_FILE_URL = "file:data/routes.db";

/**
 * Where to connect. With `TURSO_DATABASE_URL` set we use that (Turso / libSQL).
 * Otherwise we fall back to a local SQLite file, which only works where the
 * filesystem is writable (local dev, a VPS with a disk) — on a read-only host
 * like Vercel this throws a clear "set TURSO_DATABASE_URL" error instead of a
 * cryptic mkdir crash at import time.
 */
function resolveDbUrl(): string {
  const configured = process.env.TURSO_DATABASE_URL;
  if (configured) return configured;

  try {
    mkdirSync(path.dirname(LOCAL_FILE_URL.slice("file:".length)), { recursive: true });
  } catch (err) {
    throw new Error(
      "No database configured for this environment. Set TURSO_DATABASE_URL " +
        "(and TURSO_AUTH_TOKEN) in your deployment's environment variables. " +
        `Falling back to a local file failed: ${(err as Error).message}`,
    );
  }
  return LOCAL_FILE_URL;
}

// Reuse the client and the "schema ready" promise across hot-reloads / warm
// serverless invocations.
const globalForDb = globalThis as unknown as {
  __bikeDb?: Client;
  __bikeSchema?: Promise<void>;
};

export function getClient(): Client {
  if (!globalForDb.__bikeDb) {
    globalForDb.__bikeDb = createClient({
      url: resolveDbUrl(),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return globalForDb.__bikeDb;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS routes (
     id         TEXT PRIMARY KEY,
     geometry   TEXT NOT NULL,          -- JSON: [[lat, lng], ...]
     reason     TEXT,
     zip        TEXT,                   -- optional self-reported US ZIP, NULL = not collected
     ip_hash    TEXT,                   -- salted SHA-256 of the submitter's IP (for bans)
     hidden_at  TEXT,                   -- ISO 8601; set when reports cross REPORT_HIDE_THRESHOLD
     created_at TEXT NOT NULL           -- ISO 8601
   )`,
  `CREATE TABLE IF NOT EXISTS rate_hits (
     ip_hash TEXT NOT NULL,             -- salted SHA-256 of the client IP
     hit_at  INTEGER NOT NULL           -- epoch ms
   )`,
  `CREATE INDEX IF NOT EXISTS idx_rate_hits ON rate_hits (ip_hash, hit_at)`,
  // One row per (route, reporting IP) — the primary key means a second report
  // from the same IP on the same route is a harmless no-op, so reporting needs
  // no rate limiting of its own.
  `CREATE TABLE IF NOT EXISTS route_reports (
     route_id   TEXT NOT NULL,
     ip_hash    TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (route_id, ip_hash)
   )`,
  `CREATE TABLE IF NOT EXISTS banned_ips (
     ip_hash   TEXT PRIMARY KEY,
     reason    TEXT,
     banned_at TEXT NOT NULL
   )`,
];

/** Create the tables once per process. Callers await this before querying. */
export function ensureSchema(): Promise<void> {
  if (!globalForDb.__bikeSchema) {
    const client = getClient();
    globalForDb.__bikeSchema = (async () => {
      for (const statement of SCHEMA) await client.execute(statement);
      // Migrate DBs created before `zip` / `ip_hash` / `hidden_at` existed.
      // SQLite has no `ADD COLUMN IF NOT EXISTS`, so probe the table first.
      // Non-destructive: existing rows get NULL.
      const info = await client.execute("PRAGMA table_info(routes)");
      const existing = new Set(info.rows.map((r) => r.name as string));
      for (const column of ["zip", "ip_hash", "hidden_at"]) {
        if (!existing.has(column)) {
          await client.execute(`ALTER TABLE routes ADD COLUMN ${column} TEXT`);
        }
      }
    })().catch((err) => {
      // Let the next call retry rather than caching a rejected promise.
      globalForDb.__bikeSchema = undefined;
      throw err;
    });
  }
  return globalForDb.__bikeSchema;
}

type Row = {
  id: string;
  geometry: string;
  reason: string | null;
  zip: string | null;
  created_at: string;
};

const rowToRoute = (r: Row): BikeRoute => ({
  id: r.id,
  geometry: JSON.parse(r.geometry) as LatLng[],
  reason: r.reason,
  zip: r.zip,
  createdAt: r.created_at,
});

/** Public listing: never includes routes hidden by reports, never includes ip_hash. */
export async function listRoutes(): Promise<BikeRoute[]> {
  await ensureSchema();
  const rs = await getClient().execute(
    "SELECT id, geometry, reason, zip, created_at FROM routes WHERE hidden_at IS NULL ORDER BY created_at DESC",
  );
  return rs.rows.map((r) => rowToRoute(r as unknown as Row));
}

type AdminRow = Row & { hidden_at: string | null; report_count: number | bigint };

/** Admin listing: everything, including hidden routes and each one's report count. */
export async function listRoutesForAdmin(): Promise<AdminBikeRoute[]> {
  await ensureSchema();
  const rs = await getClient().execute(`
    SELECT r.id, r.geometry, r.reason, r.zip, r.created_at, r.hidden_at,
           (SELECT COUNT(*) FROM route_reports rr WHERE rr.route_id = r.id) AS report_count
    FROM routes r
    ORDER BY r.created_at DESC
  `);
  return (rs.rows as unknown as AdminRow[]).map((r) => ({
    ...rowToRoute(r),
    reportCount: Number(r.report_count),
    hidden: r.hidden_at != null,
  }));
}

export async function countRoutes(): Promise<number> {
  await ensureSchema();
  const rs = await getClient().execute("SELECT COUNT(*) AS n FROM routes");
  return Number(rs.rows[0].n);
}

export async function insertRoute(
  geometry: LatLng[],
  reason: string | null,
  zip: string | null,
  ipHash: string | null,
): Promise<BikeRoute> {
  await ensureSchema();
  const route: BikeRoute = {
    id: crypto.randomUUID(),
    geometry,
    reason,
    zip,
    createdAt: new Date().toISOString(),
  };
  await getClient().execute({
    sql: "INSERT INTO routes (id, geometry, reason, zip, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      route.id,
      JSON.stringify(route.geometry),
      route.reason,
      route.zip,
      ipHash,
      route.createdAt,
    ],
  });
  return route;
}

/** Returns true if a row was deleted, false if no route had that id. */
export async function deleteRoute(id: string): Promise<boolean> {
  await ensureSchema();
  const rs = await getClient().execute({
    sql: "DELETE FROM routes WHERE id = ?",
    args: [id],
  });
  return rs.rowsAffected > 0;
}

/** The route's stored submitter ip_hash. `found: false` if the route doesn't exist. */
export async function getRouteIpHash(
  id: string,
): Promise<{ found: boolean; ipHash: string | null }> {
  await ensureSchema();
  const rs = await getClient().execute({
    sql: "SELECT ip_hash FROM routes WHERE id = ?",
    args: [id],
  });
  if (rs.rows.length === 0) return { found: false, ipHash: null };
  return {
    found: true,
    ipHash: (rs.rows[0] as unknown as { ip_hash: string | null }).ip_hash,
  };
}

/** Clears a route's hidden-by-reports state (e.g. after a bad-faith report campaign). */
export async function unhideRoute(id: string): Promise<boolean> {
  await ensureSchema();
  const rs = await getClient().execute({
    sql: "UPDATE routes SET hidden_at = NULL WHERE id = ?",
    args: [id],
  });
  return rs.rowsAffected > 0;
}

export async function isIpBanned(ipHash: string): Promise<boolean> {
  await ensureSchema();
  const rs = await getClient().execute({
    sql: "SELECT 1 FROM banned_ips WHERE ip_hash = ?",
    args: [ipHash],
  });
  return rs.rows.length > 0;
}

/** Bans (or updates the reason on an existing ban for) an IP hash. */
export async function banIp(ipHash: string, reason: string | null): Promise<void> {
  await ensureSchema();
  await getClient().execute({
    sql: `INSERT INTO banned_ips (ip_hash, reason, banned_at) VALUES (?, ?, ?)
          ON CONFLICT (ip_hash) DO UPDATE SET reason = excluded.reason, banned_at = excluded.banned_at`,
    args: [ipHash, reason, new Date().toISOString()],
  });
}

/**
 * Records a report from `ipHash` against `routeId` (a repeat report from the same
 * IP is a no-op). Auto-hides the route once distinct reports reach
 * REPORT_HIDE_THRESHOLD. Returns null if the route doesn't exist.
 */
export async function addReport(
  routeId: string,
  ipHash: string,
): Promise<{ reportCount: number; hidden: boolean } | null> {
  await ensureSchema();
  const client = getClient();

  const existing = await client.execute({
    sql: "SELECT hidden_at FROM routes WHERE id = ?",
    args: [routeId],
  });
  if (existing.rows.length === 0) return null;

  await client.execute({
    sql: "INSERT OR IGNORE INTO route_reports (route_id, ip_hash, created_at) VALUES (?, ?, ?)",
    args: [routeId, ipHash, new Date().toISOString()],
  });

  const countRs = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM route_reports WHERE route_id = ?",
    args: [routeId],
  });
  const reportCount = Number(countRs.rows[0].n);

  let hidden =
    (existing.rows[0] as unknown as { hidden_at: string | null }).hidden_at != null;
  if (!hidden && reportCount >= REPORT_HIDE_THRESHOLD) {
    await client.execute({
      sql: "UPDATE routes SET hidden_at = ? WHERE id = ?",
      args: [new Date().toISOString(), routeId],
    });
    hidden = true;
  }

  return { reportCount, hidden };
}
