import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { currentUser } from "../auth";
import { shiftMonth } from "../months";
import { editionFiles, finishedCopy } from "./render";

/** Sends an edition's PDF, cover image or one page picture to a signed-in user. */
export async function serveEditionFile(
  request: Request,
  idParam: string,
  kind: "pdf" | "cover" | "page",
  pageParam?: string,
): Promise<Response> {
  // A plain 401 here; pages redirect to the login screen, file links should not.
  if (!(await currentUser())) return new Response("Sign in first.", { status: 401 });
  if (!/^\d+$/.test(idParam)) return new Response("Not found.", { status: 404 });

  const files = await editionFiles(Number(idParam));
  if (!files) return new Response("This edition has no PDF yet.", { status: 404 });

  let file = kind === "pdf" ? files.pdf : files.cover;
  if (kind === "page") {
    const number = /^\d{1,4}$/.test(pageParam ?? "") ? Number(pageParam) : 0;
    if (number < 1 || number > files.pageCount) return new Response("Not found.", { status: 404 });
    file = path.join(files.pagesDir, `${number}.jpg`);
  }

  let body: Buffer;
  try {
    body = await fs.readFile(/* turbopackIgnore: true */ file);
  } catch {
    // A finished edition has a second copy of its PDF and cover, kept when it was marked as finished.
    const kept = kind === "page" ? null : await finishedCopy(Number(idParam), kind);
    try {
      if (!kept) throw new Error("no kept copy");
      body = await fs.readFile(/* turbopackIgnore: true */ kept);
    } catch {
      return new Response("The file is no longer on the server. Create the PDF again.", { status: 404 });
    }
  }

  const download = new URL(request.url).searchParams.has("download");
  // For example race-auto-india-cars-2026-09.pdf: the edition and the month it is issued for.
  const base = `race-auto-india-${files.vertical}-${shiftMonth(files.contentMonth, 1)}`.replace(/[^a-z0-9-]/gi, "");
  const name = kind === "pdf" ? `${base}.pdf` : kind === "cover" ? `${base}-cover.jpg` : `${base}-page-${pageParam}.jpg`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": kind === "pdf" ? "application/pdf" : "image/jpeg",
      "Content-Length": String(body.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
