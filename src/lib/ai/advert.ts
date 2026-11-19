import "server-only";
import sharp from "sharp";
import { z } from "zod";
import type { Settings } from "../settings-schema";
import { askClaude } from "./claude";

// Claude looks at every uploaded advert once and says what it sells, and later
// chooses the article of an edition that the advert belongs with.

const analysisSchema = z.object({
  advertiser: z.string(),
  product: z.string(),
  summary: z.string(),
  segments: z.array(z.string()),
  keywords: z.array(z.string()),
});

export type AdvertAnalysis = { product: string; segments: string[]; keywords: string[] };
export type AdvertReading = AdvertAnalysis & { advertiser: string; summary: string };

/** One request per advert. Throws when Claude cannot be asked; the caller keeps the advert without a summary. */
export async function analyseAdvert(file: string, settings: Settings): Promise<AdvertReading> {
  const small = await sharp(file).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const editions = settings.verticals.map((vertical) => `- ${vertical.key}: ${vertical.label} (${vertical.coverSubtitle})`).join("\n");
  const answer = await askClaude({
    model: settings.ai.textModel,
    schema: analysisSchema,
    effort: "low",
    maxTokens: 3000,
    images: [{ mediaType: "image/jpeg", base64: small.toString("base64") }],
    system:
      "You work for Race Auto India, an Indian automotive trade publisher that issues a monthly e-magazine per vehicle segment. " +
      "Advertisers send finished adverts as pictures. You describe each one so that the layout software can print it beside the article it relates to.",
    prompt:
      "Describe this advert.\n" +
      "- advertiser: the company or brand that is advertising, as written in the advert. Empty if it cannot be told.\n" +
      "- product: what is being advertised, in a few words (for example \"radial truck tyres\", \"an electric scooter model\", \"a trade fair\").\n" +
      "- summary: two or three plain sentences for an editor who has not seen the advert: who advertises, what is offered, to whom, and any model names, " +
      "dates or offers that are written in it. State only what the advert shows.\n" +
      `- segments: the keys of the magazine editions whose readers it addresses, from this list. Empty when it is not about one segment.\n${editions}\n` +
      "- keywords: up to 12 single words or short names an article about the same subject would contain: brand and model names, the kind of product, the technology.",
  });
  const known = new Set(settings.verticals.map((vertical) => vertical.key));
  return {
    advertiser: answer.advertiser.trim().slice(0, 160),
    product: answer.product.trim().slice(0, 200),
    summary: answer.summary.trim().slice(0, 1500),
    segments: [...new Set(answer.segments.filter((key) => known.has(key)))],
    keywords: [...new Set(answer.keywords.map((word) => word.trim()).filter(Boolean))].slice(0, 12),
  };
}

const choiceSchema = z.object({
  choices: z.array(
    z.object({
      advertId: z.number(),
      articleId: z.number().nullable(),
      alternatives: z.array(z.number()),
      relation: z.enum(["advertiser", "product", "segment", "none"]),
      competitor: z.boolean(),
      reason: z.string(),
    }),
  ),
});

export type AdvertChoice = z.infer<typeof choiceSchema>["choices"][number];

/** One request per edition: for each advert, the article it should be printed with, or null when none relates to it. */
export async function chooseArticles(
  adverts: { advertId: number; size: string; advertiser: string; summary: string; product: string; keywords: string[] }[],
  articles: { articleId: number; headline: string; type: string; section: string; text: string }[],
  edition: string,
  model: string,
): Promise<AdvertChoice[]> {
  const answer = await askClaude({
    model,
    schema: choiceSchema,
    effort: "medium",
    maxTokens: 6000,
    system:
      "You place adverts in a monthly e-magazine of Race Auto India, an Indian automotive trade publisher. " +
      "Every advert is printed with one article: a full page on the page that follows it, a half or quarter page in the lower half of the article's first text page. " +
      "Readers and advertisers both gain when the advert sits with an article on a related subject.",
    prompt:
      `Edition: ${edition}\n\n` +
      `Adverts, one JSON object per line:\n${adverts.map((advert) => JSON.stringify(advert)).join("\n")}\n\n` +
      `Articles of this edition in page order, one JSON object per line (text is the start of the article):\n${articles.map((article) => JSON.stringify(article)).join("\n")}\n\n` +
      "For every advert choose the one article it should be printed with and return:\n" +
      "- advertId, and articleId of the chosen article, or null when no article relates to the advert.\n" +
      "- alternatives: the articleIds of up to three further articles that also relate to the advert, best first; empty when there are none. " +
      "They are used when the chosen article has no room left for the advert.\n" +
      "- relation: \"advertiser\" when the article is about the advertiser itself; \"product\" when it is about the same kind of product, technology or event; " +
      "\"segment\" when it only shares the vehicle segment or market; \"none\" with articleId null when nothing relates.\n" +
      "- competitor: true when the chosen article is mainly about a direct competitor of the advertiser.\n" +
      "- reason: one sentence of at most 30 words for the editor, naming what the advert and the article have in common. Do not repeat the full headline.\n" +
      "Prefer in this order: an article about the advertiser, then one about the same kind of product, then one about the same segment. " +
      "Closeness of subject comes first. Between two articles that are about equally close, take the one that is not mainly about a direct competitor of the advertiser. " +
      "When the only closely related articles are about competitors, still choose the closest one and set competitor to true: the editor is warned and decides. " +
      "Do not fall back to a loosely related article just to avoid a competitor. " +
      "Do not force a match: an advert for something the edition does not cover gets null. Two adverts should not share an article when each has another good choice.",
  });
  return answer.choices;
}
