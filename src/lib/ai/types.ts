import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { appExecute, appQuery } from "../db";
import { fetchPostContents } from "../posts";
import { assignmentsOf, stripHtml, type AiTypes, type PostRecord } from "../selection";
import type { Settings } from "../settings-schema";
import { askClaude, claudeAvailable, mapLimited } from "./claude";

// Headline words are a rough guide to an article's type. Claude reads the whole
// article and names its type; each post is read once and the answer is stored.

const answerSchema = z.object({
  types: z.array(z.object({ postId: z.number(), type: z.string(), reason: z.string() })),
});

/** Posts per request, and how much of each article is sent (most are shorter than this). */
const BATCH = 10;
const MAX_CHARS = 7000;

/** Answers are only reused while the list of types is the one Claude chose from. */
function typeSet(settings: Settings): string {
  const described = settings.types.map((type) => `${type.key}=${type.label}=${type.description}`).sort().join("|");
  return createHash("sha1").update(described).digest("hex");
}

/** Stored answers for these posts. Never calls Claude. */
export async function storedTypes(posts: PostRecord[], settings: Settings): Promise<AiTypes> {
  const types: AiTypes = new Map();
  if (posts.length === 0) return types;
  const ids = posts.map((post) => post.id);
  const rows = await appQuery<{ post_id: number; article_type: string; reason: string | null }>(
    `SELECT post_id, article_type, reason FROM mg_post_types WHERE type_set = ? AND post_id IN (${ids.map(() => "?").join(",")})`,
    [typeSet(settings), ...ids],
  );
  const known = new Set(settings.types.map((type) => type.key));
  for (const row of rows) {
    if (known.has(row.article_type)) types.set(row.post_id, { type: row.article_type, reason: row.reason ?? "" });
  }
  return types;
}

/**
 * Stored answers plus, when a Claude key is configured, answers for the posts
 * not read yet that can appear in an edition. A failure leaves those posts with
 * the type their headline gives and is returned as a note.
 */
export async function ensureTypes(posts: PostRecord[], settings: Settings): Promise<{ types: AiTypes; note: string | null }> {
  const types = await storedTypes(posts, settings);
  const pending = posts.filter(
    (post) => !types.has(post.id) && post.words >= settings.counts.minimumWords && assignmentsOf(post, settings).length > 0,
  );
  if (pending.length === 0 || !claudeAvailable()) return { types, note: null };

  const contents = await fetchPostContents(pending.map((post) => post.id));
  const typeList = settings.types.map((type) => `- ${type.key}: ${type.label}. ${type.description}`).join("\n");
  const known = new Set(settings.types.map((type) => type.key));
  const set = typeSet(settings);
  const batches: PostRecord[][] = [];
  for (let start = 0; start < pending.length; start += BATCH) batches.push(pending.slice(start, start + BATCH));

  let failed = 0;
  let lastError = "";
  await mapLimited(batches, 3, async (batch) => {
    const list = batch
      .map((post) =>
        JSON.stringify({
          postId: post.id,
          headline: post.title,
          category: [post.parentCategoryName, post.categoryName].filter(Boolean).join(" > "),
          text: stripHtml(contents.get(post.id) ?? "").slice(0, MAX_CHARS),
        }),
      )
      .join("\n");
    try {
      const answer = await askClaude({
        model: settings.ai.textModel,
        schema: answerSchema,
        effort: "low",
        system:
          "You sort news articles for Race Auto India, an Indian automotive trade publisher. Its monthly e-magazines print articles grouped by type, " +
          "so each article needs exactly one type. The headline alone is often misleading, which is why you are given the full text: " +
          "decide by what the article is mainly about, not by single words that appear in it.",
        prompt:
          `Types (key: name and meaning):\n${typeList}\n\n` +
          `Articles, one JSON object per line:\n${list}\n\n` +
          "For every article return its postId, the key of the one type that fits best, and a reason of at most 12 words. " +
          "The category is where the website filed the article; it is a hint, and is often loose. " +
          "When an article touches several types, choose the one its main news is about: a new model announced together with the plant that builds it is a vehicle launch. " +
          'Use "other" when no named type really fits; do not force a fit. Use only the type keys listed above.',
      });
      const asked = new Set(batch.map((post) => post.id));
      for (const item of answer.types) {
        if (!asked.has(item.postId) || !known.has(item.type)) continue;
        const reason = item.reason.slice(0, 500);
        await appExecute(
          `INSERT INTO mg_post_types (post_id, article_type, reason, model, type_set) VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE article_type = VALUES(article_type), reason = VALUES(reason), model = VALUES(model), type_set = VALUES(type_set)`,
          [item.postId, item.type, reason, settings.ai.textModel, set],
        );
        types.set(item.postId, { type: item.type, reason });
      }
    } catch (error) {
      console.error("typing by Claude failed", error);
      failed += batch.length;
      lastError = error instanceof Error ? error.message : "unknown error";
    }
  });

  return {
    types,
    note: failed > 0 ? `Claude could not read ${failed} post(s) to decide their type: ${lastError} Their type comes from the headline instead.` : null,
  };
}
