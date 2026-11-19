"use server";

import { currentUser } from "@/lib/auth";
import { jobState, type JobState } from "@/lib/jobs";

/** How a piece of background work is going. Asked every second or two by the page that started it. */
export async function jobStatus(id: number): Promise<JobState | "signed-out" | null> {
  // No redirect here: a page that is following a job stays where it is and says the session has ended.
  if (!(await currentUser())) return "signed-out";
  return Number.isInteger(id) && id > 0 ? jobState(id) : null;
}
