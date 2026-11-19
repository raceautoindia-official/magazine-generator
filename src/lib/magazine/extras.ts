import "server-only";
import { appExecute, appQuery } from "../db";
import { env } from "../env";

// A post's extra images are used as a company logo, as a second photo, or not
// at all. The decision is automatic; a person can overrule it per image.

export type ManualKind = "photo" | "logo" | "none";

export async function manualKind(sourcePath: string): Promise<ManualKind | null> {
  const rows = await appQuery<{ manual_kind: ManualKind | null }>(
    "SELECT manual_kind FROM mg_asset_cache WHERE source_path = ?",
    [sourcePath],
  );
  return rows[0]?.manual_kind ?? null;
}

/** null returns the image to the automatic decision. */
export async function setManualKind(sourcePath: string, kind: ManualKind | null): Promise<void> {
  await appExecute(
    `INSERT INTO mg_asset_cache (source_path, manual_kind) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE manual_kind = VALUES(manual_kind)`,
    [sourcePath, kind],
  );
}

/** Public address of a stored image, for small previews on the review pages. */
export function publicImageUrl(sourcePath: string): string {
  return new URL(sourcePath.split("/").map(encodeURIComponent).join("/"), env().S3_PUBLIC_BASE_URL).href;
}

export type ExtraImageState = {
  path: string;
  /** Public address of the stored image, for a small preview. */
  url: string;
  manual: ManualKind | null;
  /** What happens to the image now, in words for the review page. */
  usedAs: string;
};

const USED_AS: Record<ManualKind, string> = { logo: "Logo", photo: "Photo", none: "Not used" };

function automatic(row: { has_alpha: number | null; width: number | null; analysis: unknown } | undefined): string {
  if (!row || row.width === null) return "Decided when the PDF is created";
  if (row.has_alpha === 1) return "Logo (transparent background)";
  const analysis = (typeof row.analysis === "string" ? JSON.parse(row.analysis) : row.analysis) as { kind?: string } | null;
  if (analysis?.kind === "logo") return "Logo (decided by Claude)";
  if (analysis?.kind === "graphic") return "Not used (Claude sees a banner or graphic)";
  if (analysis?.kind === "photo") return "Photo (decided by Claude)";
  return row.width < 800 ? "Logo (small image)" : "Photo (large image)";
}

export async function extraImageStates(paths: string[]): Promise<Map<string, ExtraImageState>> {
  const states = new Map<string, ExtraImageState>();
  for (const sourcePath of new Set(paths)) {
    const rows = await appQuery<{ has_alpha: number | null; width: number | null; analysis: unknown; manual_kind: ManualKind | null }>(
      "SELECT has_alpha, width, analysis, manual_kind FROM mg_asset_cache WHERE source_path = ?",
      [sourcePath],
    );
    const manual = rows[0]?.manual_kind ?? null;
    states.set(sourcePath, {
      path: sourcePath,
      url: publicImageUrl(sourcePath),
      manual,
      usedAs: manual ? `${USED_AS[manual]} (set by hand)` : automatic(rows[0]),
    });
  }
  return states;
}
