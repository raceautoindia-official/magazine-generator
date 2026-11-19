import "server-only";
import fs from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import type { PreparedImage } from "../magazine/images";
import { askClaude, claudeAvailable } from "./claude";

// Before a photo goes on the cover, Claude looks at it once more with the cover
// in mind: where the site's watermark sits (so it can be taken out), and what an
// image model should paint above and below the photo to turn a wide picture
// into a tall cover. The answer is kept next to the cached photo.

const briefSchema = z.object({
  watermarkPresent: z.boolean(),
  watermarkLeft: z.number(),
  watermarkTop: z.number(),
  watermarkRight: z.number(),
  watermarkBottom: z.number(),
  setting: z.string(),
  above: z.string(),
  below: z.string(),
  lighting: z.string(),
  avoid: z.string(),
  roomAbove: z.number(),
  cutAtTop: z.boolean(),
  cutAtBottom: z.boolean(),
});

export type CoverBrief = {
  /** The site's round logo stamped on the photo, as fractions of the picture; null when there is none. */
  watermark: { left: number; top: number; right: number; bottom: number } | null;
  /** Where the photo was taken, in a few words. */
  setting: string;
  /** What should continue above and below the photo. */
  above: string;
  below: string;
  lighting: string;
  /** Things this particular scene must not gain. */
  avoid: string;
  /** Share of the added height that should go above the photo (the rest goes below). */
  roomAbove: number;
  /** The main subject runs off the photo's top or bottom edge, so part of it is missing there. */
  cutAtTop: boolean;
  cutAtBottom: boolean;
};

const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
/** The corner of the photo sent as a close-up, as fractions of the picture: the left 30%, the bottom 40%. */
const CORNER = { width: 0.3, height: 0.4 };

const briefFile = (image: PreparedImage) => image.file.replace(/\.jpg$/, ".brief4.json");

/** Claude's reading of a cover photo, from the cache or by asking once. Null without a key or on failure. */
export async function coverBrief(image: PreparedImage, model: string): Promise<CoverBrief | null> {
  try {
    return JSON.parse(await fs.readFile(briefFile(image), "utf8")) as CoverBrief;
  } catch {
    // not asked yet
  }
  if (!claudeAvailable()) return null;

  try {
    const small = await sharp(image.file).resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const cornerWidth = Math.round(image.width * CORNER.width);
    const cornerHeight = Math.round(image.height * CORNER.height);
    const corner = await sharp(image.file)
      .extract({ left: 0, top: image.height - cornerHeight, width: cornerWidth, height: cornerHeight })
      .resize({ width: 1000, withoutEnlargement: false })
      .jpeg({ quality: 90 })
      .toBuffer();
    const answer = await askClaude({
      model,
      schema: briefSchema,
      effort: "medium",
      maxTokens: 6000,
      images: [
        { mediaType: "image/jpeg", base64: small.toString("base64") },
        { mediaType: "image/jpeg", base64: corner.toString("base64") },
      ],
      system:
        "You are the art director of an automotive trade magazine. A wide photograph is going on a tall A4 cover. " +
        "An image model will paint more scenery above and below the photograph; the photograph itself stays untouched in the middle. " +
        "Your notes are the only guidance that model gets about this scene, so they must describe what is actually visible at the top and bottom edges of this photograph. " +
        "Positions are fractions of the image: x from 0 at the left edge to 1 at the right edge, y from 0 at the top to 1 at the bottom.",
      prompt:
        "The first image is the photograph. The second image is an enlargement of its bottom-left corner only. Return:\n" +
        "- watermarkPresent and the watermark box: the publisher stamps a small round multi-coloured logo (blue, red, green and yellow arcs around a white or dark letter mark) on its photographs, " +
        "most often near the bottom-left corner but sometimes in another corner or elsewhere. Look over the whole photograph for it. " +
        "If you see it, give the tightest box around the whole circle as fractions of the FIRST image (the whole photograph); the enlargement is only there to help you see the usual place clearly. " +
        "If it is not there, set watermarkPresent to false and the four numbers to 0. Do not report the vehicle maker's own badges.\n" +
        "- setting: where the photograph is, in a few words (for example \"studio with grey floor and backdrop\", \"desert at night under a starry sky\", \"city street in daylight\").\n" +
        "- above: one or two sentences saying what should continue upward from the photograph's top edge, named concretely from what touches that edge now " +
        "(the same sky with its colour and clouds, the studio backdrop fading to a darker tone, the upper floors of the building already cut off by the edge).\n" +
        "- below: the same for the bottom edge (the same tarmac with its reflections, the sand with its ripples, the studio floor with the vehicle's soft shadow).\n" +
        "- lighting: one sentence on light direction, colour temperature and mood, so the added areas match.\n" +
        "- avoid: anything this scene must not gain, in one sentence (for example \"no second horizon, no extra vehicles, no repeated dunes\"). Leave empty if nothing specific.\n" +
        "- cutAtTop, cutAtBottom: true only when the main subject itself runs off that edge of the photograph, so that part of it is missing (a truck whose roof is sliced off by the top edge, a vehicle whose wheels are sliced off by the bottom edge). " +
        "False when the whole subject is inside the photograph with background between it and the edge, even a thin strip.\n" +
        "- roomAbove: a number from 0.2 to 0.6: the share of the added height that should go above the photograph. The magazine title and headline are printed over the lower third of the cover, " +
        "so prefer more room below; give more room above only when the subject is cut close to the top edge.",
    });

    const brief: CoverBrief = {
      watermark: answer.watermarkPresent
        ? {
            left: unit(Math.min(answer.watermarkLeft, answer.watermarkRight)),
            right: unit(Math.max(answer.watermarkLeft, answer.watermarkRight)),
            top: unit(Math.min(answer.watermarkTop, answer.watermarkBottom)),
            bottom: unit(Math.max(answer.watermarkTop, answer.watermarkBottom)),
          }
        : null,
      setting: answer.setting.slice(0, 200),
      above: answer.above.slice(0, 500),
      below: answer.below.slice(0, 500),
      lighting: answer.lighting.slice(0, 300),
      avoid: answer.avoid.slice(0, 300),
      roomAbove: Math.min(0.6, Math.max(0.2, Number.isFinite(answer.roomAbove) ? answer.roomAbove : 0.4)),
      cutAtTop: answer.cutAtTop,
      cutAtBottom: answer.cutAtBottom,
    };
    // The stamp is small wherever it sits; a large box is something else.
    const mark = brief.watermark;
    if (mark && (mark.right - mark.left > 0.2 || mark.bottom - mark.top > 0.3 || mark.right <= mark.left || mark.bottom <= mark.top)) {
      brief.watermark = null;
    }
    await fs.writeFile(briefFile(image), JSON.stringify(brief));
    return brief;
  } catch (error) {
    console.error(`cover brief failed: ${image.file}`, error instanceof Error ? error.message : error);
    return null;
  }
}

const checkSchema = z.object({ acceptable: z.boolean(), problems: z.string() });

/**
 * Claude looks at a finished AI-extended cover the way an editor would before
 * printing it. Returns null when it is fine, or what is wrong with it. Without
 * a key, or when the check itself fails, the cover is let through.
 */
export async function coverFlaws(file: string, model: string): Promise<string | null> {
  if (!claudeAvailable()) return null;
  try {
    const small = await sharp(file).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const answer = await askClaude({
      model,
      schema: checkSchema,
      effort: "medium",
      maxTokens: 4000,
      images: [{ mediaType: "image/jpeg", base64: small.toString("base64") }],
      system:
        "You are the picture editor of an automotive trade magazine, checking a cover image before it goes to print. " +
        "The image was made by placing a real photograph in the middle of a tall page and letting an image model paint more scenery above and below it. " +
        "The lower third is deliberately darkened, because the magazine's title is printed there; that darkening is not a fault.",
      prompt:
        "Look for the faults this process produces, and judge as a reader would at normal viewing size:\n" +
        "- a part of the main subject drawn twice: a second roofline, a second set of wheels, a second head or hairline, a repeated load, a ghost outline just above or below the real one;\n" +
        "- a visible horizontal join where the photograph meets the painted area: a line, a step in brightness or colour, edges that do not meet (a pillar, a body panel, a jacket that shifts sideways at the join);\n" +
        "- a subject that has been completed wrongly: a distorted or impossibly shaped vehicle, extra limbs, a body that does not fit the head;\n" +
        "- painted areas that plainly do not belong to the scene, or invented text, logos or extra vehicles.\n" +
        "Set acceptable to false if any of these is noticeable. Small softness or slightly simplified background detail in the painted areas is acceptable. " +
        "In problems, say in one sentence what is wrong and where (empty when acceptable).",
    });
    return answer.acceptable ? null : answer.problems.slice(0, 300) || "the picture has visible faults";
  } catch (error) {
    console.error("cover check failed", error instanceof Error ? error.message : error);
    return null;
  }
}
