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
  createdAt: string;
};
