"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser, requireUser } from "@/lib/auth";
import { saveForeword, writeForeword } from "@/lib/ai/foreword";
import { getEdition } from "@/lib/editions";
import { setManualKind } from "@/lib/magazine/extras";
import { chooseCover, keepFinishedCopy, renderEdition, setCoverStyle } from "@/lib/magazine/render";
import { EditError, finishEdition, isDraft, markStale, reopenEdition, saveArticles } from "@/lib/review";
import { recordTiming, Timer } from "@/lib/timing";
import { activeJob, startJob } from "@/lib/jobs";
import type { Started } from "../../use-job";
import { addAdvert, addAdverts, moveAdvert, placeAgain, removeAdvert, repairAdverts, suggestAdverts } from "@/lib/advert-placement";

export type PdfState = { error?: string; pages?: number; notes?: string[]; at?: number; /** How long the run took. */ ms?: number } | undefined;

const LOCKED = "This edition is finished. Reopen it to change it.";
/**
 * Said in place of a jump to the login page by the actions that carry something the person typed or arranged:
 * the page, and with it their unsaved work, stays where it is.
 */
const SIGNED_OUT = "You have been signed out (a session lasts 12 hours). Your changes are still on this page: sign in again in another tab, come back here and press the button again.";

function editionId(formData: FormData): number | null {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Message for the page: the person's own mistakes as written, anything else in general terms. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof EditError ? error.message : fallback;
}

/** One PDF is made per edition at a time; everything that prints an edition shares this key. */
const pdfKey = (id: number) => `pdf:${id}`;
const BUSY = "A PDF is being created for this edition right now. Wait for it to finish, then try again.";

/**
 * Starts creating the PDF in the background and answers at once. The page follows the job; the PDF is made
 * whether or not the page stays open, and pressing the button again joins the run already going.
 */
export async function createPdf(formData: FormData): Promise<Started> {
  const user = await requireUser();
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };
  if (!(await isDraft(id))) return { error: LOCKED };
  const { id: job } = await startJob({ kind: "pdf", key: pdfKey(id), label: "Creating the PDF", editionId: id, by: user.email }, async () => {
    const result = await renderEdition(id, { label: "PDF created", by: user.email });
    return { pages: result.pageCount, notes: result.notes, ms: result.ms };
  });
  return { job };
}

export type ForewordState = { error?: string; text?: string; saved?: boolean; ms?: number } | undefined;

/** Runs only when the person presses the button; each press is one request to Claude. */
export async function askForForeword(_previous: ForewordState, formData: FormData): Promise<ForewordState> {
  const user = await requireUser();
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };
  if (!(await isDraft(id))) return { error: LOCKED };
  try {
    const timer = new Timer();
    let text: string;
    try {
      text = await timer.step("Claude reads the articles and writes the foreword", "claude", () => writeForeword(id));
    } finally {
      await recordTiming(id, "foreword", "Foreword written by Claude", timer, user.email);
    }
    await markStale(id);
    revalidatePath(`/editions/${id}`);
    return { text, ms: timer.total() };
  } catch (error) {
    console.error("foreword failed", error);
    return { error: `The foreword could not be written. ${error instanceof Error ? error.message : ""}`.trim() };
  }
}

export async function storeForeword(_previous: ForewordState, formData: FormData): Promise<ForewordState> {
  if (!(await currentUser())) return { error: SIGNED_OUT };
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };
  if (!(await isDraft(id))) return { error: LOCKED };
  const text = String(formData.get("foreword") ?? "");
  if (text.length > 6000) return { error: "The foreword is too long for the page. Keep it under about 350 words." };
  await saveForeword(id, text);
  await markStale(id);
  revalidatePath(`/editions/${id}`);
  return { saved: true };
}

/**
 * How the cover photo is fitted to the tall page: extended by AI, on a blurred
 * background, or cropped. "repaint" asks for a new AI picture (one paid request).
 */
export async function changeCoverStyle(formData: FormData): Promise<Started> {
  const user = await requireUser();
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };
  if (!(await isDraft(id))) return { error: LOCKED };
  const style = z.enum(["ai", "blur", "crop"]).safeParse(formData.get("style"));
  if (!style.success) return { error: "Unknown cover style." };
  // Not joined to a run already going: that run would print the cover as it was before this change.
  if ((await activeJob(pdfKey(id))) !== null) return { error: BUSY };
  const repaint = Boolean(formData.get("repaint"));
  const { id: job } = await startJob({ kind: "pdf", key: pdfKey(id), label: repaint ? "Painting a new cover" : "Changing the cover style", editionId: id, by: user.email }, async () => {
    const result = await setCoverStyle(id, style.data, repaint, user.email);
    return { pages: result.pageCount, notes: result.notes, ms: result.ms };
  });
  return { job };
}

/** Cover photo and headline chosen by hand; the PDF is created again with them. */
export async function pickCover(formData: FormData): Promise<Started> {
  const user = await requireUser();
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };
  if (!(await isDraft(id))) return { error: LOCKED };

  const raw = String(formData.get("postId") ?? "");
  const postId = raw === "" ? null : Number(raw);
  const edition = await getEdition(id);
  if (postId !== null && !edition?.articles.some((article) => article.included && article.postId === postId)) {
    return { error: "That article is not in this edition." };
  }
  if ((await activeJob(pdfKey(id))) !== null) return { error: BUSY };
  const line = String(formData.get("line") ?? "");
  const { id: job } = await startJob({ kind: "pdf", key: pdfKey(id), label: "Changing the cover", editionId: id, by: user.email }, async () => {
    const result = await chooseCover(id, postId, line, user.email);
    return { pages: result.pageCount, notes: result.notes, ms: result.ms };
  });
  return { job };
}

const changesSchema = z
  .array(
    z.object({
      id: z.number().int().positive(),
      included: z.boolean(),
      section: z.enum(["national", "international"]),
      type: z.string().min(1).max(40),
      transfer: z.object({ mode: z.enum(["move", "copy"]), vertical: z.string().min(1).max(40) }).optional(),
    }),
  )
  .max(1000);

export type ArticlesState = { error?: string; saved?: number; sent?: string[] } | undefined;

/** Saves the order, the included posts, sections and types, and sends posts to other editions. */
export async function storeArticles(_previous: ArticlesState, formData: FormData): Promise<ArticlesState> {
  if (!(await currentUser())) return { error: SIGNED_OUT };
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };

  let changes: z.infer<typeof changesSchema>;
  try {
    changes = changesSchema.parse(JSON.parse(String(formData.get("payload") ?? "")));
  } catch {
    return { error: "The changes could not be read. Reload the page and try again." };
  }
  try {
    const sent = await saveArticles(id, changes);
    // An advert whose article was just left out or sent away is given a new place.
    try {
      const moved = await repairAdverts(id);
      if (moved > 0) sent.push(`${moved} advert(s) were placed again because their article is no longer in the magazine.`);
    } catch (error) {
      console.error("placing adverts again failed", error);
    }
    revalidatePath("/", "layout");
    return { saved: Date.now(), sent };
  } catch (error) {
    if (!(error instanceof EditError)) console.error("saving articles failed", error);
    return { error: messageOf(error, "The changes could not be saved. The server log has the details.") };
  }
}

export type SimpleState = { error?: string; done?: number; /** How many adverts were added. */ added?: number } | undefined;

/** How one extra image of a post is used: logo, photo, not at all, or decided automatically. */
export async function setExtraImage(_previous: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireUser();
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };
  if (!(await isDraft(id))) return { error: LOCKED };

  const path = String(formData.get("path") ?? "");
  const kind = z.enum(["auto", "logo", "photo", "none"]).safeParse(formData.get("kind"));
  const edition = await getEdition(id);
  // Only images that belong to a post of this edition can be changed from its page.
  if (!kind.success || !edition?.articles.some((article) => article.post?.extraImages.includes(path))) {
    return { error: "Unknown image." };
  }
  await setManualKind(path, kind.data === "auto" ? null : kind.data);
  await markStale(id);
  revalidatePath(`/editions/${id}`);
  return { done: Date.now() };
}

export async function setFinished(_previous: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireUser();
  const id = editionId(formData);
  if (!id) return { error: "Unknown edition." };
  try {
    if (formData.get("reopen")) await reopenEdition(id);
    else {
      await finishEdition(id);
      // What was published is kept apart from the working files.
      await keepFinishedCopy(id);
    }
    revalidatePath("/", "layout");
    return { done: Date.now() };
  } catch (error) {
    if (!(error instanceof EditError)) console.error("status change failed", error);
    return { error: messageOf(error, "The status could not be changed. The server log has the details.") };
  }
}

/** Adds an advert from the library to this edition; its place is chosen straight away. */
export async function addAdvertToEdition(_previous: SimpleState, formData: FormData): Promise<SimpleState> {
  const user = await requireUser();
  const id = editionId(formData);
  const advertId = Number(formData.get("advertId"));
  if (!id || !Number.isInteger(advertId) || advertId <= 0) return { error: "Choose an advert to add." };
  try {
    const timer = new Timer();
    try {
      await timer.step("Advert: choosing the article it is printed with", "claude", () => addAdvert(id, advertId, user.email));
    } finally {
      await recordTiming(id, "advert", "Advert added and placed", timer, user.email);
    }
    revalidatePath("/", "layout");
    return { done: Date.now() };
  } catch (error) {
    if (!(error instanceof EditError)) console.error("adding an advert failed", error);
    return { error: messageOf(error, "The advert could not be added. The server log has the details.") };
  }
}

/** Moves an advert to another article, has its place chosen again, or takes it out of the edition. */
export async function changeAdvert(id: number, placementId: number, change: { move: number } | "again" | "remove"): Promise<SimpleState> {
  const user = await requireUser();
  const numbers = [id, placementId, typeof change === "object" ? change.move : 1];
  if (numbers.some((value) => !Number.isInteger(value) || value <= 0)) return { error: "Unknown advert." };
  try {
    if (change === "remove") await removeAdvert(id, placementId);
    else if (change === "again") {
      const timer = new Timer();
      try {
        await timer.step("Advert: choosing its place again", "claude", () => placeAgain(id, placementId));
      } finally {
        await recordTiming(id, "advert", "Advert placed again", timer, user.email);
      }
    } else if (typeof change === "object") await moveAdvert(id, placementId, change.move);
    else return { error: "Unknown change." };
    revalidatePath(`/editions/${id}`);
    return { done: Date.now() };
  } catch (error) {
    if (!(error instanceof EditError)) console.error("changing an advert failed", error);
    return { error: messageOf(error, "The advert could not be changed. The server log has the details.") };
  }
}

/** Adds every ticked advert to this edition; their places are chosen together, in one request to Claude. */
export async function addAdvertsToEdition(_previous: SimpleState, formData: FormData): Promise<SimpleState> {
  const user = await requireUser();
  const id = editionId(formData);
  const advertIds = formData.getAll("advertId").map(Number);
  if (!id) return { error: "Unknown edition." };
  if (advertIds.length === 0 || advertIds.length > 200 || advertIds.some((value) => !Number.isInteger(value) || value <= 0)) return { error: "Tick at least one advert to add." };
  try {
    const timer = new Timer();
    let added = 0;
    try {
      added = await timer.step("Adverts: choosing the article each is printed with", "claude", () => addAdverts(id, advertIds, user.email), (count) => `${count} advert(s), placed together`);
    } finally {
      await recordTiming(id, "advert", "Adverts added and placed", timer, user.email);
    }
    revalidatePath("/", "layout");
    return { done: Date.now(), added };
  } catch (error) {
    if (!(error instanceof EditError)) console.error("adding adverts failed", error);
    return { error: messageOf(error, "The adverts could not be added. The server log has the details.") };
  }
}

/** Has Claude read this edition's articles and suggest which library adverts belong in it, and with which article. */
export async function suggestAdvertsFor(id: number): Promise<SimpleState> {
  const user = await requireUser();
  if (!Number.isInteger(id) || id <= 0) return { error: "Unknown edition." };
  if (!(await isDraft(id))) return { error: LOCKED };
  try {
    const timer = new Timer();
    let looked = 0;
    try {
      looked = await timer.step("Adverts: Claude reads the articles and suggests adverts for them", "claude", () => suggestAdverts(id), (count) => `${count} advert(s) looked at`);
    } finally {
      if (looked > 0) await recordTiming(id, "advert", "Adverts suggested for this edition", timer, user.email);
    }
    revalidatePath(`/editions/${id}`);
    return { done: Date.now(), added: looked };
  } catch (error) {
    console.error("suggesting adverts failed", error);
    return { error: `Claude could not suggest adverts (${error instanceof Error ? error.message : "unknown error"}). You can still tick adverts yourself.` };
  }
}
