import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { matchByWords, middleIndex, nearMiddle } from "./advert-match";
import { BAND_SLOTS, bandSlots, sizeSpec, type AdvertSize } from "./advert-sizes";
import { advertFile, getAdvert, listAdverts, type Advert } from "./adverts";
import { chooseArticles, type AdvertChoice } from "./ai/advert";
import { claudeAvailable } from "./ai/claude";
import { appExecute, appQuery } from "./db";
import { getEdition, type EditionArticle } from "./editions";
import { fetchPostContents } from "./posts";
import { EditError } from "./review";
import { getSettings } from "./settings";

// Where each advert is printed in an edition. Every advert belongs to one article:
// a full page is the right-hand page that ends that article, a double page follows it,
// and a half or quarter page fills the lower half of the article's first text page.
// That half holds one half page or two quarter pages, so an article has room for no more.

export type PlacedAdvert = {
  /** Id of the placement, not of the advert. */
  id: number;
  advertId: number;
  advertiser: string;
  size: AdvertSize;
  summary: string;
  /** mg_edition_articles.id, or null while the advert has no place. */
  articleId: number | null;
  reason: string;
  placedBy: "claude" | "rule" | "person";
  warning: string | null;
};

export async function editionAdverts(editionId: number): Promise<PlacedAdvert[]> {
  const rows = await appQuery<{
    id: number;
    advert_id: number;
    advertiser: string;
    size: AdvertSize;
    summary: string | null;
    article_id: number | null;
    reason: string;
    placed_by: PlacedAdvert["placedBy"];
    warning: string | null;
  }>(
    `SELECT p.id, p.advert_id, a.advertiser, a.size, a.summary, p.article_id, p.reason, p.placed_by, p.warning
       FROM mg_edition_adverts p JOIN mg_adverts a ON a.id = p.advert_id
      WHERE p.edition_id = ? ORDER BY p.id`,
    [editionId],
  );
  return rows.map((row) => ({
    id: row.id,
    advertId: row.advert_id,
    advertiser: row.advertiser,
    size: row.size,
    summary: row.summary ?? "",
    articleId: row.article_id,
    reason: row.reason,
    placedBy: row.placed_by,
    warning: row.warning,
  }));
}

const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** True when the article's text page can still take an advert of this size beside the others placed with it. */
function hasRoom(articleId: number, size: AdvertSize, others: PlacedAdvert[]): boolean {
  const used = others.filter((entry) => entry.articleId === articleId).reduce((sum, entry) => sum + bandSlots(entry.size), 0);
  return used + bandSlots(size) <= BAND_SLOTS;
}

const short = (title: string) => (title.trim().length > 70 ? `${title.trim().slice(0, 67)}…` : title.trim());

async function store(id: number, articleId: number | null, reason: string, placedBy: PlacedAdvert["placedBy"], warning: string | null = null): Promise<void> {
  await appExecute("UPDATE mg_edition_adverts SET article_id = ?, reason = ?, placed_by = ?, warning = ? WHERE id = ?", [
    articleId,
    reason.slice(0, 700),
    placedBy,
    warning ? warning.slice(0, 400) : null,
    id,
  ]);
}

/**
 * Chooses the place of the given placements. A double page goes to the middle of the magazine.
 * Any other size goes with the article it relates to: Claude reads the advert's description and the
 * articles; without Claude, shared words decide; with nothing in common it goes near the middle.
 * A half or quarter page only goes to an article whose text page still has room for it.
 * `before` is put in front of each reason (used when an advert had to be placed again).
 */
export async function placeAutomatically(
  editionId: number,
  placementIds: number[],
  before = "",
  /** Claude's choices made earlier as suggestions, by library advert id. When they cover every advert, Claude is not asked again. */
  known?: Map<number, AdvertChoice>,
): Promise<void> {
  if (placementIds.length === 0) return;
  const edition = await getEdition(editionId);
  if (!edition) throw new EditError("This edition no longer exists.");
  const articles = edition.articles.filter((article): article is EditionArticle & { post: NonNullable<EditionArticle["post"]> } => article.included && article.post !== null);
  const placements = (await editionAdverts(editionId)).filter((placement) => placementIds.includes(placement.id));
  if (articles.length === 0) {
    for (const placement of placements) await store(placement.id, null, "This edition has no articles yet. The advert is placed when it has some.", "rule");
    return;
  }

  const middle = articles[middleIndex(articles.length)];
  const toMiddle = (placement: PlacedAdvert, why: string) => store(placement.id, middle.id, `${before}${why} That is after "${short(middle.post.title)}".`, "rule");

  const doubles = placements.filter((placement) => placement.size === "double");
  for (const placement of doubles) await toMiddle(placement, "A double-page advert goes in the middle of the magazine.");

  const singles = placements.filter((placement) => placement.size !== "double");
  if (singles.length === 0) return;

  const othersOf = async (placement: PlacedAdvert) => (await editionAdverts(editionId)).filter((entry) => entry.id !== placement.id);

  /** An advert with nothing in common with any article: near the middle, with an article that has no advert yet. */
  const toFreeArticle = async (placement: PlacedAdvert, why: string) => {
    const others = await othersOf(placement);
    const article = articles[nearMiddle(articles.length, (index) => others.some((entry) => entry.articleId === articles[index].id))];
    await store(placement.id, article.id, `${before}${why} It sits near the middle of the magazine, with an article that has no other advert: "${short(article.post.title)}".`, "rule");
  };

  const { settings } = await getSettings();
  const contents = await fetchPostContents(articles.map((article) => article.postId));
  const texts = new Map(articles.map((article) => [article.id, plainText(contents.get(article.postId) ?? "")]));
  const details = new Map<number, { keywords: string[]; product: string }>();
  for (const placement of singles) {
    const advert = await getAdvert(placement.advertId);
    details.set(placement.id, { keywords: advert?.analysis?.keywords ?? [], product: advert?.analysis?.product ?? "" });
  }

  /** Without Claude: the article sharing most words with the advert, else the middle. */
  const byWords = async (placement: PlacedAdvert, note: string) => {
    const others = await othersOf(placement);
    const found = matchByWords(
      { advertiser: placement.advertiser, keywords: details.get(placement.id)?.keywords ?? [] },
      articles.filter((article) => hasRoom(article.id, placement.size, others)).map((article) => ({ id: article.id, title: article.post.title, text: texts.get(article.id) ?? "" })),
    );
    if (found) {
      await store(placement.id, found.articleId, `${before}${note}The article mentions ${found.shared.slice(0, 4).join(", ")}, as the advert does.`, "rule");
    } else {
      await toFreeArticle(placement, `${note}No article in this edition shares a subject with the advert.`);
    }
  };

  // Claude needs a description to go on; an advert without one is matched by its advertiser's name.
  const described = singles.filter((placement) => placement.summary.trim() !== "");
  for (const placement of singles.filter((entry) => !described.includes(entry))) await byWords(placement, "The advert has no description yet. ");
  if (described.length === 0) return;
  if (!claudeAvailable()) {
    for (const placement of described) await byWords(placement, "");
    return;
  }

  const labelOfType = new Map(settings.types.map((type) => [type.key, type.label]));
  const label = settings.verticals.find((vertical) => vertical.key === edition.vertical)?.label ?? edition.vertical;
  try {
    const suggested = known !== undefined && described.every((placement) => known.has(placement.advertId));
    const choices: AdvertChoice[] = suggested
      ? described.map((placement) => ({ ...known.get(placement.advertId)!, advertId: placement.id }))
      : await chooseArticles(
      described.map((placement) => ({
        advertId: placement.id,
        size: sizeSpec(placement.size)?.label ?? placement.size,
        advertiser: placement.advertiser,
        summary: placement.summary,
        product: details.get(placement.id)?.product ?? "",
        keywords: details.get(placement.id)?.keywords ?? [],
      })),
      articles.map((article) => ({
        articleId: article.id,
        headline: article.post.title.trim(),
        type: labelOfType.get(article.type) ?? article.type,
        section: article.section,
        text: (texts.get(article.id) ?? "").slice(0, 700),
      })),
      `${label}, ${edition.editionLabel}`,
      settings.ai.textModel,
        );
    const unrelated: { placement: PlacedAdvert; why: string }[] = [];
    for (const placement of described) {
      const choice = choices.find((entry) => entry.advertId === placement.id);
      const article = choice?.articleId != null ? articles.find((entry) => entry.id === choice.articleId) : undefined;
      if (!choice || !article) {
        unrelated.push({ placement, why: `No article in this edition relates to the advert${choice?.reason ? ` (${choice.reason.trim().replace(/\.$/, "")})` : ""}.` });
        continue;
      }
      // A half or quarter page needs room on the article's text page; failing that, Claude's next choices are tried.
      const others = await othersOf(placement);
      if (!hasRoom(article.id, placement.size, others)) {
        const next = choice.alternatives
          .map((id) => articles.find((entry) => entry.id === id))
          .find((entry) => entry !== undefined && entry.id !== article.id && hasRoom(entry.id, placement.size, others));
        const full = `The closest article, "${short(article.post.title)}", has no room for another advert on its text page (${choice.reason.trim().replace(/\.$/, "")}).`;
        if (next) await store(placement.id, next.id, `${before}${full} This is the next closest article with room.`, "claude");
        else unrelated.push({ placement, why: `${full} No other article relates to the advert.` });
        continue;
      }
      await store(
        placement.id,
        article.id,
        `${before}${choice.reason.trim()}`,
        "claude",
        choice.competitor ? `This article is mainly about a competitor of ${placement.advertiser || "the advertiser"}. Move the advert if the advertiser would mind.` : null,
      );
    }
    // Placed last, so they take articles that the related adverts left free.
    for (const { placement, why } of unrelated) await toFreeArticle(placement, why);
  } catch (error) {
    console.error("advert placement by Claude failed", error);
    for (const placement of described) await byWords(placement, "Claude could not be asked, so shared words decided. ");
  }
}

const sha = (text: string) => createHash("sha1").update(text).digest("hex");
const advertSignature = (advert: Advert) => sha(`${advert.size}|${advert.advertiser}|${advert.summary}`);

type IncludedArticle = EditionArticle & { post: NonNullable<EditionArticle["post"]> };

/** The edition's articles, the library adverts not in it yet, and the suggestions that still hold for them. */
async function suggestionContext(editionId: number) {
  const edition = await getEdition(editionId);
  if (!edition) return null;
  const articles = edition.articles.filter((article): article is IncludedArticle => article.included && article.post !== null);
  // The order of the articles does not matter to a suggestion; which articles are in the magazine does.
  const articleSig = sha(articles.map((article) => `${article.id}:${article.postId}`).sort().join(","));
  const here = new Set((await editionAdverts(editionId)).map((entry) => entry.advertId));
  const available = (await listAdverts()).filter((advert) => !advert.archived && !here.has(advert.id));
  const rows = await appQuery<{ advert_id: number; article_sig: string; advert_sig: string; choice: unknown }>(
    "SELECT advert_id, article_sig, advert_sig, choice FROM mg_edition_advert_suggestions WHERE edition_id = ?",
    [editionId],
  );
  const fresh = new Map<number, AdvertChoice>();
  for (const row of rows) {
    const advert = available.find((entry) => entry.id === row.advert_id);
    if (!advert || row.article_sig !== articleSig || row.advert_sig !== advertSignature(advert)) continue;
    const choice = (typeof row.choice === "string" ? JSON.parse(row.choice) : row.choice) as AdvertChoice;
    fresh.set(advert.id, { ...choice, advertId: advert.id, alternatives: Array.isArray(choice.alternatives) ? choice.alternatives : [] });
  }
  return { edition, articles, articleSig, available, fresh };
}

export type AdvertSuggestion = {
  /** advertiser = the article is about the advertiser; product = same kind of product; segment = only the segment is shared; none = nothing relates. */
  relation: AdvertChoice["relation"];
  articleTitle: string | null;
  reason: string;
  competitor: boolean;
};

/**
 * What the picker shows for each library advert not in the edition yet: the article it would be printed with and why.
 * Never asks Claude; `missing` says how many adverts have no suggestion that still holds.
 */
export async function advertSuggestions(editionId: number): Promise<{ suggestions: Map<number, AdvertSuggestion>; missing: number }> {
  const context = await suggestionContext(editionId);
  const suggestions = new Map<number, AdvertSuggestion>();
  if (!context) return { suggestions, missing: 0 };
  for (const [advertId, choice] of context.fresh) {
    const article = choice.articleId != null ? context.articles.find((entry) => entry.id === choice.articleId) : undefined;
    // A double page is printed in the middle whatever it relates to, so its card names that place, not the related article.
    if (context.available.find((advert) => advert.id === advertId)?.size === "double" && context.articles.length > 0) {
      suggestions.set(advertId, {
        relation: article ? choice.relation : "none",
        articleTitle: context.articles[middleIndex(context.articles.length)].post.title.trim(),
        reason: `A double page goes in the middle of the magazine. ${article ? `It suits this edition: ${choice.reason.trim()}` : "No article in this edition is on its subject."}`,
        competitor: false,
      });
      continue;
    }
    suggestions.set(advertId, {
      relation: article ? choice.relation : "none",
      articleTitle: article ? article.post.title.trim() : null,
      reason: choice.reason.trim(),
      competitor: Boolean(article) && choice.competitor,
    });
  }
  const askable = context.articles.length > 0 ? context.available.filter((advert) => advert.summary.trim() !== "") : [];
  return { suggestions, missing: askable.filter((advert) => !context.fresh.has(advert.id)).length };
}

/**
 * Has Claude read the edition's articles and say, for every library advert without a suggestion that still holds,
 * which article it belongs with. One request. Returns how many adverts were looked at.
 */
export async function suggestAdverts(editionId: number): Promise<number> {
  const context = await suggestionContext(editionId);
  if (!context || context.articles.length === 0 || !claudeAvailable()) return 0;
  const pending = context.available.filter((advert) => advert.summary.trim() !== "" && !context.fresh.has(advert.id));
  if (pending.length === 0) return 0;
  const { settings } = await getSettings();
  const contents = await fetchPostContents(context.articles.map((article) => article.postId));
  const labelOfType = new Map(settings.types.map((type) => [type.key, type.label]));
  const label = settings.verticals.find((vertical) => vertical.key === context.edition.vertical)?.label ?? context.edition.vertical;
  const choices = await chooseArticles(
    pending.map((advert) => ({
      advertId: advert.id,
      size: sizeSpec(advert.size)?.label ?? advert.size,
      advertiser: advert.advertiser,
      summary: advert.summary,
      product: advert.analysis?.product ?? "",
      keywords: advert.analysis?.keywords ?? [],
    })),
    context.articles.map((article) => ({
      articleId: article.id,
      headline: article.post.title.trim(),
      type: labelOfType.get(article.type) ?? article.type,
      section: article.section,
      text: plainText(contents.get(article.postId) ?? "").slice(0, 700),
    })),
    `${label}, ${context.edition.editionLabel}`,
    settings.ai.textModel,
  );
  for (const advert of pending) {
    const choice = choices.find((entry) => entry.advertId === advert.id);
    if (!choice) continue;
    const valid = (id: number | null) => id != null && context.articles.some((article) => article.id === id);
    const stored = {
      articleId: valid(choice.articleId) ? choice.articleId : null,
      alternatives: choice.alternatives.filter((id) => valid(id)),
      relation: valid(choice.articleId) ? choice.relation : "none",
      competitor: choice.competitor,
      reason: choice.reason.slice(0, 500),
    };
    await appExecute(
      `INSERT INTO mg_edition_advert_suggestions (edition_id, advert_id, article_sig, advert_sig, choice) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE article_sig = VALUES(article_sig), advert_sig = VALUES(advert_sig), choice = VALUES(choice)`,
      [editionId, advert.id, context.articleSig, advertSignature(advert), JSON.stringify(stored)],
    );
  }
  return pending.length;
}

async function requireDraft(editionId: number): Promise<void> {
  const rows = await appQuery<{ status: string }>("SELECT status FROM mg_editions WHERE id = ?", [editionId]);
  if (!rows[0]) throw new EditError("This edition no longer exists.");
  if (rows[0].status !== "draft") throw new EditError("This edition is finished. Reopen it to change it.");
}

const stale = (editionId: number) => appExecute("UPDATE mg_editions SET pdf_stale = 1 WHERE id = ?", [editionId]);

/** Adds an advert from the library to a draft and chooses its place. */
export async function addAdvert(editionId: number, advertId: number, by: string): Promise<void> {
  await requireDraft(editionId);
  const advert = await getAdvert(advertId);
  if (!advert) throw new EditError("This advert is no longer in the library.");
  if (advert.archived) throw new EditError("This advert is disabled. Enable it on the Adverts page first.");
  const existing = await appQuery<{ id: number }>("SELECT id FROM mg_edition_adverts WHERE edition_id = ? AND advert_id = ?", [editionId, advertId]);
  if (existing[0]) throw new EditError("This advert is already in this edition.");
  const created = await appExecute("INSERT INTO mg_edition_adverts (edition_id, advert_id, created_by) VALUES (?, ?, ?)", [editionId, advertId, by]);
  await placeAutomatically(editionId, [created.insertId]);
  await stale(editionId);
}

/**
 * Adds several adverts from the library to a draft and chooses all their places together: one request to Claude for
 * the lot, which also lets it keep two adverts from landing on the same article. Adverts already in the edition are
 * skipped. Returns how many were added.
 */
export async function addAdverts(editionId: number, advertIds: number[], by: string): Promise<number> {
  await requireDraft(editionId);
  const wanted = [...new Set(advertIds)];
  if (wanted.length === 0) throw new EditError("Tick at least one advert to add.");
  const here = new Set((await editionAdverts(editionId)).map((entry) => entry.advertId));
  // What was suggested on the page is what happens: the suggestions are read before the adverts stop being "available".
  const known = (await suggestionContext(editionId))?.fresh;
  const created: number[] = [];
  for (const advertId of wanted) {
    if (here.has(advertId)) continue;
    const advert = await getAdvert(advertId);
    if (!advert) throw new EditError("One of the adverts is no longer in the library. Reload the page and choose again.");
    if (advert.archived) throw new EditError(`The advert of ${advert.advertiser || "an advertiser"} has been disabled. Reload the page and choose again.`);
    const row = await appExecute("INSERT INTO mg_edition_adverts (edition_id, advert_id, created_by) VALUES (?, ?, ?)", [editionId, advertId, by]);
    created.push(row.insertId);
  }
  await placeAutomatically(editionId, created, "", known);
  if (created.length > 0) await stale(editionId);
  return created.length;
}

async function ownPlacement(editionId: number, placementId: number): Promise<void> {
  const rows = await appQuery<{ id: number }>("SELECT id FROM mg_edition_adverts WHERE id = ? AND edition_id = ?", [placementId, editionId]);
  if (!rows[0]) throw new EditError("This advert is no longer in this edition. Reload the page.");
}

/** A person puts the advert with another article. */
export async function moveAdvert(editionId: number, placementId: number, articleId: number): Promise<void> {
  await requireDraft(editionId);
  await ownPlacement(editionId, placementId);
  const rows = await appQuery<{ id: number }>("SELECT id FROM mg_edition_articles WHERE id = ? AND edition_id = ? AND included = 1", [articleId, editionId]);
  if (!rows[0]) throw new EditError("That article is not in the saved magazine. Save your changes to the article list first, then move the advert.");
  const placements = await editionAdverts(editionId);
  const own = placements.find((entry) => entry.id === placementId);
  if (own && !hasRoom(articleId, own.size, placements.filter((entry) => entry.id !== placementId))) {
    throw new EditError("That article's text page already has its adverts: one half page or two quarter pages. Choose another article, or move one of those away first.");
  }
  await store(placementId, articleId, "Put here by hand.", "person");
  await stale(editionId);
}

/** Has the place chosen again, as when the advert was added. */
export async function placeAgain(editionId: number, placementId: number): Promise<void> {
  await requireDraft(editionId);
  await ownPlacement(editionId, placementId);
  await placeAutomatically(editionId, [placementId]);
  await stale(editionId);
}

export async function removeAdvert(editionId: number, placementId: number): Promise<void> {
  await requireDraft(editionId);
  await appExecute("DELETE FROM mg_edition_adverts WHERE id = ? AND edition_id = ?", [placementId, editionId]);
  await stale(editionId);
}

/**
 * Adverts whose article was left out, moved to another edition or deleted are placed again.
 * Returns how many that were. Called after the article list is saved and before a PDF is made.
 */
export async function repairAdverts(editionId: number): Promise<number> {
  const orphans = await appQuery<{ id: number }>(
    `SELECT p.id FROM mg_edition_adverts p LEFT JOIN mg_edition_articles a ON a.id = p.article_id AND a.edition_id = p.edition_id AND a.included = 1
      WHERE p.edition_id = ? AND a.id IS NULL`,
    [editionId],
  );
  if (orphans.length === 0) return 0;
  await placeAutomatically(editionId, orphans.map((row) => row.id), "Its article is no longer in the magazine, so it was placed again. ");
  return orphans.length;
}

export type PrintAdvert = { placementId: number; articleId: number; size: AdvertSize; advertiser: string; file: string };

/** What the renderer prints: every placed advert whose picture is on the server. Problems are added to `notes`. */
export async function printableAdverts(editionId: number, notes: string[]): Promise<PrintAdvert[]> {
  const list: PrintAdvert[] = [];
  for (const placement of await editionAdverts(editionId)) {
    const name = placement.advertiser || `advert ${placement.advertId}`;
    if (placement.articleId === null) {
      notes.push(`The advert of ${name} has no place in the magazine and is not printed.`);
      continue;
    }
    const file = advertFile(placement.advertId, "print");
    const there = await fs.access(file).then(
      () => true,
      () => false,
    );
    if (!there) {
      notes.push(`The picture of the advert of ${name} is missing on the server, so it is not printed. Upload the advert again.`);
      continue;
    }
    list.push({ placementId: placement.id, articleId: placement.articleId, size: placement.size, advertiser: name, file });
  }
  return list;
}
