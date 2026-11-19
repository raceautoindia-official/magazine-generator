"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { describeIssues, settingsSchema } from "@/lib/settings-schema";

export type SettingsState = { errors?: string[]; saved?: number } | undefined;

export async function updateSettings(_previous: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await currentUser();
  if (!user) return { errors: ["You have been signed out (a session lasts 12 hours). Your changes are still on this page: sign in again in another tab, come back here and press Save again."] };

  let candidate: unknown;
  try {
    candidate = JSON.parse(String(formData.get("settings") ?? ""));
  } catch (error) {
    return { errors: [`The rules are not valid JSON: ${error instanceof Error ? error.message : "parse error"}`] };
  }

  const parsed = settingsSchema.safeParse(candidate);
  if (!parsed.success) return { errors: describeIssues(parsed.error) };

  await saveSettings(parsed.data, user.email);
  revalidatePath("/", "layout");
  return { saved: Date.now() };
}
