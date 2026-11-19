import "server-only";
import { z } from "zod";
import { appExecute, appQuery } from "../db";
import { assignmentsOf, goesToEveryEdition, type AiPlacements, type PostRecord } from "../selection";
import type { Settings } from "../settings-schema";
import { askClaude, claudeAvailable } from "./claude";

// Keyword matching cannot place a post that names only a company ("BharatBenz
// Opens New Dealership"). Claude knows what those companies make, so it places
// the shared-category posts that matched no edition's words. Each post is
// asked about once and the answer is stored.

const answerSchema = z.object({
  placements: z.array(
    z.object({
      postId: z.number(),
      editions: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});

function parseKeys(value: unknown): string[] {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Stored placements for these posts. Never calls Claude. */
export async function storedPlacements(posts: PostRecord[]): Promise<AiPlacements> {
  const placements: AiPlacements = new Map();
  if (posts.length === 0) return placements;
  const ids = posts.map((post) => post.id);
  const rows = await appQuery<{ post_id: number; verticals: unknown; reason: string | null }>(
    `SELECT post_id, verticals, reason FROM mg_post_placements WHERE post_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  for (const row of rows) placements.set(row.post_id, { verticalKeys: parseKeys(row.verticals), reason: row.reason ?? "" });
  return placements;
}

/**
 * Stored placements plus, when a Claude key is configured, answers for the
 * general posts not asked about yet. A failure leaves those posts as general
 * and is returned as a note instead of stopping the generation.
 */
export async function ensurePlacements(
  posts: PostRecord[],
  settings: Settings,
): Promise<{ placements: AiPlacements; note: string | null }> {
  const placements = await storedPlacements(posts);
  const pending = posts.filter(
    (post) =>
      !placements.has(post.id) &&
      // Shared posts that match no edition's words, and Insights posts that would otherwise go to every edition.
      (assignmentsOf(post, settings).some((entry) => entry.assignedBy === "general") ||
        (goesToEveryEdition(post, settings) && assignmentsOf(post, settings).length === settings.verticals.length)),
  );
  if (pending.length === 0) return { placements, note: null };
  if (!claudeAvailable()) return { placements, note: null };

  const editions = settings.verticals
    .map((vertical) => `- ${vertical.key}: ${vertical.label} (${vertical.coverSubtitle}). Typical words: ${vertical.keywords.slice(0, 12).join(", ")}`)
    .join("\n");
  const list = pending
    .map((post) =>
      JSON.stringify({
        postId: post.id,
        headline: post.title,
        category: [post.parentCategoryName, post.categoryName].filter(Boolean).join(" > "),
        tags: post.tags.slice(0, 12),
        summary: post.summary.slice(0, 500),
      }),
    )
    .join("\n");

  try {
    const answer = await askClaude({
      model: settings.ai.textModel,
      schema: answerSchema,
      effort: "low",
      system:
        "You sort news posts for Race Auto India, an Indian automotive trade publisher that issues a separate monthly e-magazine per vehicle segment. " +
        "Each post below sits in a general category (technology, components, business), and a keyword check could not tell which segment it concerns. " +
        "Use what you know about the companies and products named to decide which magazine editions its readers would expect to find it in.",
      prompt:
        `Editions (key: description):\n${editions}\n\n` +
        `Posts, one JSON object per line:\n${list}\n\n` +
        "For every post return its postId, the edition keys it belongs in, and a reason of at most 15 words. " +
        "Choose every edition the post is clearly about; a post about a company that builds trucks belongs in the commercial vehicle edition even if no truck word appears. " +
        "A parts or technology post belongs with the vehicle type the part is for. " +
        "If a post is about the industry in general (for example a month's vehicle sales across all segments of a country), or you cannot tell, return an empty list for it rather than guessing. " +
        "Use only the edition keys listed above.",
    });

    const known = new Set(settings.verticals.map((vertical) => vertical.key));
    const asked = new Set(pending.map((post) => post.id));
    for (const item of answer.placements) {
      if (!asked.has(item.postId) || placements.has(item.postId)) continue;
      const verticalKeys = [...new Set(item.editions.filter((key) => known.has(key)))];
      const reason = item.reason.slice(0, 500);
      await appExecute(
        `INSERT INTO mg_post_placements (post_id, verticals, reason, model) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE verticals = VALUES(verticals), reason = VALUES(reason), model = VALUES(model)`,
        [item.postId, JSON.stringify(verticalKeys), reason, settings.ai.textModel],
      );
      placements.set(item.postId, { verticalKeys, reason });
    }
    return { placements, note: null };
  } catch (error) {
    console.error("placement by Claude failed", error);
    return {
      placements,
      note: `Claude could not place ${pending.length} shared post(s): ${error instanceof Error ? error.message : "unknown error"} They were treated as general posts.`,
    };
  }
}
