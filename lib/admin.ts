import { timingSafeEqual } from "node:crypto";

/**
 * Check an incoming admin credential against ADMIN_TOKEN. Accepts either
 * `Authorization: Bearer <token>` or `x-admin-token: <token>`.
 *
 * Returns "disabled" when no ADMIN_TOKEN is configured (admin actions are then
 * unavailable), "ok" on a match, "denied" otherwise.
 */
export function checkAdmin(request: Request): "ok" | "denied" | "disabled" {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return "disabled";

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || request.headers.get("x-admin-token") || "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "denied";
}
