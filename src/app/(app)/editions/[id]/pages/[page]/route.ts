import type { NextRequest } from "next/server";
import { serveEditionFile } from "@/lib/magazine/serve";

export async function GET(request: NextRequest, context: RouteContext<"/editions/[id]/pages/[page]">) {
  const { id, page } = await context.params;
  return serveEditionFile(request, id, "page", page);
}
