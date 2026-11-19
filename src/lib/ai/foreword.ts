import "server-only";
import { z } from "zod";
import { appExecute, appQuery } from "../db";
import { getEdition } from "../editions";
import { stripHtml } from "../selection";
import { monthLabel } from "../months";
import { fetchPostContents } from "../posts";
import { getSettings } from "../settings";
import { askClaude } from "./claude";

const forewordSchema = z.object({ paragraphs: z.array(z.string()) });

export async function getForeword(editionId: number): Promise<string> {
  const rows = await appQuery<{ foreword: string | null }>(
    "SELECT foreword FROM mg_edition_front_matter WHERE edition_id = ?",
    [editionId],
  );
  return rows[0]?.foreword ?? "";
}

/** Paragraphs are separated by a blank line. An empty text brings back the automatic summary. */
export async function saveForeword(editionId: number, text: string): Promise<void> {
  const clean = text.replace(/\r\n/g, "\n").trim();
  await appExecute(
    `INSERT INTO mg_edition_front_matter (edition_id, foreword) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE foreword = VALUES(foreword)`,
    [editionId, clean || null],
  );
}

/** Asks Claude for a foreword built only from this edition's own articles, and stores it. */
export async function writeForeword(editionId: number): Promise<string> {
  const edition = await getEdition(editionId);
  if (!edition) throw new Error("Edition not found.");
  const included = edition.articles.filter((article) => article.included && article.post);
  if (included.length === 0) throw new Error("This edition has no articles to write about.");

  const { settings } = await getSettings();
  const label = settings.verticals.find((vertical) => vertical.key === edition.vertical)?.label ?? edition.vertical;
  const contents = await fetchPostContents(included.map((article) => article.postId));

  const articles = included
    .map((article, index) => {
      const text = stripHtml(contents.get(article.postId) ?? "").slice(0, 1400);
      return [
        `Article ${index + 1} (${article.section === "national" ? "India" : "International"}, ${article.type})`,
        `Headline: ${article.post!.title}`,
        `Text: ${text}`,
      ].join("\n");
    })
    .join("\n\n");

  const answer = await askClaude({
    model: settings.ai.textModel,
    schema: forewordSchema,
    effort: "medium",
    maxTokens: 8000,
    system:
      "You write the foreword of Race Auto India's monthly e-magazine. It appears on page 3 under the heading \"Foreword\" and the salutation \"Dear Readers\", " +
      "and is signed by the publication's director. Readers are people working in the Indian automotive industry: manufacturers, suppliers, dealers, fleet operators and analysts. " +
      "The foreword tells them what the month looked like in this vehicle segment, drawing the threads between the articles that follow, in the measured voice of a trade publication.",
    prompt:
      `Edition: ${label}, covering news published in ${monthLabel(edition.contentMonth)}.\n\n` +
      `These are the articles in the edition, in page order:\n\n${articles}\n\n` +
      "Write the foreword as three or four paragraphs, 170 to 230 words in total.\n" +
      "- Every fact, figure, company and product you mention must come from the articles above. The foreword is printed next to them, " +
      "so a number or claim that is not in them would be a visible error. Do not add market statistics, forecasts or background from your own knowledge.\n" +
      "- Group the articles into the two or three themes they actually share (for example new launches, electrification, expansion, leadership changes) " +
      "instead of listing them one by one. Name the most significant developments; you need not mention every article.\n" +
      "- Open with the month and the segment, not with a greeting; \"Dear Readers\" is already printed above the text.\n" +
      "- Close with one forward-looking sentence that follows from the articles, without predicting figures.\n" +
      "- Plain prose only: no headings, bullet points, quotation of headlines, or signature.",
  });

  const text = answer.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean).join("\n\n");
  if (!text) throw new Error("Claude returned an empty foreword.");
  await saveForeword(editionId, text);
  return text;
}
