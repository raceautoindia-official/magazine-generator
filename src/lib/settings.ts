import "server-only";
import { appExecute, appQuery } from "./db";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "./settings-schema";

export type StoredSettings = {
  settings: Settings;
  /** null while the built-in defaults are in use (nothing saved yet). */
  versionId: number | null;
  savedBy: string | null;
  savedAt: string | null;
};

/**
 * Latest saved settings. Every save is a new row, so an edition can keep
 * pointing at the version it was generated with.
 */
export async function getSettings(): Promise<StoredSettings> {
  const rows = await appQuery<{ id: number; settings: unknown; created_by: string; created_at: string }>(
    "SELECT id, settings, created_by, created_at FROM mg_settings_versions ORDER BY id DESC LIMIT 1",
  );
  const row = rows[0];
  if (!row) return { settings: DEFAULT_SETTINGS, versionId: null, savedBy: null, savedAt: null };

  const raw = typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings;
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Saved settings (version ${row.id}) are no longer valid. Fix or delete that row in mg_settings_versions.`);
  }
  return { settings: parsed.data, versionId: row.id, savedBy: row.created_by, savedAt: row.created_at };
}

export async function saveSettings(settings: Settings, savedBy: string): Promise<number> {
  const result = await appExecute("INSERT INTO mg_settings_versions (settings, created_by) VALUES (?, ?)", [
    JSON.stringify(settings),
    savedBy,
  ]);
  return result.insertId;
}
