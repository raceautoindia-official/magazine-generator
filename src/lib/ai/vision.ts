import "server-only";
import sharp from "sharp";
import { z } from "zod";
import { appExecute, appQuery } from "../db";
import { askClaude, claudeAvailable } from "./claude";

// Claude looks at each stored image once and says what it is and where its
// subject sits. The answer drives the crops, the cover choice and logo handling.

const analysisSchema = z.object({
  kind: z.enum(["photo", "logo", "graphic"]),
  subject: z.string(),
  focusX: z.number(),
  focusY: z.number(),
  subjectLeft: z.number(),
  subjectRight: z.number(),
  subjectTop: z.number(),
  subjectBottom: z.number(),
  hasLargeText: z.boolean(),
  coverSuitable: z.boolean(),
  /** none = no person visible; background = small or incidental figures; main = a person or people are what the photo is of. */
  people: z.enum(["none", "background", "main"]),
});

// Photos looked at before `people` was asked for are still usable; they are asked about again only when it matters.
const storedSchema = analysisSchema.partial({ people: true });

export type ImageAnalysis = z.infer<typeof storedSchema>;

/** Photos Claude was actually asked about since the server started (answers from the cache do not count). */
export const visionCounts = { asked: 0 };

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

function tidy(raw: z.infer<typeof analysisSchema>): ImageAnalysis {
  const left = clamp(Math.min(raw.subjectLeft, raw.subjectRight));
  const right = clamp(Math.max(raw.subjectLeft, raw.subjectRight));
  const top = clamp(Math.min(raw.subjectTop, raw.subjectBottom));
  const bottom = clamp(Math.max(raw.subjectTop, raw.subjectBottom));
  return {
    ...raw,
    subject: raw.subject.slice(0, 200),
    focusX: clamp(raw.focusX),
    focusY: clamp(raw.focusY),
    subjectLeft: left,
    subjectRight: right,
    subjectTop: top,
    subjectBottom: bottom,
  };
}

async function stored(sourcePath: string): Promise<ImageAnalysis | null> {
  const rows = await appQuery<{ analysis: unknown }>("SELECT analysis FROM mg_asset_cache WHERE source_path = ?", [sourcePath]);
  const value = rows[0]?.analysis;
  if (!value) return null;
  const parsed = storedSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
  return parsed.success ? parsed.data : null;
}

/**
 * What Claude sees in the image, from the cache or by asking once.
 * Returns null when no key is configured or the request fails; callers then
 * fall back to centred crops.
 */
export async function analyseImage(
  sourcePath: string,
  file: string,
  model: string,
  /** Ask again when the stored answer does not say whether the photo shows people (needed for cover photos). */
  needPeople = false,
): Promise<ImageAnalysis | null> {
  const cached = await stored(sourcePath);
  if (cached && !(needPeople && cached.people === undefined && claudeAvailable())) return cached;
  if (!claudeAvailable()) return null;

  try {
    // A small copy is enough to locate the subject and keeps the request cheap.
    const small = await sharp(file).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    visionCounts.asked++;
    const answer = await askClaude({
      model,
      schema: analysisSchema,
      effort: "low",
      maxTokens: 4000,
      images: [{ mediaType: "image/jpeg", base64: small.toString("base64") }],
      system:
        "You prepare images for the page layout of an automotive trade magazine. The layout software crops each picture to fit a page, " +
        "so it needs to know what the picture shows and where the important part is. Positions are fractions of the image: " +
        "x runs from 0 at the left edge to 1 at the right edge, y from 0 at the top edge to 1 at the bottom edge.",
      prompt:
        "Describe this image for the layout software.\n" +
        "- kind: \"photo\" for a photograph or realistic render of vehicles, machines, products, people or places; " +
        "\"logo\" when the image is essentially a company or brand mark on a plain or transparent background; " +
        "\"graphic\" for a banner, chart, infographic or a picture that is mostly text.\n" +
        "- subject: the main subject in a few words, for example \"red Jeep Compass, front three-quarter view\".\n" +
        "- focusX, focusY: the centre of the main subject. If there are several vehicles, the centre of the most prominent one.\n" +
        "- subjectLeft, subjectRight, subjectTop, subjectBottom: the tightest box containing the whole main subject. " +
        "For a line-up of several vehicles that belong together, the box around all of them.\n" +
        "- hasLargeText: true when lettering that is part of the picture (a slogan, model name, event banner) covers a noticeable area. " +
        "Ignore number plates, small badges and a small corner watermark.\n" +
        "- people: \"main\" when a person or people are what the picture is of (a portrait, an executive, a handshake, a group at an event, a presenter beside a vehicle who takes up much of the frame); " +
        "\"background\" when people are visible but small or incidental (a driver behind the windscreen, distant figures, workers far off); \"none\" when no person is visible.\n" +
        "- coverSuitable: true when the picture would work as the main image of a magazine cover: a clear, attractive vehicle, machine or product as the main subject, " +
        "not a logo or graphic, not dominated by lettering. The cover never shows people: set it to false whenever people is \"main\".",
    });
    const analysis = tidy(answer);
    await appExecute(
      "UPDATE mg_asset_cache SET analysis = ?, analysed_at = NOW(), kind = ?, kind_source = 'ai' WHERE source_path = ?",
      [JSON.stringify(analysis), analysis.kind === "logo" ? "logo" : "photo", sourcePath],
    );
    return analysis;
  } catch (error) {
    if (cached) return cached;
    console.error(`image analysis failed: ${sourcePath}`, error instanceof Error ? error.message : error);
    return null;
  }
}
