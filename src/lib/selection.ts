import { OTHER_TYPE, type Settings, type Vertical } from "./settings-schema";

// Pure module (no database, no server-only): decides which posts go into an
// edition and in what order. Everything it uses comes from settings.

export type PostRecord = {
  id: number;
  title: string;
  createdAt: string;
  categoryId: number | null;
  categoryName: string | null;
  parentCategoryId: number | null;
  parentCategoryName: string | null;
  marketId: number | null;
  marketName: string | null;
  isFeatured: boolean;
  pageviews: number;
  words: number;
  tags: string[];
  keywords: string;
  summary: string;
  /** Main image path as stored in posts.image_default. */
  image: string | null;
  /** Paths from post_images, in upload order. */
  extraImages: string[];
};

export type Section = "national" | "international";
/** Key of one of the types in settings.types. */
export type ArticleType = string;
/** How a post reached an edition. "manual" is set later, in review. */
export type AssignedBy = "category" | "keyword" | "ai" | "general" | "manual";

/** Editions Claude chose for shared posts that matched no edition's words, by post id. */
export type AiPlacements = Map<number, { verticalKeys: string[]; reason: string }>;

/** Type Claude chose for a post after reading its full text, by post id. */
export type AiTypes = Map<number, { type: ArticleType; reason: string }>;

export type Candidate = {
  post: PostRecord;
  section: Section;
  type: ArticleType;
  assignedBy: AssignedBy;
  /** Short human-readable reason, shown in review. */
  note: string;
  included: boolean;
  position: number;
};

export type EditionWarning = { level: "warning" | "note"; message: string };
export type EditionPlan = { candidates: Candidate[]; warnings: EditionWarning[] };

const inList = (list: number[], id: number | null) => id !== null && list.includes(id);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match, case-insensitive, that also accepts a plural ("tractor" finds "tractors"). */
export function containsKeyword(text: string, keyword: string): boolean {
  const pattern = `(?<![a-z0-9])${escapeRegExp(keyword.trim()).replace(/\s+/g, "[\\s-]+")}(?:s|es)?(?![a-z0-9])`;
  return new RegExp(pattern, "i").test(text);
}

/** Tags are often written as one word ("ElectricSUV", "TwoWheelers"); split them back into words. */
export function tagText(tags: string[]): string {
  return tags.map((tag) => tag.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")).join(" | ");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(html: string): number {
  const text = stripHtml(html);
  return text ? text.split(" ").length : 0;
}

export function sectionOf(post: PostRecord, settings: Settings): Section {
  return post.marketId === settings.indiaMarketId ? "national" : "international";
}

/**
 * The words of the headline decide first; a post whose headline says nothing
 * gets the type of its category, if a type claims that category. (The site's
 * business categories are used loosely, so the headline is the better guide.)
 * When several types fit, the one later in settings.types wins.
 */
export function typeOf(post: PostRecord, settings: Settings): ArticleType {
  const rules = settings.types.filter((type) => type.key !== OTHER_TYPE).reverse();
  const byCategory = rules.find(
    (rule) =>
      inList(rule.categoryIds, post.categoryId) ||
      inList(rule.parentCategoryIds, post.parentCategoryId) ||
      inList(rule.parentCategoryIds, post.categoryId),
  );
  const byHeadline = rules.find((rule) => rule.keywords.some((word) => containsKeyword(post.title, word)));
  return byHeadline?.key ?? byCategory?.key ?? OTHER_TYPE;
}

export function isDirect(post: PostRecord, vertical: Vertical): boolean {
  return (
    inList(vertical.categoryIds, post.categoryId) ||
    inList(vertical.parentCategoryIds, post.parentCategoryId) ||
    inList(vertical.parentCategoryIds, post.categoryId)
  );
}

/** True for posts whose category is printed in every edition when the post names no edition in particular. */
export function goesToEveryEdition(post: PostRecord, settings: Settings): boolean {
  const ids = settings.sharedPool.everyEditionCategoryIds;
  return inList(ids, post.categoryId) || inList(ids, post.parentCategoryId);
}

export function isShared(post: PostRecord, settings: Settings): boolean {
  if (settings.verticals.some((vertical) => isDirect(post, vertical))) return false;
  return (
    inList(settings.sharedPool.categoryIds, post.categoryId) ||
    inList(settings.sharedPool.parentCategoryIds, post.parentCategoryId) ||
    inList(settings.sharedPool.parentCategoryIds, post.categoryId)
  );
}

// A word in the headline counts most, then a tag, then the summary or keyword field.
const WEIGHT = { title: 3, tags: 2, other: 1 };
/** Below this a match is too weak to place a post (a single word in the summary only). */
const MINIMUM_SCORE = 2;

export function keywordScore(post: PostRecord, vertical: Vertical): { score: number; matched: string[] } {
  const tags = tagText(post.tags);
  const other = `${post.keywords} | ${post.summary}`;
  let score = 0;
  const matched: string[] = [];
  for (const word of vertical.keywords) {
    let hit = 0;
    if (containsKeyword(post.title, word)) hit += WEIGHT.title;
    if (containsKeyword(tags, word)) hit += WEIGHT.tags;
    if (containsKeyword(other, word)) hit += WEIGHT.other;
    if (hit > 0) {
      score += hit;
      matched.push(word);
    }
  }
  return { score, matched };
}

export type Assignment = { verticalKey: string; assignedBy: AssignedBy; note: string };

/**
 * Editions a post can appear in.
 * - Its category belongs to an edition: that edition only.
 * - Shared category (Tech, Auto Comp, Business): every edition whose words it matches clearly.
 * - Shared category with no match: the editions Claude chose for it, when there is such an answer;
 *   otherwise offered to every edition as a general post.
 * - Any other category: none.
 */
export function assignmentsOf(post: PostRecord, settings: Settings, ai?: AiPlacements): Assignment[] {
  const direct = settings.verticals.filter((vertical) => isDirect(post, vertical));
  if (direct.length > 0) {
    const where = post.categoryName ?? "its category";
    return direct.map((vertical) => ({ verticalKey: vertical.key, assignedBy: "category", note: `Category: ${where}` }));
  }
  if (!isShared(post, settings)) return [];

  const scored = settings.verticals
    .map((vertical) => ({ vertical, ...keywordScore(post, vertical) }))
    .filter((entry) => entry.score >= MINIMUM_SCORE);
  if (scored.length === 0) {
    const placed = ai?.get(post.id);
    const chosen = settings.verticals.filter((vertical) => placed?.verticalKeys.includes(vertical.key));
    if (placed && chosen.length > 0) {
      return chosen.map((vertical) => ({
        verticalKey: vertical.key,
        assignedBy: "ai",
        note: `Placed by Claude: ${placed.reason || "no reason given"}`,
      }));
    }
    // A post from a category such as Insights (guest articles, industry outlooks) that is about the industry as a
    // whole belongs in every edition as a full article, not as filler.
    if (goesToEveryEdition(post, settings)) {
      return settings.verticals.map((vertical) => ({
        verticalKey: vertical.key,
        assignedBy: "category",
        note: `${post.categoryName ?? "Its category"}: about the industry as a whole`,
      }));
    }
    return settings.verticals.map((vertical) => ({
      verticalKey: vertical.key,
      assignedBy: "general",
      note: "Shared category, no edition words found",
    }));
  }
  const top = Math.max(...scored.map((entry) => entry.score));
  return scored
    .filter((entry) => entry.score * 2 >= top)
    .map((entry) => ({
      verticalKey: entry.vertical.key,
      assignedBy: "keyword",
      note: `Words: ${entry.matched.join(", ")}`,
    }));
}

const TIER: Record<AssignedBy, number> = { manual: 0, category: 0, keyword: 1, ai: 1, general: 2 };

/** Which post is kept when there are more than fit: surer placement, then featured, then most read. */
function byPriority(a: Candidate, b: Candidate): number {
  return (
    TIER[a.assignedBy] - TIER[b.assignedBy] ||
    Number(b.post.isFeatured) - Number(a.post.isFeatured) ||
    b.post.pageviews - a.post.pageviews ||
    a.post.id - b.post.id
  );
}

/**
 * Order on the page: configured section order, then type order. Inside a group,
 * posts placed by category come before those placed by words, so the opening
 * article (the cover candidate) is always squarely about the edition's subject.
 */
export function compareForLayout(settings: Settings): (a: Candidate, b: Candidate) => number {
  const { sections, types } = settings.ordering;
  // A type that is no longer in the settings goes last.
  const rank = (type: ArticleType) => (types.includes(type) ? types.indexOf(type) : types.length);
  return (a, b) =>
    sections.indexOf(a.section) - sections.indexOf(b.section) ||
    rank(a.type) - rank(b.type) ||
    TIER[a.assignedBy] - TIER[b.assignedBy] ||
    Number(b.post.isFeatured) - Number(a.post.isFeatured) ||
    b.post.pageviews - a.post.pageviews ||
    a.post.id - b.post.id;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Plans one edition from a month's posts. Returns every post that could go in
 * it: the chosen ones first, in page order, then the ones left out.
 */
export function planEdition(
  posts: PostRecord[],
  verticalKey: string,
  settings: Settings,
  ai?: AiPlacements,
  aiTypes?: AiTypes,
): EditionPlan {
  const { minimum, recommended, minimumWords, maximumWords } = settings.counts;
  const warnings: EditionWarning[] = [];

  let tooShort = 0;
  // Very long posts (reports, white papers) are offered but only go in when a person includes them.
  const tooLong = new Set<number>();
  const pool: Candidate[] = [];
  for (const post of posts) {
    const assignment = assignmentsOf(post, settings, ai).find((entry) => entry.verticalKey === verticalKey);
    if (!assignment) continue;
    if (post.words < minimumWords) {
      tooShort++;
      continue;
    }
    pool.push({
      post,
      section: sectionOf(post, settings),
      // Claude's reading of the whole article, when there is one; otherwise the headline's words.
      type: aiTypes?.get(post.id)?.type ?? typeOf(post, settings),
      assignedBy: assignment.assignedBy,
      note: post.words > maximumWords ? `${assignment.note} · ${post.words} words, over the limit of ${maximumWords}` : assignment.note,
      included: false,
      position: 0,
    });
  }

  for (const candidate of pool) if (candidate.post.words > maximumWords) tooLong.add(candidate.post.id);
  const usable = pool.filter((candidate) => !tooLong.has(candidate.post.id));

  // Posts that belong here by category or words fill up to the recommended count.
  const specific = usable.filter((candidate) => candidate.assignedBy !== "general").sort(byPriority);
  const general = usable.filter((candidate) => candidate.assignedBy === "general").sort(byPriority);
  for (const candidate of specific.slice(0, recommended)) candidate.included = true;

  // General posts are only used to reach the minimum.
  const chosenSpecific = Math.min(specific.length, recommended);
  const fill = Math.max(0, Math.min(general.length, minimum - chosenSpecific));
  for (const candidate of general.slice(0, fill)) candidate.included = true;

  const order = compareForLayout(settings);
  const included = pool.filter((candidate) => candidate.included).sort(order);
  const leftOut = pool.filter((candidate) => !candidate.included).sort(order);
  const candidates = [...included, ...leftOut];
  candidates.forEach((candidate, index) => (candidate.position = index + 1));

  if (included.length < minimum) {
    warnings.push({
      level: "warning",
      message: `Only ${plural(included.length, "post")} available; the minimum is ${minimum}.`,
    });
  } else if (included.length < recommended) {
    warnings.push({
      level: "note",
      message: `${plural(included.length, "post")} included; the recommended count is ${recommended}.`,
    });
  }
  if (fill > 0) {
    warnings.push({
      level: "note",
      message: `${plural(fill, "general post")} (shared category, not specific to this edition) added to reach the minimum.`,
    });
  }
  if (specific.length > recommended) {
    warnings.push({
      level: "note",
      message: `${plural(specific.length - recommended, "more post")} for this edition left out by the recommended count of ${recommended}.`,
    });
  }
  if (tooShort > 0) {
    warnings.push({
      level: "note",
      message: `${plural(tooShort, "post")} shorter than ${minimumWords} words not offered.`,
    });
  }
  if (tooLong.size > 0) {
    warnings.push({
      level: "note",
      message: `${plural(tooLong.size, "post")} longer than ${maximumWords} words left out; include by hand if wanted.`,
    });
  }
  const withoutImage = included.filter((candidate) => !candidate.post.image).length;
  if (withoutImage > 0) {
    warnings.push({ level: "warning", message: `${plural(withoutImage, "included post")} without an image.` });
  }

  return { candidates, warnings };
}
