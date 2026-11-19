import "server-only";
import { appExecute, appQuery, appTransaction, type Transaction } from "./db";
import { parseWarnings } from "./editions";
import { indexInOrder } from "./insert-in-order";
import type { ArticleType, EditionWarning, Section } from "./selection";
import { getSettings } from "./settings";
import type { Settings } from "./settings-schema";

// Changes a person makes to a draft after it was generated.

/** A problem the person can act on; its message is shown on the page as written. */
export class EditError extends Error {}

export type ArticleChange = {
  id: number;
  included: boolean;
  section: Section;
  type: ArticleType;
  /** Send the post to this month's draft of another edition; "move" also removes it here. */
  transfer?: { mode: "move" | "copy"; vertical: string };
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Count warnings for the articles as they are now; warnings from the last PDF run are kept. */
async function refreshWarnings(tx: Transaction, editionId: number, counts: Settings["counts"]): Promise<void> {
  const [edition] = await tx.query<{ warnings: unknown }>("SELECT warnings FROM mg_editions WHERE id = ?", [editionId]);
  const [tally] = await tx.query<{ included: number; no_image: number | null }>(
    `SELECT COUNT(*) AS included, SUM(image_path IS NULL OR image_path = '') AS no_image
       FROM mg_edition_articles WHERE edition_id = ? AND included = 1`,
    [editionId],
  );
  const included = Number(tally?.included ?? 0);
  const noImage = Number(tally?.no_image ?? 0);
  const warnings: EditionWarning[] = [];
  if (included < counts.minimum) {
    warnings.push({ level: "warning", message: `Only ${plural(included, "post")} included; the minimum is ${counts.minimum}.` });
  } else if (included > counts.maximum) {
    warnings.push({ level: "warning", message: `${plural(included, "post")} included; the maximum is ${counts.maximum}.` });
  } else if (included < counts.recommended) {
    warnings.push({ level: "note", message: `${plural(included, "post")} included; the recommended count is ${counts.recommended}.` });
  }
  if (noImage > 0) warnings.push({ level: "warning", message: `${plural(noImage, "included post")} without an image.` });
  warnings.push(...parseWarnings(edition?.warnings).filter((warning) => warning.message.startsWith("PDF: ")));
  await tx.execute("UPDATE mg_editions SET warnings = ?, pdf_stale = 1 WHERE id = ?", [JSON.stringify(warnings), editionId]);
}

/**
 * Saves a reviewed draft: the order of `changes` becomes the page order, with
 * the posts left out after the included ones. Returns a line per post sent to
 * another edition.
 */
export async function saveArticles(editionId: number, changes: ArticleChange[]): Promise<string[]> {
  const { settings } = await getSettings();
  const labelOf = (key: string) => settings.verticals.find((vertical) => vertical.key === key)?.label ?? key;

  return appTransaction(async (tx) => {
    const [edition] = await tx.query<{ status: string; content_month: string; vertical: string }>(
      "SELECT status, content_month, vertical FROM mg_editions WHERE id = ? FOR UPDATE",
      [editionId],
    );
    if (!edition) throw new EditError("This edition no longer exists.");
    if (edition.status !== "draft") throw new EditError("This edition is finished. Reopen it to change it.");

    const rows = await tx.query<{ id: number; post_id: number; image_path: string | null }>(
      "SELECT id, post_id, image_path FROM mg_edition_articles WHERE edition_id = ?",
      [editionId],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const sameSet = changes.length === rows.length && new Set(changes.map((change) => change.id)).size === rows.length;
    if (!sameSet || changes.some((change) => !byId.has(change.id))) {
      throw new EditError("This edition was changed somewhere else. Reload the page and try again.");
    }

    const known = new Set(settings.types.map((type) => type.key));
    if (changes.some((change) => !known.has(change.type))) {
      throw new EditError("One of the article types is no longer in Settings. Choose a type for that article and save again.");
    }

    const sent: string[] = [];
    const touched = new Set<number>();
    for (const change of changes) {
      if (!change.transfer) continue;
      const { mode, vertical } = change.transfer;
      if (vertical === edition.vertical || !settings.verticals.some((entry) => entry.key === vertical)) {
        throw new EditError("Unknown edition to send a post to.");
      }
      const [target] = await tx.query<{ id: number }>(
        "SELECT id FROM mg_editions WHERE content_month = ? AND vertical = ? AND status = 'draft' ORDER BY id DESC LIMIT 1",
        [edition.content_month, vertical],
      );
      if (!target) {
        throw new EditError(`There is no draft ${labelOf(vertical)} edition for this month. Generate it first, then send the post.`);
      }
      const row = byId.get(change.id)!;
      // Goes to the end of the other edition's included posts; an entry already there is switched on.
      await tx.execute(
        `INSERT INTO mg_edition_articles
           (edition_id, post_id, position, included, section, article_type, assigned_by, match_note, image_path)
         VALUES (?, ?, 100000, 1, ?, ?, 'manual', ?, ?)
         ON DUPLICATE KEY UPDATE position = IF(included = 1, position, 100000), included = 1`,
        [target.id, row.post_id, change.section, change.type, `Sent from the ${labelOf(edition.vertical)} edition by hand`, row.image_path],
      );
      touched.add(target.id);
      if (mode === "move") await tx.execute("DELETE FROM mg_edition_articles WHERE id = ?", [change.id]);
      sent.push(`${mode === "move" ? "Moved" : "Copied"} one post to ${labelOf(vertical)} (edition ${target.id}).`);
    }

    for (const targetId of touched) {
      const all = await tx.query<{ id: number; included: number; position: number; section: string; type: string }>(
        "SELECT id, included, position, section, article_type AS type FROM mg_edition_articles WHERE edition_id = ? ORDER BY included DESC, position, id",
        [targetId],
      );
      // Posts that have just arrived (position 100000) join their own section, with the articles of their type.
      const order = all.filter((row) => row.included === 1 && row.position < 100000);
      for (const arrival of all.filter((row) => row.included === 1 && row.position >= 100000)) {
        order.splice(indexInOrder(order, arrival, settings.ordering), 0, arrival);
      }
      order.push(...all.filter((row) => row.included !== 1));
      for (const [index, row] of order.entries()) {
        await tx.execute("UPDATE mg_edition_articles SET position = ? WHERE id = ?", [index + 1, row.id]);
      }
      await refreshWarnings(tx, targetId, settings.counts);
    }

    const staying = changes.filter((change) => change.transfer?.mode !== "move");
    const ordered = [...staying.filter((change) => change.included), ...staying.filter((change) => !change.included)];
    for (const [index, change] of ordered.entries()) {
      await tx.execute(
        "UPDATE mg_edition_articles SET position = ?, included = ?, section = ?, article_type = ? WHERE id = ? AND edition_id = ?",
        [index + 1, change.included ? 1 : 0, change.section, change.type, change.id, editionId],
      );
    }
    await refreshWarnings(tx, editionId, settings.counts);
    return sent;
  });
}

export async function isDraft(id: number): Promise<boolean> {
  const rows = await appQuery<{ status: string }>("SELECT status FROM mg_editions WHERE id = ?", [id]);
  return rows[0]?.status === "draft";
}

/** Call after any change that the PDF does not show yet. */
export async function markStale(id: number): Promise<void> {
  await appExecute("UPDATE mg_editions SET pdf_stale = 1 WHERE id = ?", [id]);
}

/** A finished edition is locked. It needs a PDF that shows its latest changes first. */
export async function finishEdition(id: number): Promise<void> {
  const result = await appExecute(
    "UPDATE mg_editions SET status = 'finished', finished_at = NOW() WHERE id = ? AND status = 'draft' AND pdf_path IS NOT NULL AND pdf_stale = 0",
    [id],
  );
  if (result.affectedRows === 0) {
    throw new EditError("Create the PDF first: an edition is finished with the PDF that shows its latest changes.");
  }
}

export async function reopenEdition(id: number): Promise<void> {
  await appExecute("UPDATE mg_editions SET status = 'draft', finished_at = NULL WHERE id = ?", [id]);
}
