"use server";

import { revalidatePath } from "next/cache";
import { currentUser, requireUser } from "@/lib/auth";
import { addUpload, listUploads, parseFrame, resetFrame, resetText, saveFraming, saveSource, saveText, uploadFile } from "@/lib/design";
import { getEdition } from "@/lib/editions";
import type { Framing } from "@/lib/framing";
import { prepareImage } from "@/lib/magazine/images";
import { articleText, fileAddress, recordDesignWait, type ArticleText } from "@/lib/magazine/render";
import { EditError } from "@/lib/review";
import type { TimingStep } from "@/lib/timing";

export type DesignResult = { error?: string; done?: number };

const fail = (error: unknown, fallback: string): DesignResult => {
  if (!(error instanceof EditError)) console.error(fallback, error);
  return { error: error instanceof EditError ? error.message : `${fallback} The server log has the details.` };
};

const whole = (value: number) => Number.isInteger(value) && value > 0;

/**
 * How long the pages took to appear on the Design tab, told by the tab once they are there, so that the wait is
 * part of the edition's processing time. Answers whether it was long enough to be recorded.
 */
export async function reportDesignWait(editionId: number, waited: number, steps: unknown): Promise<boolean> {
  const user = await currentUser();
  if (!user || !whole(editionId) || !Number.isFinite(waited) || waited < 0 || waited > 15 * 60_000 || !Array.isArray(steps) || steps.length > 40) return false;
  const tidy = steps.flatMap<TimingStep>((step: { name?: unknown; ms?: unknown; by?: unknown; detail?: unknown }) =>
    typeof step?.name === "string" && typeof step.ms === "number" && step.ms >= 0 && step.ms <= waited + 1000 && (step.by === "app" || step.by === "claude" || step.by === "openai" || step.by === "site")
      ? [{ name: step.name.slice(0, 160), ms: Math.round(step.ms), by: step.by, ...(typeof step.detail === "string" ? { detail: step.detail.slice(0, 200) } : {}) }]
      : [],
  );
  try {
    return await recordDesignWait(editionId, Math.round(waited), tidy, user.email);
  } catch (error) {
    console.error("design wait not recorded", error);
    return false;
  }
}

/** Where a picture sits in its frame: saved when the person lets go of it. */
export async function saveFrameAt(editionId: number, frame: string, framing: Framing): Promise<DesignResult> {
  const user = await requireUser();
  if (!whole(editionId)) return { error: "Unknown edition." };
  try {
    await saveFraming(editionId, String(frame), { x: Number(framing.x), y: Number(framing.y), zoom: Number(framing.zoom) }, user.email);
    revalidatePath(`/editions/${editionId}`);
    return { done: Date.now() };
  } catch (error) {
    return fail(error, "The picture's position could not be saved.");
  }
}

/** Another picture for a frame; null goes back to the automatic one. */
export async function chooseFramePicture(editionId: number, frame: string, source: string | null): Promise<DesignResult> {
  const user = await requireUser();
  if (!whole(editionId)) return { error: "Unknown edition." };
  try {
    await saveSource(editionId, String(frame), source === null ? null : String(source), user.email);
    revalidatePath(`/editions/${editionId}`);
    return { done: Date.now() };
  } catch (error) {
    return fail(error, "The picture could not be changed.");
  }
}

/** Back to the automatic picture and position. */
export async function resetFrameAt(editionId: number, frame: string): Promise<DesignResult> {
  await requireUser();
  if (!whole(editionId)) return { error: "Unknown edition." };
  try {
    await resetFrame(editionId, String(frame));
    revalidatePath(`/editions/${editionId}`);
    return { done: Date.now() };
  } catch (error) {
    return fail(error, "The picture could not be reset.");
  }
}

export type PictureChoice = { source: string; url: string; label: string };

/** The pictures a frame can show: the post's own, and those uploaded for this edition. */
export async function frameChoices(editionId: number, frame: string): Promise<{ error?: string; choices?: PictureChoice[] }> {
  await requireUser();
  const parsed = parseFrame(String(frame));
  if (!whole(editionId) || !parsed || parsed === "cover") return { error: "The picture of this frame cannot be changed here." };
  const edition = await getEdition(editionId);
  const post = edition?.articles.find((article) => article.id === parsed.articleId)?.post;
  if (!post) return { error: "This article is no longer in this edition. Reload the page." };
  const choices: PictureChoice[] = [];
  const stored = [...new Set([post.image, ...post.extraImages].filter((entry): entry is string => Boolean(entry)))];
  for (const [index, sourcePath] of stored.entries()) {
    const image = await prepareImage(sourcePath);
    if (image) choices.push({ source: `post:${sourcePath}`, url: fileAddress(image.file), label: index === 0 && sourcePath === post.image ? "The post's main picture" : `Picture ${index + 1} of the post` });
  }
  for (const upload of await listUploads(editionId)) {
    choices.push({ source: `upload:${upload.id}`, url: fileAddress(uploadFile(editionId, upload.id)), label: `Uploaded: ${upload.name}` });
  }
  return { choices };
}

/** Stores a picture from the person's computer for this edition and puts it in the frame. */
export async function uploadPicture(formData: FormData): Promise<DesignResult> {
  const user = await requireUser();
  const editionId = Number(formData.get("id"));
  const frame = String(formData.get("frame") ?? "");
  const file = formData.get("file");
  if (!whole(editionId) || !(file instanceof File) || file.size === 0) return { error: "Choose a picture file to upload." };
  try {
    const upload = await addUpload(editionId, Buffer.from(await file.arrayBuffer()), file.name, user.email);
    await saveSource(editionId, frame, `upload:${upload.id}`, user.email);
    revalidatePath(`/editions/${editionId}`);
    return { done: Date.now() };
  } catch (error) {
    return fail(error, "The picture could not be uploaded.");
  }
}

/** An article's headline and text as this edition prints them, for the editor. */
export async function loadArticleText(editionId: number, articleId: number): Promise<{ error?: string; text?: ArticleText }> {
  await requireUser();
  if (!whole(editionId) || !whole(articleId)) return { error: "Unknown article." };
  const text = await articleText(editionId, articleId);
  return text ? { text } : { error: "This article is no longer in this edition, or its post was deleted from the website." };
}

/** Saves the headline and text for this edition only. The post on the website is not touched. */
export async function saveArticleText(editionId: number, articleId: number, title: string, paragraphs: string[]): Promise<DesignResult> {
  // The editor stays open with what was typed when the session has ended.
  const user = await currentUser();
  if (!user) return { error: "You have been signed out (a session lasts 12 hours). Your text is still here: sign in again in another tab, come back and press Apply again." };
  if (!whole(editionId) || !whole(articleId) || !Array.isArray(paragraphs) || paragraphs.length > 400) return { error: "Unknown article." };
  try {
    const current = await articleText(editionId, articleId);
    if (!current) return { error: "This article is no longer in this edition. Reload the page." };
    await saveText(editionId, articleId, { title: String(title), paragraphs: paragraphs.map(String) }, current.original, user.email);
    revalidatePath(`/editions/${editionId}`);
    return { done: Date.now() };
  } catch (error) {
    return fail(error, "The text could not be saved.");
  }
}

/** Back to the post's own headline and text. */
export async function resetArticleText(editionId: number, articleId: number): Promise<DesignResult> {
  await requireUser();
  if (!whole(editionId) || !whole(articleId)) return { error: "Unknown article." };
  try {
    await resetText(editionId, articleId);
    revalidatePath(`/editions/${editionId}`);
    return { done: Date.now() };
  } catch (error) {
    return fail(error, "The text could not be reset.");
  }
}
