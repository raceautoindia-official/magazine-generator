// Pure module: where an advert goes when Claude is not asked or cannot answer.

export type MatchArticle = { id: number; title: string; text: string };
export type MatchAdvert = { advertiser: string; keywords: string[] };

/** Words in company names that say nothing about which company it is. */
const GENERIC = new Set([
  "india", "indian", "motors", "motor", "auto", "automotive", "limited", "ltd", "pvt", "private", "group", "company", "corporation", "corp",
  "industries", "international", "global", "the", "and", "for", "with", "new", "vehicles", "vehicle",
]);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !GENERIC.has(word));

const has = (haystack: string, word: string) => new RegExp(`\\b${word.replace(/[^a-z0-9]/g, "")}`, "i").test(haystack);

/**
 * The article that shares most words with the advert: the advertiser's name counts most, and a word in a
 * headline counts more than one in the text. Returns null when nothing is shared.
 */
export function matchByWords(advert: MatchAdvert, articles: MatchArticle[]): { articleId: number; shared: string[] } | null {
  const names = [...new Set(words(advert.advertiser))];
  const topics = [...new Set(advert.keywords.flatMap(words))].filter((word) => !names.includes(word));
  let best: { articleId: number; shared: string[]; score: number } | null = null;
  for (const article of articles) {
    const shared: string[] = [];
    let score = 0;
    for (const [list, inTitle, inText] of [[names, 5, 2], [topics, 2, 1]] as const) {
      for (const word of list) {
        if (has(article.title, word)) score += inTitle;
        else if (has(article.text, word)) score += inText;
        else continue;
        shared.push(word);
      }
    }
    if (score >= 2 && (!best || score > best.score)) best = { articleId: article.id, shared, score };
  }
  return best ? { articleId: best.articleId, shared: best.shared } : null;
}

/**
 * For a full-page advert that relates to no article: the position nearest the middle whose article has no advert
 * yet, so unrelated adverts are spread out instead of piling up behind one article. The middle itself when all are taken.
 */
export function nearMiddle(articleCount: number, taken: (index: number) => boolean): number {
  const middle = middleIndex(articleCount);
  for (let distance = 0; distance < articleCount; distance++) {
    for (const index of [middle + distance, middle - distance]) {
      if (index >= 0 && index < articleCount && !taken(index)) return index;
    }
  }
  return middle;
}

/** Position (0 = first) of the article a double-page advert follows: the one that ends at the middle of the magazine. */
export function middleIndex(articleCount: number): number {
  return Math.max(0, Math.ceil(articleCount / 2) - 1);
}
