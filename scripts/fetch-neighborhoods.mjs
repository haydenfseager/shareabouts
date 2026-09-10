// Regenerates lib/boston-neighborhoods.ts from Analyze Boston.
//
//   node scripts/fetch-neighborhoods.mjs
//
// Pulls the BPDA neighborhood boundaries (26 areas), simplifies every ring with
// Douglas–Peucker, flattens Polygon/MultiPolygon geometry into a flat list of
// rings per neighborhood, and writes it out as a typed [lat, lng] structure plus
// a point-in-neighborhood helper. Harbor Islands is dropped (no street routes).

import { writeFileSync } from "node:fs";
import path from "node:path";

const URL =
  "https://data.boston.gov/dataset/bf1a7b50-4c72-4637-b0fa-11d632e3aff1/resource/" +
  "e5849875-a6f6-4c9c-9d8a-5048b0fbd03e/download/boston_neighborhood_boundaries.geojson";

const SIMPLIFY_TOLERANCE = 0.0004; // ~35–45 m at Boston's latitude
const DROP = new Set(["Harbor Islands"]);

/** Perpendicular distance from p to the segment a–b, in degree space (fine for simplify). */
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = douglasPeucker(pts.slice(0, idx + 1), eps);
  const right = douglasPeucker(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** GeoJSON [lng, lat] ring -> simplified, closed [lat, lng] ring. */
function ringToLatLng(ring) {
  const simplified = douglasPeucker(ring, SIMPLIFY_TOLERANCE);
  const out = simplified.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]);
  const [a, b] = [out[0], out[out.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
}

/** Every ring of a Polygon or MultiPolygon feature, flattened. */
function featureRings(geometry) {
  const polygons =
    geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  return polygons.flatMap((poly) => poly.map(ringToLatLng)).filter((r) => r.length >= 4);
}

const res = await fetch(URL, { headers: { "User-Agent": "shareabouts-boston-bike-lanes/1.0" } });
if (!res.ok) throw new Error(`Analyze Boston request failed: ${res.status}`);
const geojson = await res.json();

const neighborhoods = geojson.features
  .map((f) => ({ name: f.properties.name, parts: featureRings(f.geometry) }))
  .filter((n) => n.name && !DROP.has(n.name) && n.parts.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name));

const totalPoints = neighborhoods.reduce(
  (a, n) => a + n.parts.reduce((b, r) => b + r.length, 0),
  0,
);

const entries = neighborhoods
  .map((n) => {
    const parts = n.parts
      .map((ring) => {
        const rows = [];
        for (let i = 0; i < ring.length; i += 4) {
          rows.push("      " + ring.slice(i, i + 4).map((p) => `[${p[0]}, ${p[1]}]`).join(", ") + ",");
        }
        return `    [\n${rows.join("\n")}\n    ]`;
      })
      .join(",\n");
    return `  {\n    name: ${JSON.stringify(n.name)},\n    parts: [\n${parts},\n    ],\n  }`;
  })
  .join(",\n");

const file = `// BPDA neighborhood boundaries for the City of Boston.
//
// Source: Analyze Boston "Boston Neighborhood Boundaries", simplified with
// Douglas–Peucker (tolerance ${SIMPLIFY_TOLERANCE}). Each neighborhood is a flat list of
// closed [lat, lng] rings (Polygon rings and MultiPolygon parts combined);
// point-in-neighborhood uses the even–odd rule across all of them, so holes and
// disjoint parts both work. Harbor Islands is omitted. Regenerate with
// scripts/fetch-neighborhoods.mjs.

import type { LatLng } from "./geo";

export type Neighborhood = { name: string; parts: LatLng[][] };

export const BOSTON_NEIGHBORHOODS: Neighborhood[] = [
${entries},
];

/** Name of the neighborhood containing the point, or null if none. */
export function neighborhoodAt([lat, lng]: LatLng): string | null {
  for (const nb of BOSTON_NEIGHBORHOODS) {
    let inside = false;
    for (const ring of nb.parts) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [latI, lngI] = ring[i];
        const [latJ, lngJ] = ring[j];
        if (
          latI > lat !== latJ > lat &&
          lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
        ) {
          inside = !inside;
        }
      }
    }
    if (inside) return nb.name;
  }
  return null;
}
`;

const out = path.join(process.cwd(), "lib", "boston-neighborhoods.ts");
writeFileSync(out, file);
console.log(
  `Wrote ${out} — ${neighborhoods.length} neighborhoods, ${totalPoints} points total`,
);
