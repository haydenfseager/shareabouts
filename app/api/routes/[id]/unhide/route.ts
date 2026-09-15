import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin";
import { unhideRoute } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Clear a route's report-triggered hidden state. Requires the ADMIN_TOKEN credential. */
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
  const unhidden = await unhideRoute(id);
  if (!unhidden) {
    return NextResponse.json({ error: "No route with that id." }, { status: 404 });
  }
  return NextResponse.json({ unhidden: id });
}
