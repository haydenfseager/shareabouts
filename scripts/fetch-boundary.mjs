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

/** Resolution (metres) at which straight segments are sampled for boundary checks. */
const SEGMENT_SAMPLE_METERS = 15;

/**
 * True when the straight segment a→b stays entirely inside Boston: \`b\` itself
 * plus every ~15 m sample between the endpoints must be inside. (\`a\` is assumed
 * already checked as the previous point.)
 */
export function segmentInsideBoston(a: LatLng, b: LatLng): boolean {
  if (!pointInBoston(b)) return false;
  const segMeters = haversine(a, b);
  const steps = Math.max(1, Math.ceil(segMeters / SEGMENT_SAMPLE_METERS));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const mid: LatLng = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (!pointInBoston(mid)) return false;
  }
  return true;
}

/** True only when the whole polyline — every vertex and every segment — is inside Boston. */
export function routeInsideBoston(points: LatLng[]): boolean {
  if (points.length === 0) return false;
  if (!pointInBoston(points[0])) return false;
  for (let i = 1; i < points.length; i++) {
    if (!segmentInsideBoston(points[i - 1], points[i])) return false;
  }
  return true;
}
`;

const out = path.join(process.cwd(), "lib", "boston-boundary.ts");
writeFileSync(out, file);
console.log(`Wrote ${out} — ${pts.length} points`);
