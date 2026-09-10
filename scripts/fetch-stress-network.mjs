// Vendors the Boston cycling stress network into public/stress/*.geojson.
//
//   node scripts/fetch-stress-network.mjs
//
// Source: github.com/tlangs/cycling-stress-maps — pre-computed GeoJSON where each
// street segment carries a Level-of-Traffic-Stress score (lts 0-4; 0 = off-street
// path). Used here with permission. Geometry is OpenStreetMap-derived.
//
// We keep only the fields the overlay needs and round coordinates to 5 dp (~1 m)
// to keep the committed files small.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE =
  "https://raw.githubusercontent.com/tlangs/cycling-stress-maps/main/src/assets/";

const SOURCES = [
  {
    out: "existing.geojson",
    url: BASE + "default-annotated-geojson.json",
    keep: (p) => ({ lts: p.lts ?? null, name: p.name ?? null, osmId: p.osmId ?? null }),
  },
];

const round = (n) => Math.round(n * 1e5) / 1e5;

const outDir = path.join(process.cwd(), "public", "stress");
mkdirSync(outDir, { recursive: true });

for (const src of SOURCES) {
  const res = await fetch(src.url, {
    headers: { "User-Agent": "shareabouts-boston-bike-lanes/1.0" },
  });
  if (!res.ok) throw new Error(`${src.url} -> ${res.status}`);
  const raw = await res.json();
  const featureCollection = raw.featureCollection ?? raw;

  const lts = {};
  const features = featureCollection.features
    .filter((f) => f.geometry?.type === "LineString")
    .map((f) => {
      const p = src.keep(f.properties ?? {});
      lts[p.lts] = (lts[p.lts] ?? 0) + 1;
      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: f.geometry.coordinates.map(([lng, la]) => [round(lng), round(la)]),
        },
        properties: p,
      };
    });

  const json = JSON.stringify({ type: "FeatureCollection", features });
  writeFileSync(path.join(outDir, src.out), json);
  console.log(
    `${src.out}: ${features.length} segments, ${(json.length / 1024).toFixed(0)} KB, LTS ${JSON.stringify(lts)}`,
  );
}
