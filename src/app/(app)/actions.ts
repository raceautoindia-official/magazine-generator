"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { deleteDraft, generateEditions } from "@/lib/editions";
import { removeEditionFiles } from "@/lib/magazine/render";
import { startJob } from "@/lib/jobs";
import { currentMonth, isMonth } from "@/lib/months";
import type { Started } from "./use-job";

/** What generating gives back: the drafts made, and the month they are for. */
export type Generated = { ids: number[]; month: string };

/**
 * Runs only when the person presses Generate; nothing is generated on a schedule. The work is started in the
 * background and this answers at once, so a slow run is never cut off and a second press joins the first
 * instead of making the drafts twice.
 */
export async function generate(formData: FormData): Promise<Started> {
  const user = await requireUser();

  const month = formData.get("month");
  if (!isMonth(month) || month > currentMonth()) return { error: "Choose a valid month." };
  const verticals = [...new Set(formData.getAll("vertical").map(String))].sort();
  if (verticals.length === 0) return { error: "Tick at least one edition to generate." };

  const { id: job } = await startJob({ kind: "generate", key: `generate:${month}:${verticals.join(",")}`, label: `Generating ${verticals.length} draft(s) for ${month}`, by: user.email }, async () => {
    const ids = await generateEditions(month, verticals, user.email);
    return { ids, month } satisfies Generated;
  });
  return { job };
}

export async function removeDraft(formData: FormData): Promise<void> {
  await requireUser();
  const id = Number(formData.get("id"));
  // The files go only when the draft itself was really deleted (a finished edition is never deleted).
  if (Number.isInteger(id) && id > 0 && (await deleteDraft(id))) await removeEditionFiles(id);
  revalidatePath("/", "layout");
  redirect("/");
}
