import "server-only";
import { ensurePlacements } from "./ai/placement";
import { ensureTypes } from "./ai/types";
import { appExecute, appQuery, appTransaction } from "./db";
import { editionLabel } from "./months";
import { collectPosts, fetchPosts } from "./posts";
import {
  planEdition,
  type ArticleType,
  type AssignedBy,
  type EditionWarning,
  type PostRecord,
  type Section,
} from "./selection";
import { getSettings } from "./settings";
import { recordTiming, Timer } from "./timing";

export type EditionSummary = {
  id: number;
  vertical: string;
  contentMonth: string;
  editionLabel: string;
  status: "draft" | "finished";
  warnings: EditionWarning[];
  included: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** null until a PDF has been created. */
  pageCount: number | null;
  /** True when something changed after the PDF was created. */
  pdfStale: boolean;
};

export type EditionArticle = {
  id: number;
  postId: number;
  position: number;
  included: boolean;
  section: Section;
  type: ArticleType;
  assignedBy: AssignedBy;
  note: string | null;
  /** null when the post has since been deleted from the main site. */
  post: PostRecord | null;
};

export type Edition = EditionSummary & { settingsVersionId: number | null; articles: EditionArticle[] };

type EditionRow = {
  id: number;
  vertical: string;
  content_month: string;
  edition_label: string;
  status: "draft" | "finished";
  settings_version_id: number | null;
  warnings: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
  pdf_path: string | null;
  page_count: number | null;
  pdf_stale: number;
  included?: number | null;
};

export function parseWarnings(value: unknown): EditionWarning[] {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(raw) ? (raw as EditionWarning[]) : [];
}

function toSummary(row: EditionRow): EditionSummary {
  return {
    id: row.id,
    vertical: row.vertical,
    contentMonth: row.content_month,
    editionLabel: row.edition_label,
    status: row.status,
    warnings: parseWarnings(row.warnings),
    included: Number(row.included ?? 0),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pageCount: row.pdf_path ? (row.page_count ?? 0) : null,
    pdfStale: Boolean(row.pdf_path) && row.pdf_stale === 1,
  };
}

/**
 * Creates a new draft for each vertical from the month's posts. Earlier drafts
 * of the same month and vertical are kept. Returns the new edition ids.
 */
export async function generateEditions(month: string, verticalKeys: string[], createdBy: string): Promise<number[]> {
  const { settings, versionId } = await getSettings();
  const known = new Set(settings.verticals.map((vertical) => vertical.key));
  const keys = [...new Set(verticalKeys)].filter((key) => known.has(key));
  if (keys.length === 0) throw new Error("No known edition was selected.");

  // The work done once for the month, whichever editions are generated.
  const shared = new Timer();
  const known$ = (ms: number) => (ms < 400 ? "already known from an earlier run, nothing to ask" : undefined);
  const posts = await shared.step("Reading the month's posts from the website", "site", () => collectPosts(month), (found) => `${found.length} posts`);
  // Shared posts that match no edition's words are placed by Claude, once per post.
  let from = Date.now();
  const { placements, note } = await shared.step("Claude sorts shared posts into editions", "claude", () => ensurePlacements(posts, settings), () => known$(Date.now() - from));
  // Claude reads each post that can appear in an edition and names its type, once per post.
  from = Date.now();
  const typed = await shared.step("Claude reads every article to decide its type", "claude", () => ensureTypes(posts, settings), () => known$(Date.now() - from));
  const ids: number[] = [];

  for (const key of keys) {
    const own = new Timer();
    const plan = planEdition(posts, key, settings, placements, typed.types);
    if (note) plan.warnings.push({ level: "warning", message: note });
    if (typed.note) plan.warnings.push({ level: "warning", message: typed.note });
    const id = await appTransaction(async (tx) => {
      const edition = await tx.execute(
        `INSERT INTO mg_editions (vertical, content_month, edition_label, status, settings_version_id, warnings, created_by)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        [key, month, editionLabel(month), versionId, JSON.stringify(plan.warnings), createdBy],
      );
      for (const candidate of plan.candidates) {
        await tx.execute(
          `INSERT INTO mg_edition_articles
             (edition_id, post_id, position, included, section, article_type, assigned_by, match_note, image_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            edition.insertId,
            candidate.post.id,
            candidate.position,
            candidate.included ? 1 : 0,
            candidate.section,
            candidate.type,
            candidate.assignedBy,
            candidate.note.slice(0, 500),
            candidate.post.image,
          ],
        );
      }
      return edition.insertId;
    });
    ids.push(id);

    // The month's work is shared out equally between the editions generated together, so their times add up to what was really spent.
    const together = keys.length;
    const timer = new Timer();
    for (const step of shared.steps) {
      timer.add({
        ...step,
        ms: Math.round(step.ms / together),
        detail: [step.detail, together > 1 ? `this edition's share; done once for the ${together} editions generated together` : undefined].filter(Boolean).join("; ") || undefined,
      });
    }
    timer.add({ name: "Choosing, ordering and saving the articles", by: "app", ms: own.total(), detail: `${plan.candidates.filter((candidate) => candidate.included).length} articles` });
    await recordTiming(id, "generate", "Draft generated", timer, createdBy, timer.steps.reduce((sum, step) => sum + step.ms, 0));
  }
  return ids;
}

const SUMMARY_SQL = `SELECT e.id, e.vertical, e.content_month, e.edition_label, e.status, e.settings_version_id,
       e.warnings, e.created_by, e.created_at, e.updated_at, e.pdf_path, e.page_count, e.pdf_stale,
       (SELECT COUNT(*) FROM mg_edition_articles a WHERE a.edition_id = e.id AND a.included = 1) AS included
  FROM mg_editions e`;

/** Newest first. With a month, only that month's editions. */
export async function listEditions(month?: string): Promise<EditionSummary[]> {
  const rows = month
    ? await appQuery<EditionRow>(`${SUMMARY_SQL} WHERE e.content_month = ? ORDER BY e.id DESC`, [month])
    : await appQuery<EditionRow>(`${SUMMARY_SQL} ORDER BY e.id DESC LIMIT 100`);
  return rows.map(toSummary);
}

export async function getEdition(id: number): Promise<Edition | null> {
  const rows = await appQuery<EditionRow>(`${SUMMARY_SQL} WHERE e.id = ?`, [id]);
  const row = rows[0];
  if (!row) return null;

  const articleRows = await appQuery<{
    id: number;
    post_id: number;
    position: number;
    included: number;
    section: Section;
    article_type: ArticleType;
    assigned_by: AssignedBy;
    match_note: string | null;
  }>(
    `SELECT id, post_id, position, included, section, article_type, assigned_by, match_note
       FROM mg_edition_articles WHERE edition_id = ? ORDER BY position, id`,
    [id],
  );
  // Post text and details are always read live from the main site.
  const posts = await fetchPosts(articleRows.map((article) => article.post_id));

  return {
    ...toSummary(row),
    settingsVersionId: row.settings_version_id,
    articles: articleRows.map((article) => ({
      id: article.id,
      postId: article.post_id,
      position: article.position,
      included: article.included === 1,
      section: article.section,
      type: article.article_type,
      assignedBy: article.assigned_by,
      note: article.match_note,
      post: posts.get(article.post_id) ?? null,
    })),
  };
}

/** Only drafts can be deleted. Returns false when nothing was removed. */
export async function deleteDraft(id: number): Promise<boolean> {
  const result = await appExecute("DELETE FROM mg_editions WHERE id = ? AND status = 'draft'", [id]);
  return result.affectedRows > 0;
}
