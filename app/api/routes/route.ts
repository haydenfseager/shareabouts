import { NextResponse } from "next/server";
import { insertRoute, listRoutes } from "@/lib/db";
import { parseRouteInput } from "@/lib/validate";

// Contributions change the data on every POST, so never cache these responses.
export const dynamic = "force-dynamic";

export async function GET() {
  const routes = listRoutes();
  return NextResponse.json({ routes, count: routes.length });
}

export async function POST(request: Request) {
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

  const route = insertRoute(parsed.value.geometry, parsed.value.reason);
  return NextResponse.json({ route }, { status: 201 });
}
