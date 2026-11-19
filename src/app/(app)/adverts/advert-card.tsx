"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { KEEP_LABELS, sizeSpec, type AdvertFit, type AdvertKeep, type AdvertSize } from "@/lib/advert-sizes";
import { Elapsed } from "../elapsed";
import { addAdvertToEdition } from "../editions/[id]/actions";
import { describeAgain, removeAdvertFromLibrary, retireAdvert, saveAdvert } from "./actions";

export type CardAdvert = {
  id: number;
  advertiser: string;
  size: AdvertSize;
  fit: AdvertFit;
  keep: AdvertKeep;
  originalName: string;
  width: number;
  height: number;
  link: string;
  summary: string;
  product: string;
  keywords: string[];
  segments: string[];
  summaryBy: "claude" | "person" | null;
  archived: boolean;
  createdAt: string;
  /** Editions it is printed in, newest first. */
  usedIn: { id: number; label: string }[];
  /** Changes when the picture does, so the browser does not show an old copy. */
  version: string;
};

const field = "mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm";
const plain = "rounded border border-neutral-400 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50";

/** Adds the advert to a draft straight from the library; the app chooses its place there. */
function AddToEdition({ advert, drafts, canDescribe }: { advert: CardAdvert; drafts: { id: number; label: string }[]; canDescribe: boolean }) {
  const [state, action, pending] = useActionState(addAdvertToEdition, undefined);
  const [chosen, setChosen] = useState("");
  const [sent, setSent] = useState("");
  const free = drafts.filter((draft) => !advert.usedIn.some((edition) => edition.id === draft.id));
  if (advert.archived) return null;
  if (drafts.length === 0) return <p className="text-xs text-neutral-600">There is no draft edition to add it to. Generate one on the Dashboard.</p>;

  return (
    <div>
      {free.length > 0 ? (
        <form action={action} onSubmit={() => setSent(chosen)} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="advertId" value={advert.id} />
          <select
            name="id"
            required
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            disabled={pending}
            aria-label={`Edition to add the advert of ${advert.advertiser || "this advertiser"} to`}
            className="max-w-64 rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Add to an edition…
            </option>
            {free.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending || chosen === ""}
            title={canDescribe ? "Claude reads that edition's articles and prints the advert with the one on the same subject" : "The app prints the advert with the article that shares most words with it"}
            className="rounded bg-violet-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Placing…" : "Add"}
          </button>
        </form>
      ) : (
        <p className="text-xs text-neutral-600">It is in every draft edition already.</p>
      )}
      {pending && (
        <p role="status" className="mt-1 text-xs text-violet-950">
          {canDescribe ? "Claude is reading the articles to find its place." : "Finding its place."} <Elapsed /> so far.
        </p>
      )}
      {state?.error && !pending && (
        <p role="alert" className="mt-1 text-xs text-red-800">
          {state.error}
        </p>
      )}
      {state?.done && !pending && sent && (
        <p role="status" className="mt-1 text-xs text-green-800">
          Added.{" "}
          <a href={`/editions/${sent}#articles`} className="underline">
            See where it was placed and why
          </a>
        </p>
      )}
    </div>
  );
}

/** One advert: a compact row to scan and add to an edition, opening into the fields to correct it. */
export function AdvertCard({ advert, drafts, canDescribe, isNew }: { advert: CardAdvert; drafts: { id: number; label: string }[]; canDescribe: boolean; isNew: boolean }) {
  const [saved, save, saving] = useActionState(saveAdvert, undefined);
  const [described, describe, describing] = useActionState(describeAgain, undefined);
  const [retired, retire, retiring] = useActionState(retireAdvert, undefined);
  const [removed, remove, removing] = useActionState(removeAdvertFromLibrary, undefined);
  // An advert just uploaded, or one without a description, opens ready to be checked.
  const [editing, setEditing] = useState(isNew || advert.summary.trim() === "");
  const [fit, setFit] = useState(advert.fit);
  const [changed, setChanged] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const spec = sizeSpec(advert.size);
  const busy = saving || describing || retiring || removing;
  const error = saved?.error ?? described?.error ?? retired?.error ?? removed?.error;
  const formId = `advert-${advert.id}`;
  const name = advert.advertiser || "Advertiser not named";

  // After a save the fields hold what is stored again.
  const savedAt = saved?.done;
  const [seen, setSeen] = useState<number | undefined>(undefined);
  if (savedAt !== seen) {
    setSeen(savedAt);
    setChanged(false);
  }

  useEffect(() => {
    if (isNew) row.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isNew]);

  return (
    <li
      ref={row}
      data-advert-card={advert.id}
      data-disabled={advert.archived ? "1" : "0"}
      className={`rounded-lg border ${isNew ? "border-green-600 bg-white ring-2 ring-green-200" : advert.archived ? "border-dashed border-neutral-300 bg-neutral-100" : "border-neutral-300 bg-white"}`}
    >
      <div className="flex flex-wrap items-start gap-4 p-3">
        <a href={`/adverts/${advert.id}/image?full&v=${advert.version}`} target="_blank" rel="noreferrer" title="Open the advert as it is printed" className="flex-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by this app to signed-in users only */}
          <img
            src={`/adverts/${advert.id}/image?v=${advert.version}`}
            alt={`Advert of ${name}`}
            loading="lazy"
            className={`h-24 w-32 rounded border border-neutral-300 bg-neutral-100 object-contain ${advert.archived ? "opacity-60" : ""}`}
          />
        </a>

        <div className="min-w-64 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className={`font-bold ${advert.advertiser ? "" : "text-neutral-500"}`}>{name}</span>
            <span className="rounded bg-violet-700 px-2 py-0.5 text-xs font-medium text-white">{spec?.label ?? advert.size}</span>
            {isNew && <span className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white">New</span>}
            {advert.archived && <span className="rounded bg-neutral-300 px-2 py-0.5 text-xs font-medium">Disabled</span>}
            {advert.summary.trim() === "" && <span className="rounded bg-amber-200 px-2 py-0.5 text-xs text-amber-950">Needs a description</span>}
          </p>
          {!editing && (
            <p className="mt-1 line-clamp-2 text-sm text-neutral-800">
              {advert.summary || "Without a description the app can only match this advert by its advertiser's name. Press Edit to write one."}
            </p>
          )}
          {advert.archived && (
            <p className="mt-1 text-xs text-neutral-700">
              Not offered or suggested for any edition while it is disabled.{advert.usedIn.length > 0 && " The editions it is already in keep it; take it out there if it should not be printed."}
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-600">
            {advert.usedIn.length === 0 ? (
              "Not in any edition yet"
            ) : (
              <>
                In {advert.usedIn.length} {advert.usedIn.length === 1 ? "edition" : "editions"}:{" "}
                {advert.usedIn.slice(0, 4).map((edition, index) => (
                  <span key={edition.id}>
                    {index > 0 && ", "}
                    <a href={`/editions/${edition.id}#articles`} className="underline">
                      {edition.label}
                    </a>
                  </span>
                ))}
                {advert.usedIn.length > 4 && ` and ${advert.usedIn.length - 4} more`}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-none flex-col items-end gap-2">
          <form action={retire}>
            <input type="hidden" name="id" value={advert.id} />
            <input type="hidden" name="archived" value={advert.archived ? "0" : "1"} />
            <button
              type="submit"
              role="switch"
              aria-checked={!advert.archived}
              aria-label={`Use the advert of ${name} in editions`}
              disabled={busy}
              title={
                advert.archived
                  ? "Disabled: this advert is not offered or suggested for any edition. Press to enable it again."
                  : "Enabled: this advert is offered and suggested for editions. Press to disable it; it stays in the library."
              }
              className="flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <span className={advert.archived ? "text-neutral-600" : "font-medium text-green-900"}>{retiring ? "Changing…" : advert.archived ? "Disabled" : "Enabled"}</span>
              <span aria-hidden className={`relative h-6 w-11 rounded-full transition-colors ${advert.archived ? "bg-neutral-300" : "bg-green-600"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${advert.archived ? "left-0.5" : "left-[1.375rem]"}`} />
              </span>
            </button>
          </form>
          <AddToEdition advert={advert} drafts={drafts} canDescribe={canDescribe} />
          <button
            type="button"
            onClick={() => {
              if (editing && changed && !window.confirm("Close without saving your changes to this advert?")) return;
              setEditing(!editing);
              setChanged(false);
            }}
            aria-expanded={editing}
            className={plain}
          >
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="border-t border-neutral-200 p-4">
          <form id={formId} action={save} onChange={() => setChanged(true)}>
            <input type="hidden" name="id" value={advert.id} />
            <input type="hidden" name="size" value={advert.size} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Advertiser
                <input name="advertiser" defaultValue={advert.advertiser} maxLength={160} className={field} />
              </label>
              <label className="block text-sm font-medium">
                Their web address
                <input name="link" defaultValue={advert.link} maxLength={500} placeholder="www.example.com" className={field} />
              </label>
            </div>

            <label className="mt-3 block text-sm font-medium">
              What it advertises{" "}
              <span className="font-normal text-neutral-600">
                ({advert.summaryBy === "claude" ? "written by Claude from the picture" : advert.summaryBy === "person" ? "corrected by hand" : "not described yet"})
              </span>
              <textarea key={advert.summary} name="summary" defaultValue={advert.summary} rows={3} maxLength={1500} placeholder="Who advertises, what is offered, and to whom." className={field} />
            </label>
            <p className="mt-1 text-xs text-neutral-600">
              This description decides which article the advert is printed with, so correct it if it is wrong.
              {advert.product && <> Product: {advert.product}.</>}
              {advert.segments.length > 0 && <> Editions it suits: {advert.segments.join(", ")}.</>}
              {advert.keywords.length > 0 && <> Words looked for in articles: {advert.keywords.join(", ")}.</>}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="font-medium">Shape</span>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="fit" value="crop" checked={fit === "crop"} onChange={() => setFit("crop")} /> Fill the space
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="fit" value="whole" checked={fit === "whole"} onChange={() => setFit("whole")} /> Show the whole picture
              </label>
              {fit === "crop" ? (
                <label className="flex items-center gap-1.5">
                  keeping
                  <select name="keep" defaultValue={advert.keep} className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm">
                    {(Object.keys(KEEP_LABELS) as AdvertKeep[]).map((key) => (
                      <option key={key} value={key}>
                        {KEEP_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="keep" value={advert.keep} />
              )}
              <span className="text-xs text-neutral-600">
                {advert.originalName} · {advert.width} × {advert.height} px · uploaded {advert.createdAt.slice(0, 10)}
              </span>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="submit" form={formId} disabled={busy || !changed} className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {saving ? "Saving…" : "Save changes"}
            </button>
            {changed && !busy && <span className="text-sm text-amber-900">Not saved yet</span>}
            {saved?.done && !saved.error && !busy && !changed && (
              <span role="status" className="text-sm text-green-800">
                Saved.
              </span>
            )}
            <span className="ml-auto" />
            {canDescribe && (
              <form
                action={describe}
                onSubmit={(event) => {
                  if (advert.summary && !window.confirm("Claude will look at the advert again and replace the description. Continue?")) event.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={advert.id} />
                <button type="submit" disabled={busy} title="One request to Claude: it looks at the picture again and writes a new description" className={plain}>
                  {describing ? "Claude is looking…" : "Ask Claude again"}
                </button>
              </form>
            )}
            {advert.usedIn.length === 0 ? (
              <form
                action={remove}
                onSubmit={(event) => {
                  if (!window.confirm("Delete this advert and its picture for good?")) event.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={advert.id} />
                <button type="submit" disabled={busy} title="Removes the advert and its picture from the server" className={`${plain} text-red-800 hover:bg-red-50`}>
                  Delete
                </button>
              </form>
            ) : (
              <span className="text-xs text-neutral-600" title="An advert that an edition prints cannot be deleted. Disable it, or take it out of the editions first.">
                In use, so it cannot be deleted
              </span>
            )}
          </div>
          {error && !busy && (
            <p role="alert" className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
