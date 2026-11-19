import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { dataDir } from "@/lib/magazine/images";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2" };

/**
 * A picture or font the magazine page on the Design tab needs, for a signed-in user. Only files of the kinds a page
 * uses, and only from the app's data folder (cached post pictures, adverts, uploads) or its assets folder.
 */
export async function GET(request: NextRequest) {
  if (!(await currentUser())) return new Response("Sign in first.", { status: 401 });
  const wanted = request.nextUrl.searchParams.get("f") ?? "";
  const root = path.resolve(/* turbopackIgnore: true */ process.cwd());
  const file = path.resolve(root, wanted);
  const type = TYPES[path.extname(file).toLowerCase()];
  const allowed = [dataDir(), path.join(root, "assets")].some((folder) => file.startsWith(folder + path.sep));
  if (!wanted || !type || !allowed) return new Response("Not found.", { status: 404 });
  try {
    const body = await fs.readFile(file);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": type,
        "Content-Length": String(body.length),
        // A cut picture's name changes with its framing, so the same address is always the same picture.
        "Cache-Control": "private, max-age=600",
      },
    });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}
