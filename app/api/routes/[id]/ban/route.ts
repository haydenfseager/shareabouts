import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin";
import { banIp, deleteRoute, getRouteIpHash } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Ban the IP that submitted a route, and remove the route. Requires the
 * ADMIN_TOKEN credential. Routes submitted before ip_hash was tracked (or that
 * somehow never captured one) have nothing to ban — that's a 400, not a 404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkAdmin(request);
  if (auth === "disabled") {
    return NextResponse.json(
      { error: "Banning is not configured on this server (no ADMIN_TOKEN)." },
      { status: 503 },
    );
  }
  if (auth === "denied") {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { id } = await params;

  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim();
    }
  } catch {
    // No/invalid JSON body is fine — reason is optional.
  }

  const { found, ipHash } = await getRouteIpHash(id);
  if (!found) {
    return NextResponse.json({ error: "No route with that id." }, { status: 404 });
  }
  if (!ipHash) {
    return NextResponse.json({ error: "No IP on record for this route." }, { status: 400 });
  }

  await banIp(ipHash, reason);
  await deleteRoute(id);
  return NextResponse.json({ banned: true, deleted: id });
}
