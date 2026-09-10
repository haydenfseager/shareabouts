// Vendors the City of Boston's Bicycle Level of Traffic Stress map into
// public/stress/boston-blts-2023.geojson.
//
//   node scripts/fetch-stress-network.mjs   (npm run stress)
//
// Source: City of Boston / Boston Transportation Department & Toole Design —
// "Bicycle Level of Traffic Stress 2023", a public ArcGIS feature service that
// scores every street segment 1 (least stress) to 4 (most); 0 = not scored.
// Metadata: https://www.boston.gov/blts
//
// ~19.6k polylines. We keep only { lts, name }, round coordinates to 5 dp and
// drop near-collinear vertices (~2 m) to keep the committed file manageable
// (~3 MB; lazy-loaded in the browser only when the overlay is turned on).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const QUERY =
  "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/" +
  "Bicycle_Level_of_Traffic_Stress_2023_/FeatureServer/0/query";
const PAGE = 2000;
const SIMPLIFY_EPS = 2e-5; // ~2 m in degrees at Boston's latitude

const round = (n) => Math.round(n * 1e5) / 1e5;

function perpDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

async function fetchAll() {
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "lts,name",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
    });
    const res = await fetch(`${QUERY}?${params}`);
    if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    const page = json.features ?? [];
    features.push(...page);
    process.stderr.write(`\rfetched ${features.length}`);
    if (page.length < PAGE) break;
  }
  process.stderr.write("\n");
  return features;
}

const raw = await fetchAll();

const lts = {};
const features = raw
  .filter((f) => f.geometry?.type === "LineString" && f.geometry.coordinates.length >= 2)
  .map((f) => {
    const l = f.properties.lts ?? 0;
    lts[l] = (lts[l] ?? 0) + 1;
    return {
      type: "Feature",
      properties: { lts: l, name: f.properties.name || null },
      geometry: {
        type: "LineString",
        coordinates: simplify(
          f.geometry.coordinates.map(([lng, la]) => [round(lng), round(la)]),
          SIMPLIFY_EPS,
        ),
      },
    };
  });

const outDir = path.join(process.cwd(), "public", "stress");
mkdirSync(outDir, { recursive: true });
const json = JSON.stringify({ type: "FeatureCollection", features });
writeFileSync(path.join(outDir, "boston-blts-2023.geojson"), json);
console.log(
  `boston-blts-2023.geojson: ${features.length} segments, ${(json.length / 1048576).toFixed(2)} MB, LTS ${JSON.stringify(lts)}`,
);
