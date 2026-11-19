import type { NextRequest } from "next/server";
import { serveEditionFile } from "@/lib/magazine/serve";

export async function GET(request: NextRequest, context: RouteContext<"/editions/[id]/pdf">) {
  const { id } = await context.params;
  return serveEditionFile(request, id, "pdf");
}
