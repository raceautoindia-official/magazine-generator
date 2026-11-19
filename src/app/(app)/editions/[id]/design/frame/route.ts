import type { NextRequest } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { cleanParagraphs, cleanTitle } from "@/lib/design";
import { designHtml } from "@/lib/magazine/render";

const page = (html: string | null) =>
  html === null
    ? new Response("This edition has no articles to show.", { status: 404 })
    : new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          // Shown only inside this app's own pages.
          "X-Frame-Options": "SAMEORIGIN",
        },
      });

async function editionOf(context: RouteContext<"/editions/[id]/design/frame">): Promise<number | Response> {
  if (!(await currentUser())) return new Response("Sign in first.", { status: 401 });
  const { id } = await context.params;
  return /^\d{1,9}$/.test(id) ? Number(id) : new Response("Not found.", { status: 404 });
}

/** The whole magazine as one web page, laid out as the PDF will be, for the Design tab. */
export async function GET(_request: NextRequest, context: RouteContext<"/editions/[id]/design/frame">) {
  const id = await editionOf(context);
  if (id instanceof Response) return id;
  return page(await designHtml(id));
}

const trial = z.object({
  articleId: z.coerce.number().int().positive(),
  title: z.string().max(2000),
  paragraphs: z.array(z.string().max(60000)).max(400),
});

/**
 * One article laid out with a headline and text that are not saved yet, so the Design tab can see whether a change
 * keeps the article's pages as they are before it is saved. Nothing is stored.
 */
export async function POST(request: NextRequest, context: RouteContext<"/editions/[id]/design/frame">) {
  const id = await editionOf(context);
  if (id instanceof Response) return id;
  const form = await request.formData();
  let input: z.infer<typeof trial>;
  try {
    input = trial.parse({ articleId: form.get("articleId"), title: form.get("title") ?? "", paragraphs: JSON.parse(String(form.get("paragraphs") ?? "[]")) });
  } catch {
    return new Response("The text could not be read.", { status: 400 });
  }
  return page(await designHtml(id, { only: input.articleId, trial: { articleId: input.articleId, title: cleanTitle(input.title), paragraphs: cleanParagraphs(input.paragraphs) } }));
}
