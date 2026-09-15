import type { LatLng } from "./geo";

/**
 * A single proposed bike-lane route drawn by an (anonymous) contributor.
 * `geometry` is an ordered list of [lat, lng] vertices. Shared by the API,
 * the database layer, and the browser map — keep it free of server-only imports.
 */
export type BikeRoute = {
  id: string;
  geometry: LatLng[];
  reason: string | null;
  /** Optional self-reported US ZIP code. `null` when not collected. Kept for
   *  data collection only — never shown in the public map UI. */
  zip: string | null;
  createdAt: string;
};

/**
 * Admin-only view of a route: everything in `BikeRoute` plus its moderation
 * state. Never sent to the public map — only `/admin` (with a valid
 * `ADMIN_TOKEN`) can request `GET /api/routes?all=1`.
 */
export type AdminBikeRoute = BikeRoute & {
  /** Distinct IPs that have reported this route. */
  reportCount: number;
  /** True once reportCount crossed the auto-hide threshold. */
  hidden: boolean;
};

/**
 * A corridor in the "most requested" ranking: a real submitted route plus the
 * overlap-density figures computed for it on the client (see `BikeMap`).
 */
export type HotRoute = {
  id: string;
  reason: string | null;
  /** Pre-formatted route length, e.g. "1.4 km" or "820 m". */
  lengthLabel: string;
  /** Approximate number of submitted routes piling onto this corridor, itself included. */
  converge: number;
};

/** A neighborhood in the "hottest neighborhoods" ranking. */
export type HotNeighborhood = {
  name: string;
  /** Sampled route points that fall inside this neighborhood. */
  count: number;
  /** `count` as a fraction of all sampled points that land in any neighborhood. */
  share: number;
};
