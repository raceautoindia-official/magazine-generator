import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { jobState } from "@/lib/jobs";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * How a piece of background work is going. Asked every second or two by the page that started it. A plain request,
 * not a server action: actions of one page run one after the other, so a slow one (Claude writing a foreword, a
 * large upload) would hold up every question about a job, and the page would seem stuck.
 */
export async function GET(_request: NextRequest, context: RouteContext<"/jobs/[id]">) {
  // No redirect here: a page that is following a job stays where it is and says the session has ended.
  if (!(await currentUser())) return json({ signedOut: true }, 401);
  const { id } = await context.params;
  if (!/^\d{1,9}$/.test(id)) return json({ job: null }, 404);
  return json({ job: await jobState(Number(id)) });
}
