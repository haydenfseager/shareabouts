import { lineLength, type LatLng } from "./geo";
import { routeInsideBoston } from "./boston-boundary";

export const MAX_REASON_LENGTH = 280;
export const MAX_VERTICES = 200;
export const MIN_ROUTE_METERS = 30;
export const MAX_ROUTE_METERS = 25_000;

/** US ZIP: five digits, optionally followed by a `-` and four more (ZIP+4). */
export const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

export type ParsedRoute = { geometry: LatLng[]; reason: string | null; zip: string | null };

type Result =
  | { ok: true; value: ParsedRoute }
  | { ok: false; error: string };

function isLatLng(v: unknown): v is LatLng {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** Validate an untrusted POST body into a clean route, or explain why not. */
export function parseRouteInput(body: unknown): Result {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Expected a JSON object." };
  }

  const { geometry, reason, zip } = body as Record<string, unknown>;

  if (!Array.isArray(geometry) || geometry.length < 2) {
    return { ok: false, error: "A route needs at least 2 points." };
  }
  if (geometry.length > MAX_VERTICES) {
    return { ok: false, error: `A route can have at most ${MAX_VERTICES} points.` };
  }
  if (!geometry.every(isLatLng)) {
    return { ok: false, error: "Every point must be [latitude, longitude] numbers." };
  }

  const points = geometry as LatLng[];

  const meters = lineLength(points);
  if (meters < MIN_ROUTE_METERS) {
    return { ok: false, error: "That route is too short to be meaningful." };
  }
  if (meters > MAX_ROUTE_METERS) {
    return { ok: false, error: "That route is longer than any realistic bike corridor." };
  }

  if (!routeInsideBoston(points)) {
    return { ok: false, error: "The entire route must stay within the City of Boston." };
  }

  let cleanReason: string | null = null;
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string") {
      return { ok: false, error: "Reason must be text." };
    }
    const trimmed = reason.trim();
    if (trimmed.length > MAX_REASON_LENGTH) {
      return { ok: false, error: `Reason must be ${MAX_REASON_LENGTH} characters or fewer.` };
    }
    cleanReason = trimmed || null;
  }

  let cleanZip: string | null = null;
  if (zip !== undefined && zip !== null) {
    if (typeof zip !== "string") {
      return { ok: false, error: "Enter a 5-digit ZIP code." };
    }
    const trimmed = zip.trim();
    if (trimmed) {
      if (!ZIP_PATTERN.test(trimmed)) {
        return { ok: false, error: "Enter a 5-digit ZIP code." };
      }
      cleanZip = trimmed;
    }
  }

  return { ok: true, value: { geometry: points, reason: cleanReason, zip: cleanZip } };
}
