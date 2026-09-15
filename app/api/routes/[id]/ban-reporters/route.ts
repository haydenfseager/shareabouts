import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin";
import { banReportersAndRestore } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Ban every IP that reported this route, clear those reports, and restore the
 * route to public view. Use this instead of plain "Unhide" when the reports
 * look like a coordinated attempt to hide a legitimate route (e.g. a handful
 * of IPs conspiring to report-bomb it) rather than genuine abuse — Unhide
 * alone leaves those IPs free to do it again. Requires the ADMIN_TOKEN
 * credential.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = checkAdmin(request);
  if (auth === "disabled") {
    return NextResponse.json(
      { error: "This action is not configured on this server (no ADMIN_TOKEN)." },
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

  const result = await banReportersAndRestore(id, reason);
  if (!result) {
    return NextResponse.json({ error: "No route with that id." }, { status: 404 });
  }
  return NextResponse.json({ bannedCount: result.bannedCount, unhidden: id });
}
