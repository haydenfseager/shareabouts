import { createHash } from "node:crypto";
import { ensureSchema, getClient } from "./db";

/** Per-IP fixed window: at most MAX_HITS submissions per WINDOW_MS. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 5;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

/** Pull the client IP from the proxy headers Vercel (and most hosts) set. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Record a hit for this IP and report whether it is within the limit. State
 * lives in the `rate_hits` table so it holds across serverless instances; rows
 * older than the window are pruned on each call. The IP is stored only as a
 * salted hash.
 */
export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  await ensureSchema();
  const client = getClient();

  const salt = process.env.RATE_LIMIT_SALT ?? "shareabouts-boston-bike-lanes";
  const ipHash = createHash("sha256").update(`${salt}|${ip}`).digest("hex");
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  await client.execute({ sql: "DELETE FROM rate_hits WHERE hit_at < ?", args: [cutoff] });

  const rs = await client.execute({
    sql: "SELECT COUNT(*) AS n, MIN(hit_at) AS oldest FROM rate_hits WHERE ip_hash = ? AND hit_at >= ?",
    args: [ipHash, cutoff],
  });
  const count = Number(rs.rows[0].n);

  if (count >= MAX_HITS) {
    const oldest = Number(rs.rows[0].oldest);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { ok: false, retryAfterSec };
  }

  await client.execute({
    sql: "INSERT INTO rate_hits (ip_hash, hit_at) VALUES (?, ?)",
    args: [ipHash, now],
  });
  return { ok: true };
}
