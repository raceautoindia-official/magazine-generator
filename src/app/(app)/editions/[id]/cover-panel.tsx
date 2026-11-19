"use client";

import { useState } from "react";
import { useJob } from "../../use-job";
import { formatDuration } from "@/lib/duration";
import { Elapsed } from "../../elapsed";
import { changeCoverStyle, pickCover, type PdfState } from "./actions";
import { UNSAVED_MESSAGE, useUnsaved } from "./unsaved";

const MODE_TEXT: Record<string, string> = {
  crop: "The photo is cropped to fill the page.",
  full: "The whole photo is shown across the page, with a blurred copy of itself above and below.",
  "ai-extend": "The photo was extended above and below by AI, so it fills the page. The photo itself is the original.",
};

type Style = "ai" | "blur" | "crop";
const STYLES: { key: Style; name: string; text: string }[] = [
  {
    key: "ai",
    name: "Stretched to the full page with AI",
    text: "AI paints more sky above and more ground below, so the wide photo becomes a tall cover. The photo itself stays the original. Used unless you choose otherwise.",
  },
  {
    key: "blur",
    name: "Whole photo, blurred above and below",
    text: "The photo across the page as it is, on a blurred, darkened copy of itself. No AI.",
  },
  {
    key: "crop",
    name: "Cropped to fill the page",
    text: "A tall slice of the photo around its subject. No AI, but a wide vehicle may lose its ends.",
  },
];
const styleOfMode = (mode: string | null): Style | null => (mode === "ai-extend" ? "ai" : mode === "full" ? "blur" : mode === "crop" ? "crop" : null);

const button = "rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50";

export type CoverChoice = { postId: number; title: string; image: string };

export function CoverPanel({
  id,
  hasCover,
  mode,
  style,
  canExtend,
  version,
  locked,
  pick,
  onCover,
  line,
  choices,
}: {
  id: number;
  /** False until the first PDF exists; there is no cover picture before that. */
  hasCover: boolean;
  mode: string | null;
  /** The style a person chose; null while the default is in use. */
  style: Style | null;
  canExtend: boolean;
  version: string;
  /** A finished edition cannot be changed. */
  locked: boolean;
  /** Article picked by hand, or null when the cover photo is chosen automatically. */
  pick: number | null;
  /** Article whose photo is on the cover now. */
  onCover: number | null;
  line: string;
  /** Included articles that have a photo, in page order. */
  choices: CoverChoice[];
}) {
  const [extended, extend, extending] = useJob<NonNullable<PdfState>>(changeCoverStyle);
  const [picked, choose, choosing] = useJob<NonNullable<PdfState>>(pickCover);
  // Both buttons create the PDF again, which must not happen from a list that has unsaved changes.
  const unsaved = useUnsaved();
  const busy = extending || choosing;

  const [selected, setSelected] = useState<number | null>(pick);
  const [text, setText] = useState(line);
  const [base, setBase] = useState(`${pick}|${line}`);
  // After the cover was changed, start again from what is stored.
  if (`${pick}|${line}` !== base) {
    setBase(`${pick}|${line}`);
    setSelected(pick);
    setText(line);
  }

  // The style in use: the person's choice, else what the last PDF used, else the default.
  const inUse: Style = style ?? styleOfMode(mode) ?? (canExtend ? "ai" : "blur");
  const [wanted, setWanted] = useState<Style>(inUse);
  const [styleBase, setStyleBase] = useState<Style>(inUse);
  if (inUse !== styleBase) {
    setStyleBase(inUse);
    setWanted(inUse);
  }

  const changed = selected !== pick || text.trim() !== line.trim();
  const shown = choices.find((choice) => choice.postId === selected) ?? null;
  const current = choices.find((choice) => choice.postId === onCover) ?? null;
  const stamp = encodeURIComponent(`${version}-${extended?.at ?? ""}-${picked?.at ?? ""}`);
  const error = extended?.error || picked?.error;

  return (
    <section className="rounded border border-neutral-300 bg-white p-5">
      <h2 className="text-lg font-bold">Cover</h2>
      <div className="mt-4 grid gap-8 lg:grid-cols-[auto_1fr]">
        <figure className="w-72">
          <figcaption className="mb-2 text-sm font-medium">The cover now</figcaption>
          <div className="relative">
            {hasCover ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by a protected route, not a static asset
              <img key={stamp} src={`/editions/${id}/cover?v=${stamp}`} alt="Cover of this edition" className="w-72 border border-neutral-300" />
            ) : (
              <div className="flex aspect-[210/297] w-72 items-center justify-center border border-dashed border-neutral-400 bg-neutral-100 p-6 text-center text-sm text-neutral-700">
                The cover appears here when the PDF has been created.
              </div>
            )}
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-4 text-center text-sm font-medium">
                <span>
                  {choosing ? "Putting the new photo on the cover and creating the PDF again…" : "Changing the cover and creating the PDF again…"}
                  <span className="mt-2 block text-base">
                    <Elapsed />
                  </span>
                </span>
              </div>
            )}
          </div>
          {hasCover && <p className="mt-2 text-sm text-neutral-700">{(mode && MODE_TEXT[mode]) || "Chosen automatically from the opening articles."}</p>}
          {current && <p className="mt-1 text-sm text-neutral-700">Photo from: {current.title}</p>}
        </figure>

        {!locked && (
          <div className="min-w-0">
            <h3 className="font-bold">Choose the cover photo</h3>
            <p className="mt-1 text-sm text-neutral-700">
              Click a photo to see it larger. Nothing changes until you press <strong>Put this on the cover</strong>.
            </p>

            <div className="mt-3 rounded border border-neutral-300 bg-neutral-100 p-3">
              {shown ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a stored post image on the site's own bucket */}
                  <img src={shown.image} alt="" className="max-h-72 w-full rounded object-contain" />
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Selected:</span> {shown.title}
                    {selected === onCover && !changed && " (this is the cover now)"}
                  </p>
                </>
              ) : (
                <p className="py-6 text-center text-sm text-neutral-700">
                  <span className="font-medium">Automatic:</span> the application takes the first article whose photo suits a
                  cover.
                </p>
              )}
            </div>

            <div role="radiogroup" aria-label="Cover photo" className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
              <button
                type="button"
                role="radio"
                aria-checked={selected === null}
                onClick={() => setSelected(null)}
                title="Let the application choose the cover photo"
                className={`flex aspect-video items-center justify-center rounded border-2 bg-white text-sm font-medium ${
                  selected === null ? "border-sky-600 ring-2 ring-sky-300" : "border-neutral-300 hover:border-neutral-500"
                }`}
              >
                Automatic
              </button>
              {choices.map((choice, index) => (
                <button
                  key={choice.postId}
                  type="button"
                  role="radio"
                  aria-checked={selected === choice.postId}
                  onClick={() => setSelected(choice.postId)}
                  title={`${index + 1}. ${choice.title}`}
                  className={`relative aspect-video overflow-hidden rounded border-2 bg-neutral-200 ${
                    selected === choice.postId ? "border-sky-600 ring-2 ring-sky-300" : "border-neutral-300 hover:border-neutral-500"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a stored post image on the site's own bucket */}
                  <img src={choice.image} alt={choice.title} loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-xs font-medium text-white">{index + 1}</span>
                  {choice.postId === onCover && (
                    <span className="absolute inset-x-0 bottom-0 bg-green-800/90 py-0.5 text-center text-xs font-medium text-white">On the cover</span>
                  )}
                </button>
              ))}
            </div>

            <form action={choose} className="mt-4">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="postId" value={selected ?? ""} />
              <label className="block max-w-xl">
                <span className="text-sm font-medium">Headline printed on the cover</span>
                <input
                  name="line"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={255}
                  placeholder={shown?.title ?? current?.title ?? "The article's own headline"}
                  className="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                />
                <span className="mt-1 block text-xs text-neutral-600">Leave empty to print the headline of the article the photo comes from.</span>
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={busy || unsaved || !changed}
                  title={unsaved ? UNSAVED_MESSAGE : !changed ? "Choose another photo or change the headline first" : "Creates the PDF again with this cover"}
                  className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {choosing ? "Creating the PDF again, up to a minute…" : "Put this on the cover"}
                </button>
                {changed && !busy && (
                  <button type="button" onClick={() => (setSelected(pick), setText(line))} className={button}>
                    Cancel
                  </button>
                )}
                {changed && !busy && <span className="text-sm text-amber-800">Not on the cover yet.</span>}
              </div>
            </form>

            <form action={extend} className="mt-6 border-t border-neutral-200 pt-4">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="style" value={wanted} />
              <h3 className="font-bold">How the photo fills the tall page</h3>
              <div role="radiogroup" aria-label="Cover style" className="mt-2 grid gap-2 xl:grid-cols-3">
                {STYLES.map((entry) => {
                  const unavailable = entry.key === "ai" && !canExtend;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      role="radio"
                      aria-checked={wanted === entry.key}
                      disabled={unavailable}
                      onClick={() => setWanted(entry.key)}
                      className={`rounded border-2 bg-white p-3 text-left text-sm disabled:opacity-50 ${
                        wanted === entry.key ? "border-sky-600 ring-2 ring-sky-300" : "border-neutral-300 hover:border-neutral-500"
                      }`}
                    >
                      <span className="block font-medium">
                        {entry.name}
                        {entry.key === inUse && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-950">in use</span>}
                      </span>
                      <span className="mt-1 block text-neutral-700">{unavailable ? "Not available: no OpenAI API key is set on the server." : entry.text}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={busy || unsaved || wanted === inUse || changed}
                  title={changed ? "Put the selected photo on the cover first" : unsaved ? UNSAVED_MESSAGE : wanted === inUse ? "This style is already in use" : "Creates the PDF again with this style"}
                  className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {extending ? "Creating the PDF again, up to two minutes…" : "Use this style"}
                </button>
                {inUse === "ai" && wanted === "ai" && canExtend && hasCover && (
                  <button
                    type="submit"
                    name="repaint"
                    value="1"
                    disabled={busy || unsaved || changed}
                    title="Asks the AI for a different picture above and below the photo. One more request charged to your OpenAI account."
                    className={button}
                  >
                    Paint a new version
                  </button>
                )}
              </div>
              <p className="mt-2 max-w-2xl text-xs text-neutral-600">
                The AI picture is made once for each cover photo (one request charged to your OpenAI account, about half a minute) and is then
                reused every time the PDF is created. Look at the result before publishing.
              </p>
            </form>

            {unsaved && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{UNSAVED_MESSAGE}</p>}
            {error && !busy && (
              <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
            {(extended?.pages !== undefined || picked?.pages !== undefined) && !busy && !error && !changed && (
              <p role="status" className="mt-3 text-sm text-green-800">
                Cover changed and the PDF created again
                {(() => {
                  const latest = [extended, picked].filter((result) => result?.ms !== undefined).sort((a, b) => (b?.at ?? 0) - (a?.at ?? 0))[0];
                  return latest?.ms !== undefined ? ` in ${formatDuration(latest.ms)}` : "";
                })()}
                .
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
