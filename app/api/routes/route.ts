import { NextResponse } from "next/server";
import { insertRoute, listRoutes } from "@/lib/db";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { parseRouteInput } from "@/lib/validate";

// Contributions change the data on every POST, so never cache these responses.
export const dynamic = "force-dynamic";

export async function GET() {
  const routes = await listRoutes();
  return NextResponse.json({ routes, count: routes.length });
}

export async function POST(request: Request) {
  const limit = await checkRateLimit(clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions from your network. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseRouteInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const route = await insertRoute(parsed.value.geometry, parsed.value.reason, parsed.value.zip);
  return NextResponse.json({ route }, { status: 201 });
}
