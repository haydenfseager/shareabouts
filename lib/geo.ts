// Geographic helpers and Boston map configuration.

/** [latitude, longitude] */
export type LatLng = [number, number];

/** Roughly the City of Boston + immediately adjacent areas (Cambridge, Somerville, Brookline). */
export const BOSTON_CENTER: LatLng = [42.3601, -71.0589];
export const DEFAULT_ZOOM = 13;
export const MIN_ZOOM = 11;
export const MAX_ZOOM = 18;

/**
 * [ [south, west], [north, east] ] — a loose rectangle used only to stop the map
 * panning away from Boston. Whether a *submission* counts as "in Boston" is a
 * polygon test in `boston-boundary.ts`, not this box.
 */
export const BOSTON_BOUNDS: [LatLng, LatLng] = [
  [42.20, -71.25],
  [42.47, -70.90],
];

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversine([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Total length of a polyline, in metres. */
export function lineLength(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/**
 * Walk along a polyline and emit a point every `spacingMeters`. Feeding these
 * evenly-spaced points into a heat layer means long routes and short routes
 * contribute proportionally, and corridors drawn by many people stack up hot.
 */
export function sampleLine(points: LatLng[], spacingMeters = 25): LatLng[] {
  if (points.length < 2) return points.slice();

  const out: LatLng[] = [points[0]];
  let carry = 0; // distance already covered since the last emitted sample

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = haversine(a, b);
    if (segLen === 0) continue;

    let pos = spacingMeters - carry;
    while (pos < segLen) {
      const t = pos / segLen;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      pos += spacingMeters;
    }
    carry = (carry + segLen) % spacingMeters;
  }

  const last = points[points.length - 1];
  if (haversine(out[out.length - 1], last) > spacingMeters / 2) out.push(last);
  return out;
}
