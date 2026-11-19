"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Elapsed } from "../../elapsed";
import { addAdvertsToEdition, suggestAdvertsFor } from "./actions";

export type EditorAdvert = {
  /** Id of the placement in this edition. */
  id: number;
  advertId: number;
  advertiser: string;
  size: "double" | "full" | "half" | "quarter";
  sizeLabel: string;
  /** The article row it is printed with, or null while it has no place. */
  articleId: number | null;
  reason: string;
  placedBy: "claude" | "rule" | "person";
  warning: string | null;
  /** Page it starts on in the PDF that exists now; null when there is none or it is out of date. */
  page: number | null;
};

export type AdvertMove = { move: number } | "again" | "remove";

const iconButton =
  "flex h-8 w-8 items-center justify-center rounded border border-violet-300 bg-white text-base leading-none hover:bg-violet-100 disabled:opacity-30 disabled:hover:bg-white";

const BY = { claude: "Placed by Claude", rule: "Placed by the app's rules", person: "Placed by hand" } as const;

/** One advert, shown under the article it is printed with. */
export function AdvertRow({
  advert,
  articles,
  busy,
  canAsk,
  armed,
  dragging,
  onArm,
  onDragStart,
  onDragEnd,
  onChange,
}: {
  advert: EditorAdvert;
  /** Saved, included articles in page order: the places the advert can go. */
  articles: { id: number; title: string }[];
  busy: boolean;
  /** False when no Claude key is set. */
  canAsk: boolean;
  armed: boolean;
  dragging: boolean;
  onArm: (armed: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onChange: (change: AdvertMove) => void;
}) {
  const at = articles.findIndex((article) => article.id === advert.articleId);
  const name = advert.advertiser || "an advertiser";
  return (
    <div
      data-advert-row={advert.id}
      draggable={armed}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `advert-${advert.id}`);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`mb-1.5 ml-9 flex items-start gap-3 rounded border border-violet-300 bg-violet-50 p-3 ${dragging ? "opacity-50" : ""} ${busy ? "opacity-60" : ""}`}
    >
      <span
        onMouseDown={() => onArm(true)}
        onMouseUp={() => onArm(false)}
        title="Drag onto an article to print the advert with it"
        aria-hidden
        data-advert-handle
        className="flex h-14 w-6 flex-none cursor-grab select-none items-center justify-center rounded text-xl text-violet-700 hover:bg-violet-100 active:cursor-grabbing"
      >
        ⠿
      </span>
      <a href={`/adverts/${advert.advertId}/image?full`} target="_blank" rel="noreferrer" title="Open the advert" className="flex-none">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by this app to signed-in users only */}
        <img src={`/adverts/${advert.advertId}/image`} alt={`Advert of ${name}`} loading="lazy" className="h-14 w-24 rounded border border-violet-200 bg-white object-contain" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">
          <span className="mr-2 rounded bg-violet-700 px-1.5 py-0.5 text-xs font-bold tracking-wide text-white">ADVERT</span>
          {advert.advertiser || "Advertiser not named"} · {advert.sizeLabel}
          {advert.page !== null && <span className="ml-2 text-xs font-normal text-neutral-600">page {advert.size === "double" ? `${advert.page}–${advert.page + 1}` : advert.page}</span>}
        </p>
        <p className="mt-0.5 text-xs text-neutral-700">
          {advert.size === "double"
            ? "Printed as a double page straight after the article above."
            : advert.size === "full"
              ? "Printed as the right-hand page that ends the article above."
              : advert.size === "half"
                ? "Printed across the lower half of the first text page of the article above."
                : "Printed in the lower half of the first text page of the article above, beside a second quarter page or the article's photo."}
        </p>
        <p className="mt-1 text-sm text-neutral-900">
          <span className="font-medium">Why here:</span> {advert.reason || "No reason was recorded."}{" "}
          <span className="ml-1 rounded bg-white px-1.5 py-0.5 text-xs text-violet-900 ring-1 ring-violet-200">{BY[advert.placedBy]}</span>
        </p>
        {advert.warning && <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-950">{advert.warning}</p>}
        <label className="mt-2 flex items-center gap-1 text-xs text-neutral-600">
          Print it with
          <select
            value={advert.articleId ?? ""}
            disabled={busy}
            onChange={(event) => onChange({ move: Number(event.target.value) })}
            title="Choose the article this advert is printed with"
            className="max-w-md rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
          >
            {articles.map((article, index) => (
              <option key={article.id} value={article.id}>
                {index + 1}. {article.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-none items-center gap-1">
        <button type="button" disabled={busy || at <= 0} onClick={() => onChange({ move: articles[at - 1].id })} title="Move the advert up to the article before this one" aria-label={`Move the advert of ${name} to the article before`} className={iconButton}>
          ↑
        </button>
        <button
          type="button"
          disabled={busy || at < 0 || at >= articles.length - 1}
          onClick={() => onChange({ move: articles[at + 1].id })}
          title="Move the advert down to the article after this one"
          aria-label={`Move the advert of ${name} to the article after`}
          className={iconButton}
        >
          ↓
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onChange("again")}
          title={canAsk ? "Have Claude choose the place again from the articles as they are now (one request)" : "Have the app choose the place again from the articles as they are now"}
          aria-label={`Choose the place of the advert of ${name} again`}
          className={iconButton}
        >
          ↻
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Take the advert of ${name} out of this edition? It stays in the library.`)) onChange("remove");
          }}
          title="Take this advert out of this edition. It stays in the library."
          aria-label={`Take the advert of ${name} out of this edition`}
          className={`${iconButton} ml-2 text-red-800 hover:bg-red-50`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export type LibraryAdvert = {
  id: number;
  advertiser: string;
  sizeLabel: string;
  summary: string;
  /** Claude found the advert addressed to this edition's readers. */
  suits: boolean;
  /** The article of this edition Claude would print it with, and why; null until Claude has been asked. */
  suggestion: { relation: "advertiser" | "product" | "segment" | "none"; articleTitle: string | null; reason: string; competitor: boolean } | null;
};

/** An advert is suggested when an article is about its advertiser or about the kind of product it sells. */
const isSuggested = (advert: LibraryAdvert) => advert.suggestion?.relation === "advertiser" || advert.suggestion?.relation === "product";

/**
 * The box above the article list: what is placed, and a picker to add adverts from the library. Adverts are ticked,
 * not chosen one at a time, and all of them are placed together.
 */
export function AdvertsPanel({
  editionId,
  editionName,
  needsSuggestions,
  placed,
  library,
  canAsk,
  hasArticles,
}: {
  editionId: number;
  /** For example "Commercial Vehicle". */
  editionName: string;
  /** Claude has not yet said, for some adverts, which article of this edition they belong with. */
  needsSuggestions: boolean;
  placed: EditorAdvert[];
  /** Adverts of the library that are not in this edition yet, those that suit it first. */
  library: LibraryAdvert[];
  canAsk: boolean;
  hasArticles: boolean;
}) {
  const [state, action, pending] = useActionState(addAdvertsToEdition, undefined);
  const suiting = library.filter((advert) => advert.suits).map((advert) => advert.id);
  const suggestedIds = library.filter(isSuggested).map((advert) => advert.id);
  const hasSuggestions = library.some((advert) => advert.suggestion !== null);
  // An edition without adverts opens the picker by itself, with the suggested adverts already ticked. While Claude
  // is still reading the articles nothing is ticked; the ticks appear with the suggestions unless the person has
  // started ticking themselves. Without Claude, the adverts addressed to this edition's readers are ticked.
  const first = placed.length === 0 && library.length > 0;
  const [open, setOpen] = useState(first);
  const [ticked, setTickedRaw] = useState<number[]>(first ? (hasSuggestions ? suggestedIds : needsSuggestions ? [] : suiting) : []);
  const [touched, setTouched] = useState(false);
  const setTicked = (next: number[] | ((current: number[]) => number[])) => {
    setTouched(true);
    setTickedRaw(next);
  };
  const [waiting, setWaiting] = useState(needsSuggestions);
  if (waiting !== needsSuggestions) {
    setWaiting(needsSuggestions);
    if (!needsSuggestions && !touched && first) setTickedRaw(suggestedIds);
  }

  // Claude is asked once the picker is open and something is missing: one request for all the adverts.
  const [asking, startAsking] = useTransition();
  const [askError, setAskError] = useState<string | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (!open || !needsSuggestions || !hasArticles || asked.current) return;
    asked.current = true;
    startAsking(async () => {
      const result = await suggestAdvertsFor(editionId);
      setAskError(result?.error ?? null);
    });
  }, [open, needsSuggestions, hasArticles, editionId]);
  const unplaced = placed.filter((advert) => advert.articleId === null);

  // After adding, the picker closes and starts empty next time.
  const done = state?.done;
  const [seen, setSeen] = useState<number | undefined>(undefined);
  if (done !== seen) {
    setSeen(done);
    setOpen(false);
    setTickedRaw([]);
    setTouched(false);
  }

  const chosen = ticked.filter((id) => library.some((advert) => advert.id === id));
  const toggle = (id: number) => setTicked((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  const small = "rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-40";

  return (
    <div className="mt-4 rounded border border-violet-300 bg-violet-50 px-4 py-3" data-adverts-panel>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-bold text-violet-950">Adverts in this edition: {placed.length === 0 ? "none" : placed.length}</p>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {library.length > 0 && !open && (
            <button type="button" onClick={() => setOpen(true)} className="rounded bg-violet-800 px-3 py-1.5 text-sm font-medium text-white">
              + Add adverts <span className="font-normal opacity-80">({library.length} in the library)</span>
            </button>
          )}
          {library.length === 0 && <span className="text-sm text-neutral-700">{placed.length > 0 ? "Every advert in the library is already here." : "The library has no adverts yet."}</span>}
          <a href="/adverts" className="text-sm underline">
            Upload or edit adverts
          </a>
        </div>
      </div>
      <p className="mt-1 text-sm text-neutral-800">
        {placed.length === 0
          ? "Tick the adverts for this edition and the app prints each with the article on the same subject: a full page after the article, a half or quarter page on its text page, a double page in the middle of the magazine."
          : "Each advert is in the list below, under the article it is printed with, with the reason it is there. Drag it by its handle onto another article, or use its arrows. An article's text page holds one half page or two quarter pages."}
      </p>

      {state?.done && !pending && !open && (
        <p role="status" className="mt-2 rounded bg-green-50 px-3 py-2 text-sm text-green-900">
          {state.added === 1 ? "1 advert was added" : `${state.added ?? 0} adverts were added`} and placed. Each is in the list below with the reason for its place.
        </p>
      )}

      {open && library.length > 0 && (
        <form action={action} className="mt-3 rounded border border-violet-200 bg-white p-3" data-advert-picker>
          <input type="hidden" name="id" value={editionId} />
          {chosen.map((id) => (
            <input key={id} type="hidden" name="advertId" value={id} />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-medium">
              Tick the adverts to print in this edition <span className="font-normal text-neutral-600">({library.length} not in it yet)</span>
            </p>
            <button type="button" onClick={() => setTicked(library.map((advert) => advert.id))} disabled={pending || chosen.length === library.length} className={small}>
              Tick all
            </button>
            {hasSuggestions ? (
              <button
                type="button"
                onClick={() => setTicked(suggestedIds)}
                disabled={pending || suggestedIds.length === 0}
                title="The adverts that an article of this edition is about: the advertiser itself, or the kind of product it sells"
                className={small}
              >
                Only the suggested ({suggestedIds.length})
              </button>
            ) : (
              suiting.length > 0 &&
              suiting.length < library.length && (
                <button type="button" onClick={() => setTicked(suiting)} disabled={pending} title={`The adverts Claude found addressed to ${editionName} readers`} className={small}>
                  Only those for {editionName} ({suiting.length})
                </button>
              )
            )}
            <button type="button" onClick={() => setTicked([])} disabled={pending || chosen.length === 0} className={small}>
              Untick all
            </button>
          </div>

          {asking && (
            <p role="status" className="mt-2 rounded bg-violet-50 px-3 py-2 text-sm text-violet-950">
              Claude is reading this edition&apos;s articles to suggest which adverts belong in it. <Elapsed /> so far. You can tick adverts meanwhile.
            </p>
          )}
          {askError && !asking && (
            <p role="alert" className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {askError}
            </p>
          )}
          {hasSuggestions && !asking && (
            <p className="mt-2 text-sm text-neutral-700">
              {suggestedIds.length === 0
                ? "Claude read this edition's articles and found none that is about any of these adverts. You can still add them; they are printed near the middle."
                : `Claude read this edition's articles and suggests ${suggestedIds.length} of these ${library.length} adverts. Each card says which article the advert would be printed with.`}
            </p>
          )}

          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {library.map((advert) => {
              const on = chosen.includes(advert.id);
              return (
                <li key={advert.id}>
                  <label
                    data-pick={advert.id}
                    className={`flex h-full cursor-pointer items-start gap-3 rounded border p-2.5 ${on ? "border-violet-700 bg-violet-50 ring-1 ring-violet-700" : "border-neutral-300 hover:bg-neutral-50"}`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(advert.id)} disabled={pending} className="mt-1 h-4 w-4 flex-none" />
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by this app to signed-in users only */}
                    <img src={`/adverts/${advert.id}/image`} alt="" loading="lazy" className="h-16 w-20 flex-none rounded border border-neutral-200 bg-neutral-100 object-contain" />
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{advert.advertiser || "Advertiser not named"}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        <span className="rounded bg-violet-700 px-1.5 py-0.5 text-xs text-white">{advert.sizeLabel}</span>
                        {isSuggested(advert) ? (
                          <span className="rounded bg-green-600 px-1.5 py-0.5 text-xs font-medium text-white">Suggested</span>
                        ) : advert.suggestion?.relation === "segment" ? (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-950">Same segment</span>
                        ) : advert.suggestion?.relation === "none" ? (
                          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700">No related article</span>
                        ) : (
                          advert.suits && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-950">For {editionName}</span>
                        )}
                        {advert.suggestion?.competitor && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-950">Competitor&apos;s article</span>}
                      </span>
                      {advert.suggestion?.articleTitle ? (
                        <span className="mt-1.5 block text-xs text-neutral-800" data-suggestion>
                          <span className="block">
                            <span className="font-bold text-neutral-600">Printed with: </span>
                            <span className="font-medium" data-suggested-article>
                              {advert.suggestion.articleTitle}
                            </span>
                          </span>
                          <span className="mt-1 block rounded bg-white/70 px-1.5 py-1 ring-1 ring-neutral-200">
                            <span className="font-bold text-neutral-600">{isSuggested(advert) ? "Why it is suggested: " : advert.suggestion.relation === "segment" ? "Why it is not suggested: " : "Why here: "}</span>
                            {advert.suggestion.reason}
                          </span>
                        </span>
                      ) : advert.suggestion ? (
                        <span className="mt-1.5 block rounded bg-white/70 px-1.5 py-1 text-xs text-neutral-700 ring-1 ring-neutral-200" data-suggestion>
                          <span className="font-bold text-neutral-600">Why it is not suggested: </span>
                          {advert.suggestion.reason || "Nothing in this edition is on its subject."}
                        </span>
                      ) : (
                        <span className="mt-1 line-clamp-2 text-xs text-neutral-600">{advert.summary || "No description yet."}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
            <button
              type="submit"
              disabled={pending || chosen.length === 0 || !hasArticles}
              title={canAsk ? "Claude reads the articles once and places all the ticked adverts together" : "The app places each advert with the article that shares most words with it"}
              className="rounded bg-violet-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Placing…" : chosen.length === 0 ? "Add the ticked adverts" : `Add ${chosen.length} ${chosen.length === 1 ? "advert" : "adverts"} and place ${chosen.length === 1 ? "it" : "them"}`}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-100">
              {placed.length === 0 ? "Not now" : "Cancel"}
            </button>
            {!hasArticles && <p className="text-sm text-amber-900">Include and save some articles first: an advert is printed with an article.</p>}
            {pending && (
              <p role="status" className="text-sm text-violet-950">
                {canAsk ? "Claude is reading the articles to find the right place for each." : "Finding the right place for each."} <Elapsed /> so far.
              </p>
            )}
            {state?.error && !pending && (
              <p role="alert" className="text-sm text-red-800">
                {state.error}
              </p>
            )}
          </div>
        </form>
      )}

      {unplaced.map((advert) => (
        <p key={advert.id} className="mt-2 rounded bg-amber-100 px-3 py-2 text-sm text-amber-950">
          The advert of {advert.advertiser || "an advertiser"} has no place yet and will not be printed. {advert.reason}
        </p>
      ))}
    </div>
  );
}
