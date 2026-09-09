import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { LatLng } from "./geo";
import type { BikeRoute } from "./types";

export type { BikeRoute };

const DB_PATH = process.env.BIKE_DB_PATH ?? path.join(process.cwd(), "data", "routes.db");

// One connection per server process. `globalThis` keeps it alive across the
// hot-reloads the Next.js dev server does on every file change.
const globalForDb = globalThis as unknown as { __bikeDb?: DatabaseSync };

function createConnection(): DatabaseSync {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id         TEXT PRIMARY KEY,
      geometry   TEXT NOT NULL,          -- JSON: [[lat, lng], ...]
      reason     TEXT,
      created_at TEXT NOT NULL           -- ISO 8601
    );
  `);
  return db;
}

function getDb(): DatabaseSync {
  if (!globalForDb.__bikeDb) globalForDb.__bikeDb = createConnection();
  return globalForDb.__bikeDb;
}

type Row = { id: string; geometry: string; reason: string | null; created_at: string };

const rowToRoute = (r: Row): BikeRoute => ({
  id: r.id,
  geometry: JSON.parse(r.geometry) as LatLng[],
  reason: r.reason,
  createdAt: r.created_at,
});

export function listRoutes(): BikeRoute[] {
  const rows = getDb()
    .prepare("SELECT id, geometry, reason, created_at FROM routes ORDER BY created_at DESC")
    .all() as Row[];
  return rows.map(rowToRoute);
}

export function countRoutes(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM routes").get() as { n: number };
  return row.n;
}

export function insertRoute(geometry: LatLng[], reason: string | null): BikeRoute {
  const route: BikeRoute = {
    id: crypto.randomUUID(),
    geometry,
    reason,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO routes (id, geometry, reason, created_at) VALUES (?, ?, ?, ?)")
    .run(route.id, JSON.stringify(route.geometry), route.reason, route.createdAt);
  return route;
}
