// Regenerates lib/boston-boundary.ts from OpenStreetMap.
//
//   node scripts/fetch-boundary.mjs
//
// Pulls the administrative boundary of Boston (OSM relation 2315704) from the
// Nominatim API as a generalised polygon, keeps the largest ring (the mainland
// city; small harbour-island fragments are dropped), and writes it out as a
// typed [lat, lng] array plus the point-in-polygon helpers.

import { writeFileSync } from "node:fs";
import path from "node:path";

const URL =
  "https://nominatim.openstreetmap.org/search.php" +
  "?q=Boston,+Massachusetts,+USA&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0006&limit=3";

const res = await fetch(URL, {
  headers: { "User-Agent": "shareabouts-boston-bike-lanes/1.0 (dev script)" },
});
if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);

const results = await res.json();
const boston = results.find(
  (r) => r.osm_type === "relation" && /^Boston,/.test(r.display_name),
);
if (!boston?.geojson) throw new Error("No Boston boundary polygon in response");

// geojson is Polygon (rings) or MultiPolygon (polygons of rings); take the ring
// with the greatest bounding-box area.
const rings =
  boston.geojson.type === "MultiPolygon"
    ? boston.geojson.coordinates.map((poly) => poly[0])
    : boston.geojson.coordinates;

const bboxArea = (ring) => {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lng, lat] of ring) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  }
  return (maxLat - minLat) * (maxLng - minLng);
};

const outer = rings.reduce((a, b) => (bboxArea(b) >= bboxArea(a) ? b : a));
const pts = outer.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]);
const [first, last] = [pts[0], pts[pts.length - 1]];
if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);

const rows = [];
for (let i = 0; i < pts.length; i += 4) {
  rows.push("  " + pts.slice(i, i + 4).map((p) => `[${p[0]}, ${p[1]}]`).join(", ") + ",");
}

const file = `// City of Boston municipal boundary, used to keep submitted routes within the city.
//
// Source: OpenStreetMap relation 2315704 (Boston, Suffolk County, MA) via the
// Nominatim API, generalised with polygon_threshold=0.0006. One closed ring of
// [lat, lng] pairs; harbour-island fragments were dropped as irrelevant to a
// street cycling network. Regenerate with scripts/fetch-boundary.mjs.

import { haversine, type LatLng } from "./geo";

/** Closed polygon ring: first and last points are identical. */
export const BOSTON_BOUNDARY: LatLng[] = [
${rows.join("\n")}
];

/** Ray-casting point-in-polygon test against the Boston boundary. */
export function pointInBoston([lat, lng]: LatLng): boolean {
  const ring = BOSTON_BOUNDARY;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const crosses = latI > lat !== latJ > lat;
    if (crosses && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Length-weighted share of a polyline that falls inside Boston, from 0 to 1.
 * Each segment is walked at ~50 m resolution and its length credited to
 * "inside" or "outside" based on the midpoint of each step.
 */
export function fractionInsideBoston(points: LatLng[]): number {
  if (points.length === 1) return pointInBoston(points[0]) ? 1 : 0;

  let insideMeters = 0;
  let totalMeters = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segMeters = haversine(a, b);
    if (segMeters === 0) continue;
    totalMeters += segMeters;

    const steps = Math.max(1, Math.ceil(segMeters / 50));
    const stepMeters = segMeters / steps;
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const mid: LatLng = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (pointInBoston(mid)) insideMeters += stepMeters;
    }
  }

  return totalMeters === 0 ? 0 : insideMeters / totalMeters;
}
`;

const out = path.join(process.cwd(), "lib", "boston-boundary.ts");
writeFileSync(out, file);
console.log(`Wrote ${out} — ${pts.length} points`);
