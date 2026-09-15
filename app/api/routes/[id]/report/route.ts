import { NextResponse } from "next/server";
import { addReport, isIpBanned } from "@/lib/db";
import { clientIp, hashIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Flag a route as inappropriate. No auth — anyone can report. A repeat report
 * from the same IP on the same route is a harmless no-op (route_reports'
 * primary key dedupes it), so there's no separate rate limit here. Once
 * distinct reports reach REPORT_HIDE_THRESHOLD the route stops appearing in
 * the public listing until an admin reviews it. An IP already banned (e.g. via
 * "ban reporters" on an earlier coordinated attempt) can't file new reports.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ipHash = hashIp(clientIp(request));

  if (await isIpBanned(ipHash)) {
    return NextResponse.json({ error: "This network has been blocked from reporting." }, { status: 403 });
  }

  const result = await addReport(id, ipHash);
  if (!result) {
    return NextResponse.json({ error: "No route with that id." }, { status: 404 });
  }
  return NextResponse.json(result);
}
