// Metadata for the traffic-stress overlay. The GeoJSON itself is vendored under
// public/stress/ and fetched lazily the first time the overlay is enabled;
// regenerate it with `npm run stress` (scripts/fetch-stress-network.mjs).

export const STRESS_DATASET = {
  label: "Boston traffic-stress map",
  blurb: "The city's Bicycle Level of Traffic Stress score for every street (2023)",
  /** Static path served from public/. */
  path: "/stress/boston-blts-2023.geojson",
} as const;

/**
 * Bicycle Level of Traffic Stress colour ramp, matching the City of Boston's own
 * map: 1 = least stress … 4 = most stress; 0 = not scored. See boston.gov/blts.
 */
export const LTS_COLOR: Record<number, string> = {
  0: "#7f7f7f",
  1: "#198700",
  2: "#149ece",
  3: "#ffde3e",
  4: "#de0404",
};

export const LTS_LABEL: Record<number, string> = {
  0: "Not scored",
  1: "LTS 1 — least stress",
  2: "LTS 2",
  3: "LTS 3",
  4: "LTS 4 — most stress",
};

export function ltsColor(lts: number | null | undefined): string {
  return lts == null ? LTS_COLOR[0] : (LTS_COLOR[lts] ?? LTS_COLOR[0]);
}

export type StressFeatureProps = {
  lts: number;
  name: string | null;
};

export const STRESS_ATTRIBUTION =
  'Traffic-stress data: <a href="https://www.boston.gov/blts">City of Boston</a> Bicycle Level of Traffic Stress (2023) — Boston Transportation Department &amp; Toole Design.';
