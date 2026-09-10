// Seeds the database with a plausible set of Boston bike-lane requests so the
// heatmap has something to show on first run. Safe to re-run: it clears the
// `routes` table first.
//
//   node scripts/seed.mjs                       # local file (data/routes.db)
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/seed.mjs   # remote
//
// Several requests deliberately overlap along Massachusetts Avenue so that
// corridor renders as the clear hotspot.

import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_URL = process.env.TURSO_DATABASE_URL ?? "file:data/routes.db";
const DB_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (DB_URL.startsWith("file:")) {
  const dir = path.dirname(DB_URL.slice("file:".length));
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
}

const db = createClient({ url: DB_URL, authToken: DB_AUTH_TOKEN });
await db.execute(`
  CREATE TABLE IF NOT EXISTS routes (
    id         TEXT PRIMARY KEY,
    geometry   TEXT NOT NULL,
    reason     TEXT,
    zip        TEXT,
    created_at TEXT NOT NULL
  )
`);

/** Massachusetts Ave spine, Back Bay down to Boston Medical Center. */
const MASS_AVE = [
  [42.3541, -71.0902],
  [42.352, -71.0885],
  [42.349, -71.087],
  [42.3475, -71.085],
  [42.3425, -71.083],
  [42.34, -71.081],
  [42.3375, -71.079],
  [42.3345, -71.0755],
  [42.3335, -71.073],
];

const jitter = (pts, amount = 0.0006, seed = 1) => {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  return pts.map(([lat, lng]) => [lat + rand() * amount, lng + rand() * amount]);
};

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

const seeds = [
  // --- Mass Ave: five overlapping requests => hotspot -------------------------
  {
    geometry: jitter(MASS_AVE, 0.0005, 7),
    reason:
      "Mass Ave is the backbone of cycling in the city and the painted lane just vanishes at the worst intersections.",
    zip: "02118",
    createdAt: daysAgo(21),
  },
  {
    geometry: jitter(MASS_AVE.slice(0, 7), 0.0006, 13),
    reason: "I commute Symphony to MIT every day and dread the stretch past Boylston.",
    createdAt: daysAgo(18),
  },
  {
    geometry: jitter(MASS_AVE.slice(2), 0.0006, 29),
    reason: "Protected lane needed all the way to Boston Medical Center for staff and patients.",
    createdAt: daysAgo(12),
  },
  {
    geometry: jitter(MASS_AVE.slice(1, 8), 0.0007, 41),
    reason: null,
    createdAt: daysAgo(9),
  },
  {
    geometry: jitter(MASS_AVE, 0.0008, 53),
    reason: "A friend was doored here last year. This corridor has to be fixed first.",
    createdAt: daysAgo(4),
  },

  // --- Commonwealth Ave ----------------------------------------------------------
  {
    geometry: [
      [42.3489, -71.0954],
      [42.35, -71.105],
      [42.351, -71.11],
      [42.3515, -71.118],
    ],
    reason: "Comm Ave through BU is terrifying with the buses and the tracks.",
    zip: "02134",
    createdAt: daysAgo(16),
  },
  {
    geometry: [
      [42.3489, -71.0954],
      [42.3495, -71.102],
      [42.3505, -71.108],
      [42.3514, -71.1105],
    ],
    reason: "Please connect the BU Bridge to Kenmore properly.",
    createdAt: daysAgo(6),
  },

  // --- Columbus Ave (crosses Mass Ave) ----------------------------------------
  {
    geometry: [
      [42.317, -71.0955],
      [42.3255, -71.0895],
      [42.34, -71.081],
      [42.348, -71.0755],
      [42.351, -71.0685],
    ],
    reason: "Columbus Ave is the direct line from Egleston to Back Bay and it needs a real lane.",
    zip: "02130",
    createdAt: daysAgo(14),
  },
  {
    geometry: [
      [42.316, -71.096],
      [42.326, -71.089],
      [42.339, -71.0815],
      [42.3475, -71.076],
    ],
    reason: null,
    createdAt: daysAgo(3),
  },

  // --- Southwest Corridor extension -----------------------------------------------
  {
    geometry: [
      [42.3005, -71.114],
      [42.323, -71.099],
      [42.3315, -71.0955],
      [42.341, -71.082],
      [42.3475, -71.0757],
    ],
    reason: "Extend the Southwest Corridor path feel all the way into Back Bay station.",
    createdAt: daysAgo(11),
  },

  // --- Beacon St ----------------------------------------------------------------
  {
    geometry: [
      [42.36, -71.0708],
      [42.356, -71.071],
      [42.352, -71.0885],
      [42.3489, -71.0954],
    ],
    reason: "Beacon St from Charles Circle to Kenmore is a natural east–west route.",
    createdAt: daysAgo(8),
  },

  // --- Cambridge St -----------------------------------------------------------------
  {
    geometry: [
      [42.3608, -71.0705],
      [42.3604, -71.065],
      [42.36, -71.06],
    ],
    reason: "Short but nasty gap between Charles Circle and Government Center.",
    createdAt: daysAgo(7),
  },

  // --- Seaport Blvd -----------------------------------------------------------------
  {
    geometry: [
      [42.352, -71.048],
      [42.351, -71.043],
      [42.3475, -71.038],
    ],
    reason: "The Seaport was built new and somehow still has no safe bike route.",
    createdAt: daysAgo(5),
  },

  // --- Dorchester Ave -------------------------------------------------------------
  {
    geometry: [
      [42.3425, -71.057],
      [42.3305, -71.0575],
      [42.311, -71.053],
      [42.3, -71.06],
    ],
    reason: "Dot Ave carries thousands of people and gives cyclists nothing.",
    zip: "02125",
    createdAt: daysAgo(10),
  },

  // --- Tremont St, South End ------------------------------------------------------
  {
    geometry: [
      [42.3515, -71.064],
      [42.3455, -71.0705],
      [42.3395, -71.079],
      [42.3345, -71.078],
    ],
    reason: null,
    createdAt: daysAgo(2),
  },

  // --- Blue Hill Ave, Nubian Square to Mattapan ------------------------------
  {
    geometry: [
      [42.3293, -71.0825],
      [42.313, -71.0857],
      [42.301, -71.089],
      [42.287, -71.091],
      [42.2676, -71.092],
    ],
    reason: "Blue Hill Ave carries the whole neighborhood and has no protection for miles.",
    createdAt: daysAgo(1),
  },
];

await db.batch(
  [
    { sql: "DELETE FROM routes", args: [] },
    ...seeds.map((s) => ({
      sql: "INSERT INTO routes (id, geometry, reason, zip, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [crypto.randomUUID(), JSON.stringify(s.geometry), s.reason, s.zip ?? null, s.createdAt],
    })),
  ],
  "write",
);

const rs = await db.execute("SELECT COUNT(*) AS n FROM routes");
console.log(`Seeded ${Number(rs.rows[0].n)} routes into ${DB_URL}`);
