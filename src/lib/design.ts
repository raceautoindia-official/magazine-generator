import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import { appExecute, appQuery } from "./db";
import { tidyFraming, type Framing } from "./framing";
import { dataDir, type PreparedImage } from "./magazine/images";
import { toParagraphs } from "./magazine/sanitize";
import { EditError } from "./review";

// What a person changed on the Design tab: how pictures sit in their frames, which picture a frame shows,
// and an article's headline and text. All of it belongs to one edition. The website is never written to.

export const SLOTS = ["spread", "photo", "tail", "band"] as const;
export type Slot = (typeof SLOTS)[number];
export const frameKey = (articleId: number, slot: Slot) => `a${articleId}:${slot}`;

/** "cover", or an article row id and the slot of one of its pictures. */
export function parseFrame(frame: string): { articleId: number; slot: Slot } | "cover" | null {
  if (frame === "cover") return "cover";
  const match = /^a(\d{1,10}):(spread|photo|tail|band)$/.exec(frame);
  return match ? { articleId: Number(match[1]), slot: match[2] as Slot } : null;
}

export type FrameEdit = { source: string | null; framing: Framing | null };

export async function frameEdits(editionId: number): Promise<Map<string, FrameEdit>> {
  const rows = await appQuery<{ frame: string; source: string | null; x: number | null; y: number | null; zoom: number | null }>(
    "SELECT frame, source, x, y, zoom FROM mg_edition_frames WHERE edition_id = ?",
    [editionId],
  );
  return new Map(
    rows.map((row) => [
      row.frame,
      { source: row.source, framing: row.x !== null && row.y !== null && row.zoom !== null ? tidyFraming({ x: Number(row.x), y: Number(row.y), zoom: Number(row.zoom) }) : null },
    ]),
  );
}

const stale = (editionId: number) => appExecute("UPDATE mg_editions SET pdf_stale = 1 WHERE id = ?", [editionId]);

async function requireDraft(editionId: number): Promise<void> {
  const rows = await appQuery<{ status: string }>("SELECT status FROM mg_editions WHERE id = ?", [editionId]);
  if (!rows[0]) throw new EditError("This edition no longer exists.");
  if (rows[0].status !== "draft") throw new EditError("This edition is finished. Reopen it to change it.");
}

/** Stores where a picture sits in its frame. The picture chosen for the frame is left as it is. */
export async function saveFraming(editionId: number, frame: string, framing: Framing, by: string): Promise<void> {
  await requireDraft(editionId);
  if (!parseFrame(frame)) throw new EditError("Unknown picture.");
  const tidy = tidyFraming(framing);
  await appExecute(
    `INSERT INTO mg_edition_frames (edition_id, frame, x, y, zoom, updated_by) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE x = VALUES(x), y = VALUES(y), zoom = VALUES(zoom), updated_by = VALUES(updated_by)`,
    [editionId, frame, tidy.x, tidy.y, tidy.zoom, by],
  );
  await stale(editionId);
}

/** Stores which picture a frame shows (null = the automatic one). A new picture starts with automatic framing. */
export async function saveSource(editionId: number, frame: string, source: string | null, by: string): Promise<void> {
  await requireDraft(editionId);
  const parsed = parseFrame(frame);
  if (!parsed || parsed === "cover") throw new EditError("The picture of this frame cannot be changed here.");
  if (source !== null && !/^(post:uploads\/[A-Za-z0-9_\-./ ()]+|upload:\d{1,10})$/.test(source)) throw new EditError("Unknown picture.");
  await appExecute(
    `INSERT INTO mg_edition_frames (edition_id, frame, source, x, y, zoom, updated_by) VALUES (?, ?, ?, NULL, NULL, NULL, ?)
     ON DUPLICATE KEY UPDATE source = VALUES(source), x = NULL, y = NULL, zoom = NULL, updated_by = VALUES(updated_by)`,
    [editionId, frame, source, by],
  );
  await stale(editionId);
}

/** Back to the automatic picture and framing. */
export async function resetFrame(editionId: number, frame: string): Promise<void> {
  await requireDraft(editionId);
  await appExecute("DELETE FROM mg_edition_frames WHERE edition_id = ? AND frame = ?", [editionId, frame]);
  await stale(editionId);
}

// ---------------------------------------------------------------- uploaded pictures

const uploadDir = (editionId: number) => dataDir("editions", String(editionId), "uploads");
export const uploadFile = (editionId: number, id: number) => path.join(uploadDir(editionId), `${id}.jpg`);

export type Upload = { id: number; name: string; width: number; height: number };

export async function listUploads(editionId: number): Promise<Upload[]> {
  const rows = await appQuery<{ id: number; original_name: string; width: number; height: number }>(
    "SELECT id, original_name, width, height FROM mg_edition_uploads WHERE edition_id = ? ORDER BY id DESC",
    [editionId],
  );
  return rows.map((row) => ({ id: row.id, name: row.original_name, width: row.width, height: row.height }));
}

/** Stores a picture uploaded for this edition as a JPEG of at most 2480 px width, like the posts' own pictures. */
export async function addUpload(editionId: number, bytes: Buffer, name: string, by: string): Promise<Upload> {
  await requireDraft(editionId);
  if (bytes.length === 0) throw new EditError("Choose a picture file to upload.");
  if (bytes.length > 30 * 1024 * 1024) throw new EditError("The file is larger than 30 MB. Save it as a JPG and upload it again.");
  let output: { data: Buffer; info: OutputInfo };
  try {
    output = await sharp(bytes, { limitInputPixels: 150_000_000 })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: 2480, withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new EditError("The app cannot read this file as a picture. Upload a JPG, PNG or WebP.");
  }
  const row = await appExecute("INSERT INTO mg_edition_uploads (edition_id, original_name, width, height, created_by) VALUES (?, ?, ?, ?, ?)", [
    editionId,
    name.slice(0, 255),
    output.info.width,
    output.info.height,
    by,
  ]);
  await fs.mkdir(uploadDir(editionId), { recursive: true });
  await fs.writeFile(uploadFile(editionId, row.insertId), output.data);
  return { id: row.insertId, name, width: output.info.width, height: output.info.height };
}

/** The uploaded picture a frame's source names, ready for the page, or null when it is gone. */
export async function uploadedImage(editionId: number, id: number): Promise<PreparedImage | null> {
  const rows = await appQuery<{ width: number; height: number }>("SELECT width, height FROM mg_edition_uploads WHERE id = ? AND edition_id = ?", [id, editionId]);
  const file = uploadFile(editionId, id);
  const there = await fs.access(file).then(
    () => true,
    () => false,
  );
  return rows[0] && there ? { file, width: rows[0].width, height: rows[0].height, hasAlpha: false } : null;
}

// ---------------------------------------------------------------- text

export type TextEdit = { title: string | null; paragraphs: string[] | null; baseHash: string };

export const textHash = (title: string, paragraphs: string[]) => createHash("sha1").update(JSON.stringify([title.trim(), paragraphs])).digest("hex");

export async function textEdits(editionId: number): Promise<Map<number, TextEdit>> {
  const rows = await appQuery<{ article_id: number; title: string | null; paragraphs: unknown; base_hash: string }>(
    "SELECT article_id, title, paragraphs, base_hash FROM mg_edition_texts WHERE edition_id = ?",
    [editionId],
  );
  return new Map(
    rows.map((row) => {
      const raw = typeof row.paragraphs === "string" ? JSON.parse(row.paragraphs) : row.paragraphs;
      return [row.article_id, { title: row.title, paragraphs: Array.isArray(raw) ? raw.map(String) : null, baseHash: row.base_hash }];
    }),
  );
}

/**
 * Text typed or pasted into the editor, reduced to what the page prints: paragraphs with bold, italic,
 * superscript and subscript only. Empty paragraphs are dropped.
 */
export function cleanParagraphs(paragraphs: string[]): string[] {
  return paragraphs.flatMap((paragraph) => toParagraphs(`<p>${paragraph}</p>`));
}

export const cleanTitle = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, 500);

/**
 * Stores an article's headline and text for this edition. What equals the website's own is stored as "not
 * changed", so an article edited back to the original follows the website again.
 */
export async function saveText(
  editionId: number,
  articleId: number,
  text: { title: string; paragraphs: string[] },
  original: { title: string; paragraphs: string[] },
  by: string,
): Promise<void> {
  await requireDraft(editionId);
  const rows = await appQuery<{ id: number }>("SELECT id FROM mg_edition_articles WHERE id = ? AND edition_id = ?", [articleId, editionId]);
  if (!rows[0]) throw new EditError("This article is no longer in this edition. Reload the page.");
  const title = cleanTitle(text.title);
  const paragraphs = cleanParagraphs(text.paragraphs);
  if (!title) throw new EditError("The headline cannot be empty.");
  if (paragraphs.length === 0) throw new EditError("The article needs some text. To leave the article out, use the Articles tab.");
  const sameTitle = title === cleanTitle(original.title);
  const sameText = JSON.stringify(paragraphs) === JSON.stringify(original.paragraphs);
  if (sameTitle && sameText) {
    await appExecute("DELETE FROM mg_edition_texts WHERE article_id = ?", [articleId]);
  } else {
    await appExecute(
      `INSERT INTO mg_edition_texts (article_id, edition_id, title, paragraphs, base_hash, updated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), paragraphs = VALUES(paragraphs), base_hash = VALUES(base_hash), updated_by = VALUES(updated_by)`,
      [articleId, editionId, sameTitle ? null : title, sameText ? null : JSON.stringify(paragraphs), textHash(original.title, original.paragraphs), by],
    );
  }
  await stale(editionId);
}

export async function resetText(editionId: number, articleId: number): Promise<void> {
  await requireDraft(editionId);
  await appExecute("DELETE FROM mg_edition_texts WHERE article_id = ? AND edition_id = ?", [articleId, editionId]);
  await stale(editionId);
}
