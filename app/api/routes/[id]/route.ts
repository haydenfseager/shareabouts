import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/admin";
import { deleteRoute } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Remove a single route. Requires the ADMIN_TOKEN credential. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = checkAdmin(request);
  if (auth === "disabled") {
    return NextResponse.json(
      { error: "Deletion is not configured on this server (no ADMIN_TOKEN)." },
      { status: 503 },
    );
  }
  if (auth === "denied") {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { id } = await params;
  const deleted = await deleteRoute(id);
  if (!deleted) {
    return NextResponse.json({ error: "No route with that id." }, { status: 404 });
  }
  return NextResponse.json({ deleted: id });
}
