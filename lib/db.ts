import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { LatLng } from "./geo";
import type { BikeRoute } from "./types";

export type { BikeRoute };

// Local dev with no env set → a SQLite file at data/routes.db.
// Production (Vercel) → point TURSO_DATABASE_URL / TURSO_AUTH_TOKEN at a Turso database.
const DB_URL = process.env.TURSO_DATABASE_URL ?? "file:data/routes.db";
const DB_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (DB_URL.startsWith("file:")) {
  const dir = path.dirname(DB_URL.slice("file:".length));
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
}

// Reuse the client and the "schema ready" promise across hot-reloads / warm
// serverless invocations.
const globalForDb = globalThis as unknown as {
  __bikeDb?: Client;
  __bikeSchema?: Promise<void>;
};

export function getClient(): Client {
  if (!globalForDb.__bikeDb) {
    globalForDb.__bikeDb = createClient({ url: DB_URL, authToken: DB_AUTH_TOKEN });
  }
  return globalForDb.__bikeDb;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS routes (
     id         TEXT PRIMARY KEY,
     geometry   TEXT NOT NULL,          -- JSON: [[lat, lng], ...]
     reason     TEXT,
     created_at TEXT NOT NULL           -- ISO 8601
   )`,
  `CREATE TABLE IF NOT EXISTS rate_hits (
     ip_hash TEXT NOT NULL,             -- salted SHA-256 of the client IP
     hit_at  INTEGER NOT NULL           -- epoch ms
   )`,
  `CREATE INDEX IF NOT EXISTS idx_rate_hits ON rate_hits (ip_hash, hit_at)`,
];

/** Create the tables once per process. Callers await this before querying. */
export function ensureSchema(): Promise<void> {
  if (!globalForDb.__bikeSchema) {
    const client = getClient();
    globalForDb.__bikeSchema = (async () => {
      for (const statement of SCHEMA) await client.execute(statement);
    })().catch((err) => {
      // Let the next call retry rather than caching a rejected promise.
      globalForDb.__bikeSchema = undefined;
      throw err;
    });
  }
  return globalForDb.__bikeSchema;
}

type Row = { id: string; geometry: string; reason: string | null; created_at: string };

const rowToRoute = (r: Row): BikeRoute => ({
  id: r.id,
  geometry: JSON.parse(r.geometry) as LatLng[],
  reason: r.reason,
  createdAt: r.created_at,
});

export async function listRoutes(): Promise<BikeRoute[]> {
  await ensureSchema();
  const rs = await getClient().execute(
    "SELECT id, geometry, reason, created_at FROM routes ORDER BY created_at DESC",
  );
  return rs.rows.map((r) => rowToRoute(r as unknown as Row));
}

export async function countRoutes(): Promise<number> {
  await ensureSchema();
  const rs = await getClient().execute("SELECT COUNT(*) AS n FROM routes");
  return Number(rs.rows[0].n);
}

export async function insertRoute(geometry: LatLng[], reason: string | null): Promise<BikeRoute> {
  await ensureSchema();
  const route: BikeRoute = {
    id: crypto.randomUUID(),
    geometry,
    reason,
    createdAt: new Date().toISOString(),
  };
  await getClient().execute({
    sql: "INSERT INTO routes (id, geometry, reason, created_at) VALUES (?, ?, ?, ?)",
    args: [route.id, JSON.stringify(route.geometry), route.reason, route.createdAt],
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
