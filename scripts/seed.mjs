// Seeds the database with a plausible set of Boston bike-lane requests so the
// heatmap has something to show on first run. Safe to re-run: it clears the
// `routes` table first.
//
//   node scripts/seed.mjs
//
// Several requests deliberately overlap along Massachusetts Avenue so that
// corridor renders as the clear hotspot.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.BIKE_DB_PATH ?? path.join(process.cwd(), "data", "routes.db");
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS routes (
    id         TEXT PRIMARY KEY,
    geometry   TEXT NOT NULL,
    reason     TEXT,
    created_at TEXT NOT NULL
  );
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

db.exec("DELETE FROM routes;");
const insert = db.prepare(
  "INSERT INTO routes (id, geometry, reason, created_at) VALUES (?, ?, ?, ?)",
);
for (const s of seeds) {
  insert.run(crypto.randomUUID(), JSON.stringify(s.geometry), s.reason, s.createdAt);
}

const { n } = db.prepare("SELECT COUNT(*) AS n FROM routes").get();
console.log(`Seeded ${n} routes into ${DB_PATH}`);
db.close();
