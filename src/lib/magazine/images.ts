import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { appExecute } from "../db";
import { env } from "../env";
import { frameArea, framingOfArea, tidyFraming, type Framing } from "../framing";

// Post images are fetched once from the site's public bucket and kept on disk.
// Everything the PDF uses is a JPEG derived from that original.

export type PreparedImage = {
  /** Absolute path of the JPEG used on pages. */
  file: string;
  width: number;
  height: number;
  hasAlpha: boolean;
};

const MAX_BYTES = 40 * 1024 * 1024;
/** A two-page spread at about 150 dpi. Stored images are smaller than this today. */
const MAX_WIDTH = 2480;

/** Counts since the server started; a run reads them before and after to see what it caused. */
export const imageCounts = { downloaded: 0 };

export function dataDir(...parts: string[]): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), env().DATA_DIR, ...parts);
}

/** Bump the prefix when the way originals are prepared changes, so old cache files are not reused. */
const keyOf = (sourcePath: string) => createHash("sha1").update(`v4:${sourcePath}`).digest("hex");

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

/** Only paths the main site itself writes: uploads/..., no traversal, no other hosts. */
function isStoredPath(sourcePath: string): boolean {
  return /^uploads\/[A-Za-z0-9_\-./ ()]+$/.test(sourcePath) && !sourcePath.includes("..");
}

async function fetchOriginal(sourcePath: string): Promise<Buffer> {
  const url = new URL(sourcePath.split("/").map(encodeURIComponent).join("/"), env().S3_PUBLIC_BASE_URL);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error("file too large");
  return buffer;
}

/**
 * Some stored photos carry plain white bands along an edge. Finds them so they
 * can be cut off; a band wider than 12% of the picture is left alone, since
 * that is more likely a white studio background than a border.
 */
async function whiteBands(input: Buffer): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const size = 240;
  const { data } = await sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: size, height: size, fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const isWhiteLine = (at: (i: number) => number) => {
    let dark = 0;
    for (let i = 0; i < size; i++) if (at(i) < 242) dark++;
    return dark <= 2;
  };
  const row = (y: number) => isWhiteLine((x) => data[y * size + x]);
  const column = (x: number) => isWhiteLine((y) => data[y * size + x]);
  const run = (test: (i: number) => boolean) => {
    let n = 0;
    while (n < size / 2 && test(n)) n++;
    return n / size <= 0.12 ? n / size : 0;
  };
  return {
    top: run((i) => row(i)),
    bottom: run((i) => row(size - 1 - i)),
    left: run((i) => column(i)),
    right: run((i) => column(size - 1 - i)),
  };
}

/**
 * Local JPEG for a stored image path, fetched and converted on first use.
 * Returns null (and never throws) when the image cannot be fetched or read,
 * so one broken image does not stop an edition.
 */
export async function prepareImage(sourcePath: string | null): Promise<PreparedImage | null> {
  if (!sourcePath || !isStoredPath(sourcePath)) return null;
  const key = keyOf(sourcePath);
  const file = dataDir("cache", `${key}.jpg`);
  const metaFile = dataDir("cache", `${key}.json`);

  if ((await exists(file)) && (await exists(metaFile))) {
    const meta = JSON.parse(await fs.readFile(metaFile, "utf8")) as Omit<PreparedImage, "file">;
    return { file, ...meta };
  }

  try {
    const original = await fetchOriginal(sourcePath);
    imageCounts.downloaded++;
    const info = await sharp(original).metadata();
    const hasAlpha = Boolean(info.hasAlpha);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const upright = await sharp(original).rotate().flatten({ background: "#ffffff" }).toBuffer({ resolveWithObject: true });
    const bands = await whiteBands(original);
    const left = Math.ceil(bands.left * upright.info.width);
    const top = Math.ceil(bands.top * upright.info.height);
    const output = await sharp(upright.data)
      .extract({
        left,
        top,
        width: upright.info.width - left - Math.ceil(bands.right * upright.info.width),
        height: upright.info.height - top - Math.ceil(bands.bottom * upright.info.height),
      })
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(file);
    const meta = { width: output.width, height: output.height, hasAlpha };
    await fs.writeFile(metaFile, JSON.stringify(meta));
    await appExecute(
      `INSERT INTO mg_asset_cache (source_path, local_path, width, height, has_alpha, fetched_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE local_path = VALUES(local_path), width = VALUES(width), height = VALUES(height),
         has_alpha = VALUES(has_alpha), fetched_at = NOW()`,
      [sourcePath, file, info.width ?? output.width, info.height ?? output.height, hasAlpha ? 1 : 0],
    );
    return { file, ...meta };
  } catch (error) {
    console.error(`image not usable: ${sourcePath}`, error instanceof Error ? error.message : error);
    return null;
  }
}

const JPEG = { quality: 86, mozjpeg: true } as const;

/** A black gradient over the lower part of a picture, drawn into the picture itself. */
function shade(width: number, height: number, from: number, strength: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="${from}" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${strength}"/>` +
      `</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`,
  );
}

/** Where the subject is, as fractions of the picture. Comes from Claude; absent means "use the middle". */
export type Focus = { x: number; y: number; left: number; right: number; top: number; bottom: number };

/**
 * The largest area of the given shape that fits in the picture, placed so the
 * focus point is as near its centre as the picture's edges allow.
 */
function cropAround(image: PreparedImage, aspect: number, focus: Focus | null) {
  const fx = focus?.x ?? 0.5;
  const fy = focus?.y ?? 0.5;
  let width = image.width;
  let height = Math.round(width / aspect);
  if (height > image.height) {
    height = image.height;
    width = Math.round(height * aspect);
  }
  const left = Math.round(Math.min(Math.max(fx * image.width - width / 2, 0), image.width - width));
  const top = Math.round(Math.min(Math.max(fy * image.height - height / 2, 0), image.height - height));
  return { left, top, width, height };
}

/** Part of the file name, so a crop made for one focus point is not reused for another. */
const focusTag = (focus: Focus | null) => (focus ? `.f${Math.round(focus.x * 100)}-${Math.round(focus.y * 100)}` : "");

/** The same for a framing chosen by hand on the Design tab. */
const framingTag = (framing: Framing) => {
  const tidy = tidyFraming(framing);
  return `.m${Math.round(tidy.x * 1000)}-${Math.round(tidy.y * 1000)}-${Math.round(tidy.zoom * 100)}`;
};

/** The automatic crop around the subject, said as a framing: where the Design tab starts from. */
export function autoFraming(image: PreparedImage, aspect: number, focus: Focus | null): Framing {
  return framingOfArea(image.width, image.height, cropAround(image, aspect, focus));
}

/** The part of the picture a frame shows: as framed by hand when given, else around the subject. */
const partOf = (image: PreparedImage, aspect: number, focus: Focus | null, framing?: Framing | null) =>
  framing ? frameArea(image.width, image.height, aspect, framing) : cropAround(image, aspect, focus);

/** Portrait crop for a full-page photo. */
export async function portraitCrop(image: PreparedImage, focus: Focus | null, framing?: Framing | null): Promise<string> {
  const file = image.file.replace(/\.jpg$/, `.portrait${framing ? framingTag(framing) : focusTag(focus)}.jpg`);
  if (!(await exists(file))) {
    await sharp(image.file)
      .extract(partOf(image, 210 / 297, focus, framing))
      .resize({ width: 1240, height: 1754, fit: "fill" })
      .composite([{ input: shade(1240, 1754, 0.8, 0.6) }])
      .jpeg(JPEG)
      .toFile(file);
  }
  return file;
}

/**
 * Picture for an article's opening spread, with the dark gradient the headline
 * sits on already part of it (transparent overlays in a PDF do not display
 * reliably in every viewer).
 * "wide" fills both pages (420 x 297 mm); "narrow" leaves room for the text column (322 x 297 mm).
 */
export async function spreadPhoto(image: PreparedImage, kind: "wide" | "narrow", focus: Focus | null, framing?: Framing | null): Promise<string> {
  const file = image.file.replace(/\.jpg$/, `.spread-${kind}${framing ? framingTag(framing) : focusTag(focus)}.jpg`);
  if (!(await exists(file))) {
    const aspect = (kind === "wide" ? 420 : 322) / 297;
    const area = partOf(image, aspect, focus, framing);
    // Never enlarge: keep the crop's own size, up to 150 dpi.
    const height = Math.min(1754, area.height);
    const width = Math.round(height * aspect);
    await sharp(image.file)
      .extract(area)
      .resize({ width, height, fit: "fill" })
      .composite([{ input: shade(width, height, 0.5, 0.93) }])
      .jpeg(JPEG)
      .toFile(file);
  }
  return file;
}

/**
 * True when a full-page portrait crop can hold the whole subject: the cover
 * can then be a full-bleed photo like the printed editions.
 */
export function fitsPortraitCover(image: PreparedImage, focus: Focus | null): boolean {
  if (!focus) return false;
  const area = cropAround(image, 210 / 297, focus);
  const subjectLeft = focus.left * image.width;
  const subjectRight = focus.right * image.width;
  // A little tolerance: losing a sliver of bumper is fine, losing a wheel is not.
  const slack = area.width * 0.04;
  return subjectLeft >= area.left - slack && subjectRight <= area.left + area.width + slack;
}

/** Full-bleed cover: a portrait crop around the subject, darkened at the top and bottom for the titles. */
export async function coverCrop(image: PreparedImage, focus: Focus): Promise<string> {
  const file = image.file.replace(/\.jpg$/, `.cover-crop${focusTag(focus)}.jpg`);
  if (!(await exists(file))) {
    const width = 1240;
    const height = 1754;
    const topShade = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.2" stop-color="#000" stop-opacity="0"/>` +
        `</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`,
    );
    await sharp(image.file)
      .extract(cropAround(image, 210 / 297, focus))
      .resize({ width, height, fit: "fill" })
      .composite([{ input: topShade }, { input: shade(width, height, 0.55, 0.9) }])
      .jpeg(JPEG)
      .toFile(file);
  }
  return file;
}

/**
 * Cover artwork that keeps the whole photo: placed across the page on a
 * blurred and darkened copy of itself, so nothing of the vehicle is cropped away.
 */
export async function coverArtwork(image: PreparedImage): Promise<string> {
  const file = image.file.replace(/\.jpg$/, ".cover.jpg");
  if (!(await exists(file))) {
    const width = 1240;
    const height = 1754;
    const bandHeight = Math.min(Math.round((width * image.height) / image.width), 900);
    const bandTop = 300;
    const backdrop = await sharp(image.file)
      .resize({ width, height, fit: "cover" })
      .blur(28)
      .modulate({ brightness: 0.5 })
      .toBuffer();
    // Soft top and bottom edges so the photo melts into the backdrop.
    const fade = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandHeight}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.07" stop-color="#fff" stop-opacity="1"/>` +
        `<stop offset="0.93" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
        `</linearGradient></defs><rect width="${width}" height="${bandHeight}" fill="url(#g)"/></svg>`,
    );
    const band = await sharp(image.file)
      .resize({ width, height: bandHeight, fit: "cover" })
      .ensureAlpha()
      .composite([{ input: fade, blend: "dest-in" }])
      .png()
      .toBuffer();
    await sharp(backdrop)
      .composite([
        { input: band, left: 0, top: bandTop },
        { input: shade(width, height, 0.6, 0.7) },
      ])
      .jpeg(JPEG)
      .toFile(file);
  }
  return file;
}

/**
 * A company logo attached to a post, kept as PNG with its transparency and
 * trimmed to the mark itself. Returns null when it cannot be fetched or read.
 */
export async function prepareLogo(sourcePath: string): Promise<string | null> {
  if (!isStoredPath(sourcePath)) return null;
  const file = dataDir("cache", `${keyOf(sourcePath)}.logo.png`);
  if (await exists(file)) return file;
  try {
    const original = await fetchOriginal(sourcePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await sharp(original)
      .rotate()
      .trim()
      .resize({ width: 700, height: 400, fit: "inside", withoutEnlargement: true })
      .png()
      .toFile(file);
    return file;
  } catch (error) {
    console.error(`logo not usable: ${sourcePath}`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Which of the mark's four arc colours a pixel has, or -1: 0 blue, 1 red, 2 yellow, 3 green. */
function arcColour(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 90 || max - min < max * 0.32) return -1;
  let hue: number;
  if (max === r) hue = (((g - b) / (max - min)) % 6) * 60;
  else if (max === g) hue = ((b - r) / (max - min) + 2) * 60;
  else hue = ((r - g) / (max - min) + 4) * 60;
  if (hue < 0) hue += 360;
  if (hue >= 190 && hue <= 240) return 0;
  if (hue >= 340 || hue <= 15) return 1;
  if (hue >= 36 && hue <= 62) return 2;
  if (hue >= 135 && hue <= 180) return 3;
  return -1;
}

/**
 * Finds the site's watermark anywhere in the photo by its design: a ring of
 * four coloured arcs, blue at the top left, red at the top right, yellow at the
 * bottom right, green at the bottom left. Returns its centre and radius in
 * pixels, or null when no such ring is there. This is exact where a position
 * read off the picture by Claude is only approximate.
 */
async function locateWatermark(
  image: PreparedImage,
  expectedRadius: number,
): Promise<{ x: number; y: number; radius: number; strength: number } | null> {
  // The whole photo is searched: the mark is usually at the bottom left, but not always.
  const { width, height } = image;
  const data = await sharp(image.file).removeAlpha().raw().toBuffer();
  const colour = new Int8Array(width * height);
  for (let i = 0; i < width * height; i++) colour[i] = arcColour(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);

  // Points on the ring, each with the colour its quarter should have (y grows downward).
  const ring: { dx: number; dy: number; want: number }[] = [];
  for (let step = 0; step < 32; step++) {
    const angle = ((step + 0.5) / 32) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const want = dy < 0 ? (dx < 0 ? 0 : 1) : dx < 0 ? 3 : 2;
    for (const at of [0.8, 0.92]) ring.push({ dx: dx * at, dy: dy * at, want });
  }

  // One point in the middle of each quarter, tried first so that almost every position is dismissed at once.
  const probes = [
    { dx: -0.61, dy: -0.61, want: 0 },
    { dx: 0.61, dy: -0.61, want: 1 },
    { dx: 0.61, dy: 0.61, want: 2 },
    { dx: -0.61, dy: 0.61, want: 3 },
  ];

  let best: { x: number; y: number; radius: number; score: number; strength: number } | null = null;
  for (const scale of [0.65, 0.75, 0.87, 1, 1.15, 1.3, 1.5]) {
    const radius = expectedRadius * scale;
    const margin = Math.ceil(radius);
    for (let y = margin; y < height - margin; y += 2) {
      for (let x = margin; x < width - margin; x += 2) {
        let quick = 0;
        for (const probe of probes) {
          if (colour[Math.round(y + probe.dy * radius) * width + Math.round(x + probe.dx * radius)] === probe.want) quick++;
        }
        if (quick < 2) continue;
        const hits = [0, 0, 0, 0];
        for (const point of ring) {
          if (colour[Math.round(y + point.dy * radius) * width + Math.round(x + point.dx * radius)] === point.want) hits[point.want]++;
        }
        // Every quarter must show its colour; a red carpet or a lawn alone matches only one of them.
        const weakest = Math.min(...hits);
        if (weakest < 4) continue;
        const score = weakest * 4 + hits[0] + hits[1] + hits[2] + hits[3];
        if (!best || score > best.score) best = { x, y, radius, score, strength: weakest };
      }
    }
  }
  return best;
}

/**
 * Fills the missing pixels of a picture area with pieces of the area around
 * them. Working inward from the rim, the patch that is best known is completed
 * with the unknown part of the most similar patch found nearby, so textures
 * (sand, tarmac, grass) and lines (kerbs, road markings, shadows) run on across
 * the hole instead of dissolving into a blur.
 */
function fillFromSurroundings(pixels: Uint8Array, width: number, height: number, missing: Uint8Array): void {
  const half = 4; // 9 x 9 patches
  const at = (x: number, y: number) => y * width + x;

  // Places a patch may be copied from: wholly inside the area and wholly known. Every second position is enough.
  const sources: number[] = [];
  for (let y = half; y < height - half; y += 2) {
    for (let x = half; x < width - half; x += 2) {
      let whole = true;
      for (let dy = -half; dy <= half && whole; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          if (missing[at(x + dx, y + dy)]) {
            whole = false;
            break;
          }
        }
      }
      if (whole) sources.push(at(x, y));
    }
  }
  if (sources.length === 0) return;

  let left = 0;
  for (let i = 0; i < missing.length; i++) left += missing[i];

  while (left > 0) {
    // The missing pixel with the most known neighbours goes first; among equals, the one on the strongest edge,
    // so that lines are carried across before the plain areas beside them close in.
    let target = -1;
    let bestPriority = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!missing[at(x, y)]) continue;
        let knownAround = 0;
        let low = 255;
        let high = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || missing[at(nx, ny)]) continue;
            knownAround++;
            const green = pixels[at(nx, ny) * 3 + 1];
            if (green < low) low = green;
            if (green > high) high = green;
          }
        }
        if (knownAround === 0) continue;
        const priority = knownAround + (high - low) / 12;
        if (priority > bestPriority) {
          bestPriority = priority;
          target = at(x, y);
        }
      }
    }
    if (target < 0) break;
    const tx = target % width;
    const ty = (target - tx) / width;

    // The known pixels of the target patch, to compare candidates on.
    const offsets: number[] = [];
    const values: number[] = [];
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= width || y >= height || missing[at(x, y)]) continue;
        offsets.push(dy * width + dx);
        const from = at(x, y) * 3;
        values.push(pixels[from], pixels[from + 1], pixels[from + 2]);
      }
    }

    let chosen = sources[0];
    let least = Infinity;
    for (const source of sources) {
      let sum = 0;
      for (let k = 0; k < offsets.length && sum < least; k++) {
        const from = (source + offsets[k]) * 3;
        const a = pixels[from] - values[k * 3];
        const b = pixels[from + 1] - values[k * 3 + 1];
        const c = pixels[from + 2] - values[k * 3 + 2];
        sum += a * a + b * b + c * c;
      }
      if (sum < least) {
        least = sum;
        chosen = source;
      }
    }

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= width || y >= height || !missing[at(x, y)]) continue;
        const to = at(x, y) * 3;
        const from = (chosen + dy * width + dx) * 3;
        pixels[to] = pixels[from];
        pixels[to + 1] = pixels[from + 1];
        pixels[to + 2] = pixels[from + 2];
        missing[at(x, y)] = 0;
        left--;
      }
    }
  }
}

/**
 * A copy of the photo without the site's round watermark. The disc the mark
 * covers is rebuilt from pieces of the picture around it (see fillFromSurroundings),
 * so the spot keeps the sharpness and texture of its surroundings.
 *
 * The mark is looked for over the whole photo by its design. `seen` is where
 * Claude saw it (fractions of the picture), or null when Claude saw none or was
 * not asked: with it a weaker match is accepted, and it is the fallback position
 * when the design is not recognised. Returns the photo unchanged when there is no mark.
 */
export async function withoutWatermark(
  image: PreparedImage,
  seen: { left: number; top: number; right: number; bottom: number } | null,
): Promise<PreparedImage> {
  const file = image.file.replace(/\.jpg$/, ".clean6.jpg");
  if (await exists(file)) return { ...image, file };

  try {
    // Claude's box says a mark is there and about how big; its exact place is found from the mark's own colours.
    // Only if that fails is the box itself used, with a wider margin because it is approximate.
    // The mark is about 5% of the photo's width across; Claude's box, when there is one, gives a closer size.
    const guess = seen ? Math.max((seen.right - seen.left) * image.width, (seen.bottom - seen.top) * image.height) / 2 : image.width * 0.026;
    const match = await locateWatermark(image, guess);
    // Out of 16 points per quarter of the ring: a few are enough when Claude also saw the mark, more when judging alone.
    const found = match && match.strength >= (seen ? 4 : 7) ? match : null;
    if (!found && !seen) return image;
    const centreX = found ? found.x : ((seen!.left + seen!.right) / 2) * image.width;
    const centreY = found ? found.y : ((seen!.top + seen!.bottom) / 2) * image.height;
    const radius = found ? found.radius * 1.22 : guess * 1.35;
    if (radius > image.width * 0.15) return image;
    // The disc to fill, with enough of the picture around it to find matching pieces in.
    const around = Math.round(radius * 2.4);
    const left = Math.max(0, Math.floor(centreX - radius - around));
    const top = Math.max(0, Math.floor(centreY - radius - around));
    const right = Math.min(image.width, Math.ceil(centreX + radius + around));
    const bottom = Math.min(image.height, Math.ceil(centreY + radius + around));
    const width = right - left;
    const height = bottom - top;

    const pixels = new Uint8Array(await sharp(image.file).extract({ left, top, width, height }).removeAlpha().raw().toBuffer());
    const missing = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.hypot(x + left - centreX, y + top - centreY) <= radius) missing[y * width + x] = 1;
      }
    }
    const disc = Uint8Array.from(missing);
    fillFromSurroundings(pixels, width, height, missing);

    // The pieces are laid in whole; a very light softening inside the disc only takes the edge off their joins.
    const filled = Buffer.from(pixels);
    const softened = await sharp(filled, { raw: { width, height, channels: 3 } }).blur(0.6).raw().toBuffer();
    for (let i = 0; i < disc.length; i++) {
      if (!disc[i]) continue;
      for (let c = 0; c < 3; c++) filled[i * 3 + c] = Math.round(filled[i * 3 + c] * 0.5 + softened[i * 3 + c] * 0.5);
    }
    await sharp(image.file)
      .composite([{ input: filled, raw: { width, height, channels: 3 }, left, top }])
      .jpeg(JPEG)
      .toFile(file);
    return { ...image, file };
  } catch (error) {
    console.error(`watermark not removed: ${image.file}`, error instanceof Error ? error.message : error);
    return image;
  }
}
