import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { appExecute, appQuery } from "./db";
import { analyseAdvert, type AdvertAnalysis } from "./ai/advert";
import { claudeAvailable } from "./ai/claude";
import { checkPicture, sizeSpec, type AdvertFit, type AdvertKeep, type AdvertSize } from "./advert-sizes";
import { dataDir } from "./magazine/images";
import { EditError } from "./review";
import { getSettings } from "./settings";

// The advert library: adverts are uploaded once and can then be printed in any edition.

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Refuses pictures so large that opening them would exhaust the server's memory. */
const PIXEL_LIMIT = 150_000_000;

export type Advert = {
  id: number;
  advertiser: string;
  size: AdvertSize;
  fit: AdvertFit;
  keep: AdvertKeep;
  originalName: string;
  width: number;
  height: number;
  link: string | null;
  summary: string;
  analysis: AdvertAnalysis | null;
  summaryBy: "claude" | "person" | null;
  archived: boolean;
  createdBy: string;
  createdAt: string;
  /** Editions it is placed in. */
  uses: number;
};

type AdvertRow = {
  id: number;
  advertiser: string;
  size: AdvertSize;
  fit: AdvertFit;
  keep: AdvertKeep;
  original_name: string;
  width: number;
  height: number;
  link: string | null;
  summary: string | null;
  analysis: unknown;
  summary_by: "claude" | "person" | null;
  archived: number;
  created_by: string;
  created_at: string;
  uses?: number | null;
};

function toAdvert(row: AdvertRow): Advert {
  const raw = typeof row.analysis === "string" ? JSON.parse(row.analysis) : row.analysis;
  const analysis =
    raw && typeof raw === "object"
      ? {
          product: String((raw as AdvertAnalysis).product ?? ""),
          segments: Array.isArray((raw as AdvertAnalysis).segments) ? (raw as AdvertAnalysis).segments.map(String) : [],
          keywords: Array.isArray((raw as AdvertAnalysis).keywords) ? (raw as AdvertAnalysis).keywords.map(String) : [],
        }
      : null;
  return {
    id: row.id,
    advertiser: row.advertiser,
    size: row.size,
    fit: row.fit,
    keep: row.keep,
    originalName: row.original_name,
    width: row.width,
    height: row.height,
    link: row.link,
    summary: row.summary ?? "",
    analysis,
    summaryBy: row.summary_by,
    archived: row.archived === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    uses: Number(row.uses ?? 0),
  };
}

const SELECT = `SELECT a.*, (SELECT COUNT(*) FROM mg_edition_adverts p WHERE p.advert_id = a.id) AS uses FROM mg_adverts a`;

/** Newest first. */
export async function listAdverts(): Promise<Advert[]> {
  return (await appQuery<AdvertRow>(`${SELECT} ORDER BY a.archived, a.id DESC`)).map(toAdvert);
}

export async function getAdvert(id: number): Promise<Advert | null> {
  const rows = await appQuery<AdvertRow>(`${SELECT} WHERE a.id = ?`, [id]);
  return rows[0] ? toAdvert(rows[0]) : null;
}

const folder = (id: number) => dataDir("adverts", String(id));

/** The picture printed on the page, the small one shown in lists, or the file as uploaded. */
export function advertFile(id: number, kind: "print" | "thumb" | "original"): string {
  return path.join(folder(id), kind === "original" ? "original" : `${kind}.jpg`);
}

/** Makes the page picture and the small picture from the uploaded file, for the size and fit chosen. */
async function makePictures(id: number, size: AdvertSize, fit: AdvertFit, keep: AdvertKeep): Promise<void> {
  const spec = sizeSpec(size);
  if (!spec) throw new EditError("Unknown advert size.");
  const [wide, tall] = spec.ideal;
  const original = advertFile(id, "original");
  const flat = await sharp(original, { limitInputPixels: PIXEL_LIMIT }).rotate().flatten({ background: "#ffffff" }).toBuffer({ resolveWithObject: true });
  const { width, height } = flat.info;
  // Never enlarged: a small picture is printed at its own sharpness and stretched by the page.
  const scale = Math.min(1, fit === "crop" ? Math.min(width / wide, height / tall) : Math.max(width / wide, height / tall));
  const target = { width: Math.max(1, Math.round(wide * scale)), height: Math.max(1, Math.round(tall * scale)) };
  const base = sharp(flat.data, { limitInputPixels: PIXEL_LIMIT });
  let resized;
  if (fit === "crop") {
    resized = base.resize({ ...target, fit: "cover", position: keep });
  } else {
    // The border takes the picture's own prevailing colour, so it reads as part of the advert.
    const { dominant } = await sharp(flat.data, { limitInputPixels: PIXEL_LIMIT }).stats();
    resized = base.resize({ ...target, fit: "contain", background: dominant });
  }
  const print = advertFile(id, "print");
  await resized.jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toFile(`${print}.new`);
  await fs.rename(`${print}.new`, print);
  await sharp(print).resize({ width: 480, height: 480, fit: "inside" }).jpeg({ quality: 80 }).toFile(advertFile(id, "thumb"));
}

export type NewAdvert = {
  bytes: Buffer;
  name: string;
  size: AdvertSize;
  fit: AdvertFit;
  keep: AdvertKeep;
  advertiser: string;
  link: string;
  by: string;
};

const cleanLink = (link: string): string | null => {
  const value = link.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href.slice(0, 500) : null;
  } catch {
    return null;
  }
};

/** Has Claude describe the advert and stores the answer. Returns a note when that was not possible. */
export async function describeAdvert(id: number, keepAdvertiser: boolean): Promise<string | null> {
  if (!claudeAvailable()) return "No Claude key is set, so the advert has no description. Write one yourself: it is what places the advert.";
  try {
    const { settings } = await getSettings();
    const reading = await analyseAdvert(advertFile(id, "print"), settings);
    await appExecute(
      `UPDATE mg_adverts SET summary = ?, analysis = ?, summary_by = 'claude', advertiser = IF(? = 1 AND advertiser <> '', advertiser, ?) WHERE id = ?`,
      [
        reading.summary,
        JSON.stringify({ product: reading.product, segments: reading.segments, keywords: reading.keywords }),
        keepAdvertiser ? 1 : 0,
        reading.advertiser,
        id,
      ],
    );
    return null;
  } catch (error) {
    console.error("advert analysis failed", error);
    return `Claude could not describe the advert (${error instanceof Error ? error.message : "unknown error"}). Write a description yourself, or press "Ask Claude again".`;
  }
}

/** Stores an uploaded advert, makes its page picture and has Claude describe it. */
export async function createAdvert(input: NewAdvert): Promise<{ id: number; notes: string[] }> {
  const spec = sizeSpec(input.size);
  if (!spec) throw new EditError("Choose a size for the advert.");
  if (input.bytes.length === 0) throw new EditError("Choose a picture file to upload.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new EditError("The file is larger than 30 MB. Save it as a JPG and upload it again.");

  let width: number;
  let height: number;
  try {
    const info = await sharp(input.bytes, { limitInputPixels: PIXEL_LIMIT }).rotate().toBuffer({ resolveWithObject: true });
    ({ width, height } = info.info);
  } catch {
    throw new EditError("The app cannot read this file as a picture. Upload a JPG, PNG, WebP, TIFF, GIF or SVG; for a PDF, export the page as a picture first.");
  }

  const created = await appExecute(
    `INSERT INTO mg_adverts (advertiser, size, fit, keep, original_name, width, height, link, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.advertiser.trim().slice(0, 160), input.size, input.fit, input.keep, input.name.slice(0, 255), width, height, cleanLink(input.link), input.by],
  );
  const id = created.insertId;
  try {
    await fs.mkdir(folder(id), { recursive: true });
    await fs.writeFile(advertFile(id, "original"), input.bytes);
    await makePictures(id, input.size, input.fit, input.keep);
  } catch (error) {
    await appExecute("DELETE FROM mg_adverts WHERE id = ?", [id]);
    await fs.rm(folder(id), { recursive: true, force: true });
    throw error;
  }
  const notes = checkPicture(spec, width, height, input.fit);
  const note = await describeAdvert(id, true);
  if (note) notes.push(note);
  return { id, notes };
}

export type AdvertEdit = { advertiser: string; summary: string; link: string; size: AdvertSize; fit: AdvertFit; keep: AdvertKeep };

/** Saves what a person changed. The page picture is made again when the size or the fit changed. */
export async function updateAdvert(id: number, edit: AdvertEdit): Promise<void> {
  const advert = await getAdvert(id);
  if (!advert) throw new EditError("This advert no longer exists.");
  const spec = sizeSpec(edit.size);
  if (!spec) throw new EditError("Unknown advert size.");
  if (advert.uses > 0 && edit.size !== advert.size) {
    throw new EditError("This advert is placed in an edition, so its size cannot change. Take it out of the editions first, or upload it again at the new size.");
  }
  const repaint = edit.size !== advert.size || edit.fit !== advert.fit || edit.keep !== advert.keep;
  if (repaint) await makePictures(id, edit.size, edit.fit, edit.keep);
  const summary = edit.summary.trim().slice(0, 1500);
  await appExecute(
    `UPDATE mg_adverts SET advertiser = ?, summary = ?, summary_by = IF(? = 1, 'person', summary_by), link = ?, size = ?, fit = ?, keep = ? WHERE id = ?`,
    [edit.advertiser.trim().slice(0, 160), summary, summary !== advert.summary ? 1 : 0, cleanLink(edit.link), edit.size, edit.fit, edit.keep, id],
  );
  // Drafts that print it show the old picture until their PDF is made again.
  if (repaint) {
    await appExecute(
      `UPDATE mg_editions e JOIN mg_edition_adverts p ON p.edition_id = e.id SET e.pdf_stale = 1 WHERE p.advert_id = ? AND e.status = 'draft'`,
      [id],
    );
  }
}

export async function setArchived(id: number, archived: boolean): Promise<void> {
  await appExecute("UPDATE mg_adverts SET archived = ? WHERE id = ?", [archived ? 1 : 0, id]);
}

/** Only an advert that no edition uses can be deleted; the others are retired instead. */
export async function deleteAdvert(id: number): Promise<void> {
  const advert = await getAdvert(id);
  if (!advert) return;
  if (advert.uses > 0) throw new EditError("This advert is placed in an edition. Disable it instead, or take it out of the editions first.");
  await appExecute("DELETE FROM mg_adverts WHERE id = ?", [id]);
  await fs.rm(folder(id), { recursive: true, force: true });
}
