import fs from "node:fs/promises";
import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { advertFile } from "@/lib/adverts";

/** An advert's picture for a signed-in user: the small one, or with ?full the one printed on the page. */
export async function GET(request: NextRequest, context: RouteContext<"/adverts/[id]/image">) {
  if (!(await currentUser())) return new Response("Sign in first.", { status: 401 });
  const { id } = await context.params;
  if (!/^\d{1,9}$/.test(id)) return new Response("Not found.", { status: 404 });
  try {
    const body = await fs.readFile(advertFile(Number(id), request.nextUrl.searchParams.has("full") ? "print" : "thumb"));
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(body.length), "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}
