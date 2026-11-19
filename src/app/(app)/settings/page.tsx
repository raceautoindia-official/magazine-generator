import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  await requireUser();
  const stored = await getSettings();

  return (
    <>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {stored.versionId === null
          ? "Using the built-in defaults. Nothing has been saved yet."
          : `Version ${stored.versionId}, saved by ${stored.savedBy} on ${stored.savedAt}.`}
      </p>
      <SettingsForm initial={stored.settings} />
    </>
  );
}
