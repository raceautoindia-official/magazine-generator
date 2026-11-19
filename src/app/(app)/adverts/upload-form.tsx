"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ADVERT_SIZES, checkPicture, KEEP_LABELS, shapeDifference, sizeSpec, type AdvertFit, type AdvertKeep, type AdvertSize } from "@/lib/advert-sizes";
import { Elapsed } from "../elapsed";
import type { AdvertState } from "./actions";
import { SizeDiagram } from "./size-guide";

const field = "mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm";
const POSITION: Record<AdvertKeep, string> = { centre: "center", top: "top", bottom: "bottom", left: "left", right: "right" };
const MAX_BYTES = 30 * 1024 * 1024;

type Picked = { url: string; width: number; height: number; name: string; bytes: number };

/**
 * The size a picture was most likely made for: the one with its shape, and of the two sizes that share
 * a shape (full and quarter, double and half) the one whose best picture size is nearest; the larger on a tie.
 */
function likelySize(width: number, height: number): AdvertSize | null {
  const fitting = ADVERT_SIZES.filter((size) => shapeDifference(size, width, height) <= 0.06);
  if (fitting.length === 0) return null;
  // Nearest in pixels to the size's best picture: a 1240 px wide picture was made as a quarter page, not a full one.
  const distance = (size: (typeof fitting)[number]) => Math.abs(Math.log(width / size.ideal[0]));
  return fitting.reduce((best, size) => (distance(size) < distance(best) - 0.001 ? size : best)).key;
}

/** Upload of one advert: drop the picture in, check the size the app suggests, and see it on the page before sending. */
export function UploadForm({
  state,
  action,
  pending,
  canDescribe,
  onClose,
}: {
  state: AdvertState;
  action: (formData: FormData) => void;
  pending: boolean;
  canDescribe: boolean;
  /** Absent when the form cannot be closed (an empty library). */
  onClose?: () => void;
}) {
  const [size, setSize] = useState<AdvertSize>("full");
  const [suggested, setSuggested] = useState<AdvertSize | null | undefined>(undefined);
  const [fit, setFit] = useState<AdvertFit>("crop");
  const [keep, setKeep] = useState<AdvertKeep>("centre");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // A stored advert clears the form for the next one.
  const done = state?.done;
  const [cleared, setCleared] = useState<number | undefined>(undefined);
  if (done !== cleared) {
    setCleared(done);
    setPicked(null);
    setSuggested(undefined);
    setUnreadable(null);
  }
  useEffect(() => {
    if (done !== undefined) form.current?.reset();
  }, [done]);

  const choose = (file: File | undefined) => {
    setUnreadable(null);
    setSuggested(undefined);
    setPicked((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setPicked({ url, width: image.naturalWidth, height: image.naturalHeight, name: file.name, bytes: file.size });
      const likely = likelySize(image.naturalWidth, image.naturalHeight);
      setSuggested(likely);
      if (likely) setSize(likely);
    };
    // TIFF files cannot be shown by a browser; the server can still read them.
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setUnreadable(file.name);
    };
    image.src = url;
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (!file || !input.current) return;
    input.current.files = event.dataTransfer.files;
    choose(file);
  };

  const spec = sizeSpec(size)!;
  const notes = picked ? checkPicture(spec, picked.width, picked.height, fit) : [];
  const tooBig = picked !== null && picked.bytes > MAX_BYTES;
  const chosen = picked !== null || unreadable !== null;
  const wide = spec.mm[0] > spec.mm[1];

  return (
    <form ref={form} action={action} className="mt-4 rounded-lg border border-neutral-300 bg-white p-5" data-upload-form>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-bold">Upload an advert</h2>
        {onClose && (
          <button type="button" onClick={onClose} disabled={pending} className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100">
            Close
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <p className="text-sm font-medium">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">1</span>
            The advert, as a picture
          </p>
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm ${
              over ? "border-violet-600 bg-violet-50" : chosen ? "border-green-600 bg-green-50" : "border-neutral-400 bg-neutral-50 hover:bg-neutral-100"
            }`}
          >
            <input ref={input} type="file" name="file" required accept="image/*,.tif,.tiff,.svg" onChange={(event) => choose(event.target.files?.[0])} className="sr-only" />
            {picked ? (
              <>
                <span className="font-medium text-green-900">{picked.name}</span>
                <span className="mt-0.5 text-xs text-neutral-700">
                  {picked.width} × {picked.height} px · {(picked.bytes / 1024 / 1024).toFixed(1)} MB · click or drop to choose another
                </span>
              </>
            ) : unreadable ? (
              <>
                <span className="font-medium text-green-900">{unreadable}</span>
                <span className="mt-0.5 text-xs text-neutral-700">This kind of file cannot be previewed here. It can still be uploaded; check it in the library afterwards.</span>
              </>
            ) : (
              <>
                <span className="font-medium">Drop the picture here, or click to choose it</span>
                <span className="mt-0.5 text-xs text-neutral-600">JPG, PNG, WebP, TIFF, GIF or SVG, up to 30 MB. For a PDF, export its page as a picture first.</span>
              </>
            )}
          </label>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">2</span>
              The size that was booked
            </legend>
            {suggested !== undefined && picked && (
              <p className={`mt-2 rounded px-3 py-1.5 text-xs ${suggested ? "bg-violet-50 text-violet-950" : "bg-amber-50 text-amber-950"}`}>
                {suggested
                  ? `This picture has the shape of a ${sizeSpec(suggested)!.label.toLowerCase()}, so that size is selected. Change it if another size was booked.`
                  : "This picture does not have the shape of any of the four sizes. Choose the size that was booked; step 3 decides how it is fitted."}
              </p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {ADVERT_SIZES.map((entry) => (
                <label
                  key={entry.key}
                  title={entry.where}
                  className={`flex cursor-pointer items-center gap-3 rounded border p-3 text-sm ${size === entry.key ? "border-violet-700 bg-violet-50 ring-1 ring-violet-700" : "border-neutral-300 hover:bg-neutral-50"}`}
                >
                  <input type="radio" name="size" value={entry.key} checked={size === entry.key} onChange={() => setSize(entry.key)} className="sr-only" />
                  <SizeDiagram size={entry.key} className="h-9" />
                  <span>
                    <span className="font-medium">{entry.label}</span>
                    <span className="block text-xs text-neutral-600">
                      {entry.mm[0]} × {entry.mm[1]} mm
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-neutral-600">Printed: {spec.where.charAt(0).toLowerCase() + spec.where.slice(1)}.</p>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">3</span>
              If the picture is not exactly that shape
            </legend>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2" title="The picture covers the whole space; what sticks out is cut off">
                <input type="radio" name="fit" value="crop" checked={fit === "crop"} onChange={() => setFit("crop")} />
                Fill the space <span className="text-xs text-neutral-600">(edges may be cut)</span>
              </label>
              <label className="flex items-center gap-2" title="Nothing is cut off; a plain border in the picture's own colour fills the rest">
                <input type="radio" name="fit" value="whole" checked={fit === "whole"} onChange={() => setFit("whole")} />
                Show the whole picture <span className="text-xs text-neutral-600">(plain border)</span>
              </label>
              {fit === "crop" && (
                <label className="flex items-center gap-2">
                  keeping
                  <select name="keep" value={keep} onChange={(event) => setKeep(event.target.value as AdvertKeep)} className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm">
                    {(Object.keys(KEEP_LABELS) as AdvertKeep[]).map((key) => (
                      <option key={key} value={key}>
                        {KEEP_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </fieldset>

          <details className="mt-5 text-sm">
            <summary className="cursor-pointer font-medium">
              Advertiser and web address <span className="font-normal text-neutral-600">(optional{canDescribe && "; Claude reads the advertiser from the advert"})</span>
            </summary>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Advertiser
                <input name="advertiser" maxLength={160} placeholder={canDescribe ? "Leave empty: Claude reads it from the advert" : "Company or brand"} className={field} />
              </label>
              <label className="block text-sm font-medium">
                Their web address
                <input name="link" maxLength={500} placeholder="www.example.com" title="Kept with the advert so it can be made clickable in the PDF later" className={field} />
              </label>
            </div>
          </details>
        </div>

        <div>
          <p className="text-sm font-medium">How it will look on the page</p>
          <div className="mt-2 flex h-72 items-center justify-center rounded bg-neutral-100 p-3">
            {picked ? (
              <div
                className="max-h-full max-w-full overflow-hidden border border-neutral-400 bg-white shadow"
                style={{ aspectRatio: `${spec.mm[0]} / ${spec.mm[1]}`, height: wide ? undefined : "100%", width: wide ? "100%" : undefined }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a file the person has just chosen, shown from memory */}
                <img src={picked.url} alt="The advert as it will be printed" className="h-full w-full" style={{ objectFit: fit === "crop" ? "cover" : "contain", objectPosition: POSITION[keep] }} />
              </div>
            ) : (
              <p className="px-6 text-center text-sm text-neutral-600">Choose a picture to see it here before it is uploaded.</p>
            )}
          </div>
          {picked && spec.key === "double" && <p className="mt-2 text-xs text-neutral-600">The middle of the picture falls on the fold between the two pages.</p>}
          {picked && notes.length === 0 && !tooBig && <p className="mt-2 rounded bg-green-50 px-3 py-2 text-sm text-green-900">Right shape and sharp enough for a {spec.label.toLowerCase()}.</p>}
          {notes.map((note) => (
            <p key={note} className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {note}
            </p>
          ))}
          {tooBig && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">The file is larger than 30 MB. Save it as a JPG and choose it again.</p>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-neutral-200 pt-4">
        <button type="submit" disabled={pending || tooBig || !chosen} className="rounded bg-neutral-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Uploading…" : canDescribe ? "Upload, and have Claude describe it" : "Upload the advert"}
        </button>
        {!chosen && !pending && <p className="text-sm text-neutral-600">Choose a picture first.</p>}
        {pending && (
          <p role="status" className="text-sm text-neutral-700">
            Storing the picture{canDescribe && " and asking Claude what it advertises"}. <Elapsed /> so far.
          </p>
        )}
        {state?.error && !pending && (
          <p role="alert" className="text-sm text-red-800">
            {state.error}
          </p>
        )}
        {state?.done && !pending && !chosen && (
          <p role="status" className="text-sm text-green-800">
            Stored. It is marked <strong>New</strong> in the library below{canDescribe && "; read Claude's description and correct it if needed"}.
          </p>
        )}
      </div>
      {state?.done && !pending && !chosen && state.notes?.map((note) => (
        <p key={note} className="mt-3 rounded bg-amber-50 px-4 py-2 text-sm text-amber-950">
          {note}
        </p>
      ))}
    </form>
  );
}
