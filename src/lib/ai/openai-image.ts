import "server-only";
import fs from "node:fs/promises";
import sharp from "sharp";
import { env } from "../env";
import type { PreparedImage } from "../magazine/images";
import type { CoverBrief } from "./cover-brief";

// Claude reads images but does not make them, so extending a wide photo into a
// tall cover uses OpenAI's image edit endpoint. Only the areas above and below
// the photo are wanted from it: the original photo is laid back over the
// result afterwards, so the vehicle on the cover is always the real one.
//
// The image model does not keep the photo exactly where it was given: it
// repaints the whole picture, a little larger, smaller or shifted. Laying the
// original back at the place it was sent would then leave the model's own copy
// of the vehicle peeking out around it (a second roof line above the real one).
// So the place the model put the photo is measured first, and the original is
// laid exactly over that.

const WIDTH = 1024;
const HEIGHT = 1536;
/** Final cover artwork size (A4 at 150 dpi). */
const OUT_WIDTH = 1240;
const OUT_HEIGHT = 1754;

export function imageAiAvailable(): boolean {
  return Boolean(env().OPENAI_API_KEY);
}

export const aiCoverPath = (image: PreparedImage) => image.file.replace(/\.jpg$/, ".cover-ai2.jpg");

function gradient(width: number, height: number, stops: [number, number][]): Buffer {
  const marks = stops.map(([offset, opacity]) => `<stop offset="${offset}" stop-color="#000" stop-opacity="${opacity}"/>`).join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${marks}</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`,
  );
}

type Placement = { scale: number; dx: number; dy: number; error: number };

/**
 * Where the model put the photo. `sent` is the picture that was sent and
 * `made` the one that came back, both WIDTH x HEIGHT; the photo occupied the
 * rows from bandTop for bandHeight. Returns how much larger the photo is in
 * `made` (scale, about its centre) and how far it moved (in pixels of that
 * size), with the remaining difference between the two as `error` (0 to 255).
 */
async function findPhoto(sent: Buffer, made: Buffer, bandTop: number, bandHeight: number): Promise<Placement> {
  const source = await sharp(sent).extract({ left: 0, top: bandTop, width: WIDTH, height: bandHeight }).toBuffer();

  const search = async (width: number, scales: number[], around: { dx: number; dy: number }, reach: number, stride: number): Promise<Placement> => {
    const factor = width / WIDTH;
    const target = await sharp(made).resize({ width }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const top = Math.round(bandTop * factor);
    const height = Math.round(bandHeight * factor);
    let best: Placement = { scale: 1, dx: 0, dy: 0, error: Infinity };
    for (const scale of scales) {
      const scaledWidth = Math.round(width * scale);
      const scaledHeight = Math.round(height * scale);
      const photo = await sharp(source).resize({ width: scaledWidth, height: scaledHeight, fit: "fill" }).greyscale().raw().toBuffer();
      // Top-left corner of the scaled photo when it is scaled about the centre of where it was sent.
      const baseLeft = Math.round(width / 2 - scaledWidth / 2);
      const baseTop = Math.round(top + height / 2 - scaledHeight / 2);
      // Compare the middle of the photo only: its edges are where the model blends into new scenery.
      const marginX = Math.round(scaledWidth * 0.12);
      const marginY = Math.round(scaledHeight * 0.15);
      for (let dy = around.dy - reach; dy <= around.dy + reach; dy++) {
        for (let dx = around.dx - reach; dx <= around.dx + reach; dx++) {
          let sum = 0;
          let count = 0;
          for (let y = marginY; y < scaledHeight - marginY; y += stride) {
            const ty = baseTop + dy + y;
            if (ty < 0 || ty >= target.info.height) continue;
            for (let x = marginX; x < scaledWidth - marginX; x += stride) {
              const tx = baseLeft + dx + x;
              if (tx < 0 || tx >= width) continue;
              sum += Math.abs(photo[y * scaledWidth + x] - target.data[ty * width + tx]);
              count++;
            }
          }
          if (count < 200) continue;
          const error = sum / count;
          if (error < best.error) best = { scale, dx, dy, error };
        }
      }
    }
    return best;
  };

  // A rough look at a small size, then a close look at a larger size around what the rough look found.
  const coarseWidth = 192;
  const fineWidth = 768;
  const coarse = await search(coarseWidth, [0.9, 0.92, 0.94, 0.96, 0.98, 1, 1.02, 1.04, 1.06, 1.08, 1.1], { dx: 0, dy: 0 }, 14, 2);
  const ratio = fineWidth / coarseWidth;
  const fine = await search(
    fineWidth,
    [-0.01, -0.005, 0, 0.005, 0.01].map((step) => coarse.scale + step),
    { dx: Math.round(coarse.dx * ratio), dy: Math.round(coarse.dy * ratio) },
    5,
    3,
  );
  const toFull = WIDTH / fineWidth;
  return { scale: fine.scale, dx: fine.dx * toFull, dy: fine.dy * toFull, error: fine.error };
}

/**
 * Makes a tall cover from a wide photo by generating scenery above and below
 * it. One paid request to OpenAI per call. Returns the artwork file.
 */
export async function extendCoverPhoto(image: PreparedImage, model: string, subject: string, brief: CoverBrief | null): Promise<string> {
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  // The photo across the full width. Claude says how the added height should be shared; the titles need room below it.
  const bandHeight = Math.min(Math.round((WIDTH * image.height) / image.width), HEIGHT - 320);
  const bandTop = Math.round((HEIGHT - bandHeight) * (brief?.roomAbove ?? 0.42));
  const band = await sharp(image.file).resize({ width: WIDTH, height: bandHeight, fit: "cover" }).toBuffer();

  // What the model sees where new scenery is wanted: only the colours of the photo's own top and bottom
  // edge, smeared out. (A blurred copy of the whole photo there shows it a second, ghostly vehicle to imitate.)
  const edge = Math.max(4, Math.round(bandHeight * 0.03));
  const smear = async (top: number, height: number) =>
    sharp(await sharp(band).extract({ left: 0, top, width: WIDTH, height: edge }).toBuffer())
      .resize({ width: WIDTH, height, fit: "fill" })
      .blur(30)
      .toBuffer();
  const below = HEIGHT - bandTop - bandHeight;
  const input = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: "#808080" } })
    .composite([
      { input: await smear(0, bandTop), left: 0, top: 0 },
      { input: await smear(bandHeight - edge, below), left: 0, top: bandTop + bandHeight },
      { input: band, left: 0, top: bandTop },
    ])
    .png()
    .toBuffer();

  // Mask: opaque over the photo (keep), transparent above and below (generate).
  const keep = await sharp({ create: { width: WIDTH, height: bandHeight - 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
  const mask = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: keep, left: 0, top: bandTop + 8 }])
    .png()
    .toBuffer();

  const form = new FormData();
  form.append("model", model);
  form.append(
    "prompt",
    `This tall image contains a sharp photograph (${subject || "a vehicle"}) across its middle. The smooth, featureless areas above and below it are empty placeholders. ` +
      "Fill the placeholders with a natural, photorealistic continuation of the same scene, so the result reads as one tall photograph taken with a wider lens. " +
      (brief
        ? `The scene: ${brief.setting}. Above the photograph: ${brief.above} Below the photograph: ${brief.below} Lighting: ${brief.lighting} `
        : "Paint more of the sky, ceiling or background above, and more of the ground, road or floor below. ") +
      "Keep the photograph itself exactly as it is: the same size, the same position, every object in it where it is now. " +
      (brief
        ? (brief.cutAtTop
            ? "The main subject is cut off by the photograph's top edge: finish the missing part once, so that it continues straight on from that edge. "
            : "The whole subject is already inside the photograph: above it paint background only, and let no part of the subject appear above the photograph. ") +
          (brief.cutAtBottom
            ? "The main subject is cut off by the photograph's bottom edge: finish the missing part once, so that it continues straight on from that edge. "
            : "Below the photograph paint ground or floor only; no part of the subject may appear below the photograph. ")
        : "Where an object is cut off by the photograph's top or bottom edge, finish it once so that it continues straight on from that edge. ") +
      "Never draw a second copy of the subject, its roof, its load, a head, or any other part of it above or below the photograph. " +
      "Match the photograph's colours, grain, perspective and depth of field, and keep the horizon and vanishing lines continuous across the joins. " +
      "The lower part will carry the magazine's title, so keep it calm and free of busy detail. " +
      "Do not add vehicles, people, text, logos, watermarks or borders." +
      (brief?.avoid ? ` Also: ${brief.avoid}` : ""),
  );
  form.append("image[]", new Blob([new Uint8Array(input)], { type: "image/png" }), "cover.png");
  form.append("mask", new Blob([new Uint8Array(mask)], { type: "image/png" }), "mask.png");
  form.append("size", `${WIDTH}x${HEIGHT}`);
  form.append("quality", "medium");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      // not JSON; the status code is all there is
    }
    throw new Error(`OpenAI returned ${response.status}. ${detail}`.trim());
  }
  const result = (await response.json()) as { data?: { b64_json?: string }[] };
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI returned no image.");
  const made = await sharp(Buffer.from(encoded, "base64")).resize({ width: WIDTH, height: HEIGHT, fit: "fill" }).png().toBuffer();

  // Where did the model put the photo? If it cannot be found (the model changed too much), assume it stayed in place.
  const found = await findPhoto(input, made, bandTop, bandHeight);
  const placed = found.error < 22 ? found : { scale: 1, dx: 0, dy: 0, error: found.error };

  // Lay the real photo exactly over the model's rendering of it, with soft edges.
  const out = OUT_WIDTH / WIDTH;
  const photoWidth = Math.round(WIDTH * placed.scale * out);
  const photoHeight = Math.round(bandHeight * placed.scale * out);
  const photoLeft = Math.round((WIDTH / 2 + placed.dx) * out - photoWidth / 2);
  const photoTop = Math.round((bandTop + bandHeight / 2 + placed.dy) * out - photoHeight / 2);
  // Soft top and bottom always; soft sides only where the photo does not reach the page edge.
  const gapLeft = photoLeft > 2;
  const gapRight = photoLeft + photoWidth < OUT_WIDTH - 2;
  const fade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${photoWidth}" height="${photoHeight}"><defs>` +
      `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.04" stop-color="#fff" stop-opacity="1"/>` +
      `<stop offset="0.96" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="${gapLeft ? 1 : 0}"/><stop offset="0.03" stop-color="#000" stop-opacity="0"/>` +
      `<stop offset="0.97" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${gapRight ? 1 : 0}"/></linearGradient>` +
      `<mask id="m"><rect width="100%" height="100%" fill="#fff"/><rect width="100%" height="100%" fill="url(#h)"/></mask></defs>` +
      `<rect width="${photoWidth}" height="${photoHeight}" fill="url(#v)" mask="url(#m)"/></svg>`,
  );
  const photo = await sharp(image.file)
    .resize({ width: photoWidth, height: photoHeight, fit: "cover" })
    .ensureAlpha()
    .composite([{ input: fade, blend: "dest-in" }])
    .png()
    .toBuffer();
  // Only the part of the photo that is on the page can be laid on it.
  const cutLeft = Math.max(0, -photoLeft);
  const cutTop = Math.max(0, -photoTop);
  const visible = await sharp(photo)
    .extract({
      left: cutLeft,
      top: cutTop,
      width: Math.min(photoWidth - cutLeft, OUT_WIDTH - Math.max(0, photoLeft)),
      height: Math.min(photoHeight - cutTop, OUT_HEIGHT - Math.max(0, photoTop)),
    })
    .toBuffer();

  const file = aiCoverPath(image);
  const generated = await sharp(made).resize({ width: OUT_WIDTH, height: OUT_HEIGHT, fit: "fill" }).toBuffer();
  await sharp(generated)
    .composite([
      { input: visible, left: Math.max(0, photoLeft), top: Math.max(0, photoTop) },
      // Darker at the very top and over the lower part, where the titles are printed.
      { input: gradient(OUT_WIDTH, OUT_HEIGHT, [[0, 0.5], [0.18, 0]]) },
      { input: gradient(OUT_WIDTH, OUT_HEIGHT, [[0.6, 0], [1, 0.85]]) },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(`${file}.new`);
  await fs.rename(`${file}.new`, file);
  console.log(
    `cover extended: photo found at scale ${placed.scale.toFixed(3)}, moved ${placed.dx.toFixed(0)},${placed.dy.toFixed(0)} px (difference ${found.error.toFixed(1)})`,
  );
  return file;
}

export async function hasAiCover(image: PreparedImage): Promise<boolean> {
  return fs.access(aiCoverPath(image)).then(
    () => true,
    () => false,
  );
}

/** Marks a photo whose AI covers were judged faulty, so it is not painted (and paid for) again at every PDF. */
const rejectedPath = (image: PreparedImage) => `${aiCoverPath(image)}.rejected`;

export async function rejectAiCover(image: PreparedImage, why: string): Promise<void> {
  await fs.rm(aiCoverPath(image), { force: true });
  await fs.writeFile(rejectedPath(image), why);
}

/** Why the AI cover of this photo was rejected, or null when it was not. */
export async function aiCoverRejection(image: PreparedImage): Promise<string | null> {
  return fs.readFile(rejectedPath(image), "utf8").catch(() => null);
}

/** Forgets the AI cover of a photo and any rejection, so the next PDF paints a new one. */
export async function removeAiCover(image: PreparedImage): Promise<void> {
  await fs.rm(aiCoverPath(image), { force: true });
  await fs.rm(rejectedPath(image), { force: true });
}
