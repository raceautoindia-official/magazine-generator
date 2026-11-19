import "server-only";
import { newsQuery } from "./db";
import { monthRange } from "./months";
import { countWords, type PostRecord } from "./selection";

type PostRow = {
  id: number;
  title: string | null;
  created_at: string;
  category_id: number | null;
  category_name: string | null;
  parent_id: number | null;
  parent_name: string | null;
  market: number | null;
  market_name: string | null;
  is_featured: number | null;
  pageviews: number | null;
  keywords: string | null;
  summary: string | null;
  content: string | null;
  image_default: string | null;
  image_big: string | null;
};

const POST_COLUMNS = `p.id, p.title, p.created_at, p.category_id, c.name AS category_name,
       NULLIF(c.parent_id, 0) AS parent_id, pc.name AS parent_name,
       p.market, m.title AS market_name, p.is_featured, p.pageviews,
       p.keywords, p.summary, p.content, p.image_default, p.image_big`;

const POST_JOINS = `FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN post_market m ON m.id = p.market`;

/**
 * A live article. A scheduled post carries its scheduled date in created_at and
 * counts as published once that date has passed, even if the site never cleared
 * its "scheduled" mark (owner's decision, 13 November 2026).
 */
export const PUBLISHED = "p.status = 1 AND p.visibility = 1 AND (p.is_scheduled = 0 OR p.created_at <= NOW())";

async function withTagsAndImages(rows: PostRow[]): Promise<PostRecord[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const marks = ids.map(() => "?").join(",");

  const tagRows = await newsQuery<{ post_id: number; tag: string | null }>(
    `SELECT post_id, tag FROM tags WHERE post_id IN (${marks}) ORDER BY id`,
    ids,
  );
  const imageRows = await newsQuery<{ post_id: number; image_default: string | null; image_big: string | null }>(
    `SELECT post_id, image_default, image_big FROM post_images WHERE post_id IN (${marks}) ORDER BY id`,
    ids,
  );

  const tags = new Map<number, string[]>();
  for (const row of tagRows) {
    const tag = row.tag?.trim();
    if (tag) tags.set(row.post_id, [...(tags.get(row.post_id) ?? []), tag]);
  }
  const images = new Map<number, string[]>();
  for (const row of imageRows) {
    const path = row.image_default || row.image_big;
    if (path) images.set(row.post_id, [...(images.get(row.post_id) ?? []), path]);
  }

  return rows.map((row) => ({
    id: row.id,
    title: (row.title ?? "").trim(),
    createdAt: row.created_at,
    categoryId: row.category_id,
    categoryName: row.category_name,
    parentCategoryId: row.parent_id,
    parentCategoryName: row.parent_name,
    marketId: row.market,
    marketName: row.market_name,
    isFeatured: row.is_featured === 1,
    pageviews: row.pageviews ?? 0,
    words: countWords(row.content ?? ""),
    tags: tags.get(row.id) ?? [],
    keywords: row.keywords ?? "",
    summary: row.summary ?? "",
    image: row.image_default || row.image_big || null,
    extraImages: images.get(row.id) ?? [],
  }));
}

/** Published posts created in the month, oldest first. */
export async function collectPosts(month: string): Promise<PostRecord[]> {
  const [start, end] = monthRange(month);
  const rows = await newsQuery<PostRow>(
    `SELECT ${POST_COLUMNS} ${POST_JOINS}
      WHERE ${PUBLISHED} AND p.created_at >= ? AND p.created_at < ?
      ORDER BY p.created_at, p.id`,
    [start, end],
  );
  return withTagsAndImages(rows);
}

/** Posts by id, whatever their state now (an edition keeps a post that was later unpublished). */
export async function fetchPosts(ids: number[]): Promise<Map<number, PostRecord>> {
  if (ids.length === 0) return new Map();
  const rows = await newsQuery<PostRow>(
    `SELECT ${POST_COLUMNS} ${POST_JOINS} WHERE p.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const posts = await withTagsAndImages(rows);
  return new Map(posts.map((post) => [post.id, post]));
}

/** Stored HTML of each post, read live so the magazine always carries the current text. */
export async function fetchPostContents(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await newsQuery<{ id: number; content: string | null }>(
    `SELECT p.id, p.content FROM posts p WHERE p.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return new Map(rows.map((row) => [row.id, row.content ?? ""]));
}
