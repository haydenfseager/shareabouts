// Metadata for the cycling stress-network overlay. The GeoJSON itself is vendored
// under public/stress/ and fetched lazily the first time the overlay is enabled;
// regenerate it with `npm run stress` (scripts/fetch-stress-network.mjs).

export const STRESS_DATASET = {
  label: "Existing network",
  blurb: "Boston's current bikeable streets",
  /** Static path served from public/. */
  path: "/stress/existing.geojson",
} as const;

/**
 * Level-of-Traffic-Stress colour ramp. LTS 1 = comfortable for most people,
 * LTS 4 = high stress; 0 = off-street path. Null/unknown falls back to grey.
 */
export const LTS_COLOR: Record<number, string> = {
  0: "#2563eb",
  1: "#1a9850",
  2: "#a6d96a",
  3: "#fdae61",
  4: "#d73027",
};

export const LTS_LABEL: Record<number, string> = {
  0: "Off-street path",
  1: "LTS 1 — low stress",
  2: "LTS 2",
  3: "LTS 3",
  4: "LTS 4 — high stress",
};

export function ltsColor(lts: number | null | undefined): string {
  return lts == null ? "#94a3b8" : (LTS_COLOR[lts] ?? "#94a3b8");
}

export type StressFeatureProps = {
  lts: number | null;
  name: string | null;
  osmId: number | null;
};

export const STRESS_ATTRIBUTION =
  'Stress network from cycling-stress-maps (LTS methodology by Boston Cyclists Union), derived from OpenStreetMap. Used with permission.';
