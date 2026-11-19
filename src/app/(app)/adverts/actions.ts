"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createAdvert, deleteAdvert, describeAdvert, MAX_UPLOAD_BYTES, setArchived, updateAdvert } from "@/lib/adverts";
import { EditError } from "@/lib/review";

export type AdvertState = { error?: string; done?: number; notes?: string[]; id?: number } | undefined;

const size = z.enum(["double", "full", "half", "quarter"]);
const fit = z.enum(["crop", "whole"]);
const keep = z.enum(["centre", "top", "bottom", "left", "right"]);

const idOf = (formData: FormData): number | null => {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
};

const failure = (error: unknown, fallback: string): AdvertState => {
  if (!(error instanceof EditError)) console.error(fallback, error);
  return { error: error instanceof EditError ? error.message : `${fallback} The server log has the details.` };
};

/** Stores a new advert and has Claude describe it (one request). */
export async function uploadAdvert(_previous: AdvertState, formData: FormData): Promise<AdvertState> {
  const user = await requireUser();
  const file = formData.get("file");
  const chosen = { size: size.safeParse(formData.get("size")), fit: fit.safeParse(formData.get("fit")), keep: keep.safeParse(formData.get("keep") ?? "centre") };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a picture file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "The file is larger than 30 MB. Save it as a JPG and upload it again." };
  if (!chosen.size.success || !chosen.fit.success || !chosen.keep.success) return { error: "Choose a size for the advert." };
  try {
    const result = await createAdvert({
      bytes: Buffer.from(await file.arrayBuffer()),
      name: file.name,
      size: chosen.size.data,
      fit: chosen.fit.data,
      keep: chosen.keep.data,
      advertiser: String(formData.get("advertiser") ?? ""),
      link: String(formData.get("link") ?? ""),
      by: user.email,
    });
    revalidatePath("/", "layout");
    return { done: Date.now(), notes: result.notes, id: result.id };
  } catch (error) {
    return failure(error, "The advert could not be stored.");
  }
}

export async function saveAdvert(_previous: AdvertState, formData: FormData): Promise<AdvertState> {
  await requireUser();
  const id = idOf(formData);
  const chosen = { size: size.safeParse(formData.get("size")), fit: fit.safeParse(formData.get("fit")), keep: keep.safeParse(formData.get("keep") ?? "centre") };
  if (!id || !chosen.size.success || !chosen.fit.success || !chosen.keep.success) return { error: "Unknown advert." };
  try {
    await updateAdvert(id, {
      advertiser: String(formData.get("advertiser") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      link: String(formData.get("link") ?? ""),
      size: chosen.size.data,
      fit: chosen.fit.data,
      keep: chosen.keep.data,
    });
    revalidatePath("/", "layout");
    return { done: Date.now() };
  } catch (error) {
    return failure(error, "The advert could not be saved.");
  }
}

/** Asks Claude for a new description; what a person wrote is replaced. */
export async function describeAgain(_previous: AdvertState, formData: FormData): Promise<AdvertState> {
  await requireUser();
  const id = idOf(formData);
  if (!id) return { error: "Unknown advert." };
  const note = await describeAdvert(id, true);
  revalidatePath("/", "layout");
  return note ? { error: note } : { done: Date.now() };
}

export async function retireAdvert(_previous: AdvertState, formData: FormData): Promise<AdvertState> {
  await requireUser();
  const id = idOf(formData);
  if (!id) return { error: "Unknown advert." };
  await setArchived(id, formData.get("archived") === "1");
  revalidatePath("/", "layout");
  return { done: Date.now() };
}

export async function removeAdvertFromLibrary(_previous: AdvertState, formData: FormData): Promise<AdvertState> {
  await requireUser();
  const id = idOf(formData);
  if (!id) return { error: "Unknown advert." };
  try {
    await deleteAdvert(id);
    revalidatePath("/", "layout");
    return { done: Date.now() };
  } catch (error) {
    return failure(error, "The advert could not be deleted.");
  }
}
