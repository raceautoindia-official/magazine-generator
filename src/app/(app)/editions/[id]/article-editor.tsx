"use client";

import { useActionState, useEffect, useState, useTransition, type DragEvent } from "react";
import { insertInOrder } from "@/lib/insert-in-order";
import { changeAdvert, storeArticles } from "./actions";
import { AdvertRow, AdvertsPanel, type AdvertMove, type EditorAdvert, type LibraryAdvert } from "./advert-rows";
import { setUnsaved } from "./unsaved";

type Section = "national" | "international";
type ArticleType = string;

export type EditorArticle = {
  id: number;
  included: boolean;
  section: Section;
  type: ArticleType;
  title: string;
  /** Date, category and market in one line. */
  details: string;
  why: string;
  words: number | null;
  views: number | null;
  /** Address of the post's photo for a small picture, or null. */
  thumb: string | null;
  /** The post was deleted from the main site. */
  missing: boolean;
};

type Row = EditorArticle & { transfer: string };

const toRows = (articles: EditorArticle[]): Row[] => articles.map((article) => ({ ...article, transfer: "" }));
const signature = (rows: { id: number; included: boolean; section: string; type: string; transfer?: string }[]) =>
  rows.map((row) => `${row.id}:${row.included ? 1 : 0}:${row.section}:${row.type}:${row.transfer ?? ""}`).join("|");

const select = "rounded border border-neutral-300 bg-white px-2 py-1 text-sm";
const iconButton =
  "flex h-8 w-8 items-center justify-center rounded border border-neutral-300 bg-white text-base leading-none hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-white";
const plain = "rounded border border-neutral-400 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50";

function Thumb({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a stored post image on the site's own bucket
    <img src={url} alt="" loading="lazy" className="h-14 w-24 flex-none rounded bg-neutral-200 object-cover" />
  ) : (
    <div className="flex h-14 w-24 flex-none items-center justify-center rounded bg-neutral-200 text-xs text-neutral-600">No photo</div>
  );
}

export function ArticleEditor({
  editionId,
  articles,
  ordering,
  types,
  sectionLabels,
  counts,
  otherEditions,
  adverts,
  advertLibrary,
  editionName,
  needsSuggestions,
  canAskClaude,
}: {
  editionId: number;
  articles: EditorArticle[];
  ordering: { sections: Section[]; types: ArticleType[] };
  /** Article types in printed order. */
  types: { key: string; label: string }[];
  /** The labels printed in the magazine, for example NATIONAL NEWS. */
  sectionLabels: Record<Section, string>;
  counts: { minimum: number; recommended: number; maximum: number };
  otherEditions: { key: string; label: string }[];
  /** Adverts placed in this edition, as saved. They are changed straight away, not with Save changes. */
  adverts: EditorAdvert[];
  /** Adverts of the library that can still be added. */
  advertLibrary: LibraryAdvert[];
  editionName: string;
  /** Some library adverts have no suggestion from Claude for this edition's articles yet. */
  needsSuggestions: boolean;
  canAskClaude: boolean;
}) {
  const [state, action, pending] = useActionState(storeArticles, undefined);
  const [rows, setRows] = useState(() => toRows(articles));
  const [base, setBase] = useState(() => signature(articles));
  const [dragged, setDragged] = useState<number | null>(null);
  const [target, setTarget] = useState<{ id: number; after: boolean } | null>(null);
  /** Row whose grip is held down; only that row can be dragged, so text in the others can still be selected. */
  const [armed, setArmed] = useState<number | null>(null);
  /** The advert being dragged or armed for dragging, by placement id. */
  const [draggedAdvert, setDraggedAdvert] = useState<number | null>(null);
  const [armedAdvert, setArmedAdvert] = useState<number | null>(null);
  const [advertBusy, startAdvert] = useTransition();
  const [advertError, setAdvertError] = useState<string | null>(null);

  /** Adverts are saved the moment they are changed; the article list keeps whatever is unsaved in it. */
  const changeAdvertNow = (placementId: number, change: AdvertMove) =>
    startAdvert(async () => {
      const result = await changeAdvert(editionId, placementId, change);
      setAdvertError(result?.error ?? null);
    });
  /** The places an advert can go: the included articles as they are saved. */
  const savedArticles = articles.filter((article) => article.included).map((article) => ({ id: article.id, title: article.title }));
  const advertsOf = (articleId: number) => adverts.filter((advert) => advert.articleId === articleId);

  // After a save (or a change made elsewhere) the page sends new articles: start again from them.
  const incoming = signature(articles);
  if (incoming !== base) {
    setBase(incoming);
    setRows(toRows(articles));
  }

  const included = rows.filter((row) => row.included);
  const leftOut = rows.filter((row) => !row.included);
  const dirty = signature(rows) !== base;

  // Tell the other panels, and ask before the page is left with changes that would be lost.
  useEffect(() => {
    setUnsaved(dirty);
    if (!dirty) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => {
      window.removeEventListener("beforeunload", ask);
      setUnsaved(false);
    };
  }, [dirty]);

  const change = (id: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  /**
   * An included article whose section is changed moves to that section, to the place its type has
   * there. Left where it was, it would sit among the other section's articles under a heading of its own.
   */
  const changeSection = (id: number, section: Section) =>
    setRows((current) => {
      const row = current.find((entry) => entry.id === id);
      if (!row || row.section === section) return current;
      if (!row.included) return current.map((entry) => (entry.id === id ? { ...entry, section } : entry));
      const on = current.filter((entry) => entry.included && entry.id !== id);
      return [...insertInOrder(on, { ...row, section }, ordering), ...current.filter((entry) => !entry.included)];
    });

  /**
   * The other included rows keep their order. A row switched on joins its own section, after the
   * articles of its type and of the types printed before it, not the end of the whole list.
   */
  const setIncluded = (id: number, value: boolean) =>
    setRows((current) => {
      const row = current.find((entry) => entry.id === id);
      if (!row) return current;
      const rest = current.filter((entry) => entry.id !== id);
      const on = rest.filter((entry) => entry.included);
      const off = rest.filter((entry) => !entry.included);
      return value ? [...insertInOrder(on, { ...row, included: true }, ordering), ...off] : [...on, { ...row, included: false }, ...off];
    });

  /** Puts an included row at a position (0 = first) among the included rows. */
  const placeAt = (id: number, position: number) =>
    setRows((current) => {
      const on = current.filter((entry) => entry.included);
      const row = on.find((entry) => entry.id === id);
      if (!row) return current;
      const others = on.filter((entry) => entry.id !== id);
      const index = Math.max(0, Math.min(others.length, position));
      return [...others.slice(0, index), row, ...others.slice(index), ...current.filter((entry) => !entry.included)];
    });

  const rank = (type: ArticleType) => (ordering.types.includes(type) ? ordering.types.indexOf(type) : ordering.types.length);

  /** National before International and the type order, both as set in Settings; otherwise the order stays. */
  const standardOrder = () =>
    setRows((current) => {
      const on = current
        .filter((entry) => entry.included)
        .map((entry, index) => ({ entry, index }))
        .sort(
          (a, b) =>
            ordering.sections.indexOf(a.entry.section) - ordering.sections.indexOf(b.entry.section) ||
            rank(a.entry.type) - rank(b.entry.type) ||
            a.index - b.index,
        )
        .map(({ entry }) => entry);
      return [...on, ...current.filter((entry) => !entry.included)];
    });

  const dropOn = (event: DragEvent) => {
    event.preventDefault();
    if (draggedAdvert !== null && target) changeAdvertNow(draggedAdvert, { move: target.id });
    setDraggedAdvert(null);
    setArmedAdvert(null);
    if (dragged !== null && target && target.id !== dragged) {
      const others = included.filter((row) => row.id !== dragged);
      const index = others.findIndex((row) => row.id === target.id);
      if (index >= 0) placeAt(dragged, index + (target.after ? 1 : 0));
    }
    setDragged(null);
    setTarget(null);
    setArmed(null);
  };

  const payload = JSON.stringify(
    rows.map((row) => {
      const [mode, vertical] = row.transfer.split(":");
      return {
        id: row.id,
        included: row.included,
        section: row.section,
        type: row.type,
        ...(vertical ? { transfer: { mode, vertical } } : {}),
      };
    }),
  );

  const outside = included.length < counts.minimum || included.length > counts.maximum;

  const fields = (row: Row) => (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-neutral-600">
        Section
        <select
          value={row.section}
          onChange={(event) => changeSection(row.id, event.target.value as Section)}
          title="The label printed on this article's pages. Changing it moves the article to that section."
          className={select}
        >
          <option value="national">National</option>
          <option value="international">International</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-neutral-600">
        Type
        <select
          value={row.type}
          onChange={(event) => change(row.id, { type: event.target.value })}
          title="Decides where the article goes in the standard order"
          className={`${select} max-w-52`}
        >
          {!types.some((type) => type.key === row.type) && <option value={row.type}>{row.type} (removed)</option>}
          {types.map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-neutral-600">
        Send to
        <select
          value={row.transfer}
          onChange={(event) => change(row.id, { transfer: event.target.value })}
          title="Put this post in another edition's draft for the same month. It happens when you save."
          className={`${select} ${row.transfer ? "border-amber-500 bg-amber-50" : ""}`}
        >
          <option value="">Stays in this edition</option>
          <optgroup label="Move (removes it here)">
            {otherEditions.map((edition) => (
              <option key={edition.key} value={`move:${edition.key}`}>
                Move to {edition.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Copy (stays here too)">
            {otherEditions.map((edition) => (
              <option key={edition.key} value={`copy:${edition.key}`}>
                Copy to {edition.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
    </div>
  );

  const text = (row: Row) => (
    <div className="min-w-0 flex-1">
      <p className={`font-medium leading-snug ${row.missing ? "text-red-800" : ""}`}>{row.title}</p>
      <p className="mt-0.5 text-xs text-neutral-600">
        {row.details}
        {row.words !== null && ` · ${row.words} words`}
        {row.views !== null && ` · ${row.views} views`}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">{row.why}</p>
      <div className="mt-2">{fields(row)}</div>
    </div>
  );

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">Articles in page order</h2>
        <span className={`rounded-full px-3 py-1 text-sm ${outside ? "bg-amber-100 text-amber-950" : "bg-neutral-200 text-neutral-800"}`}>
          {included.length} included · minimum {counts.minimum}, recommended {counts.recommended}, maximum {counts.maximum}
        </span>
        <button
          type="button"
          onClick={standardOrder}
          disabled={pending}
          title="Sorts the included articles by section and type, in the order set on the Settings page"
          className={`${plain} ml-auto`}
        >
          Put in standard order
        </button>
      </div>
      <p className="mt-2 text-sm text-neutral-700">
        This is the order the articles are printed in. Drag an article by its handle <span aria-hidden>⠿</span>, use the arrow buttons, or
        type a position number. Changes are kept only when you press <strong>Save changes</strong>.
      </p>

      <AdvertsPanel editionId={editionId} editionName={editionName} needsSuggestions={needsSuggestions} placed={adverts} library={advertLibrary} canAsk={canAskClaude} hasArticles={savedArticles.length > 0} />
      {advertError && !advertBusy && (
        <p role="alert" className="mt-3 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
          {advertError}
        </p>
      )}

      {state?.error && !pending && (
        <p role="alert" className="mt-3 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state?.saved && !dirty && !pending && (
        <p role="status" className="mt-3 rounded bg-green-50 px-4 py-3 text-sm text-green-900">
          Saved. {state.sent?.join(" ")} Create the PDF again to see the changes on the pages.
        </p>
      )}

      {included.length === 0 ? (
        <p className="mt-4 rounded border border-dashed border-neutral-400 bg-white p-6 text-center text-sm text-neutral-700">
          No articles are included. Press <strong>Include</strong> on an article in the list below.
        </p>
      ) : (
        <ol className="mt-4" onDragOver={(event) => (dragged !== null || draggedAdvert !== null) && event.preventDefault()} onDrop={dropOn}>
          {included.map((row, index) => {
            const first = index === 0;
            const last = index === included.length - 1;
            const newSection = first || included[index - 1].section !== row.section;
            const marker = target?.id === row.id && ((dragged !== null && dragged !== row.id) || draggedAdvert !== null);
            return (
              <li key={row.id}>
                {newSection && <p className={`mb-1 text-xs font-bold tracking-wide text-red-700 ${first ? "" : "mt-4"}`}>{sectionLabels[row.section]}</p>}
                <div
                  data-article-row={row.id}
                  draggable={armed === row.id}
                  onDragStart={(event) => {
                    setDragged(row.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(row.id));
                  }}
                  onDragOver={(event) => {
                    if (dragged === null && draggedAdvert === null) return;
                    event.preventDefault();
                    const box = event.currentTarget.getBoundingClientRect();
                    // An advert always goes with the article it is dropped on, so its marker is below that article.
                    const after = draggedAdvert !== null || event.clientY > box.top + box.height / 2;
                    if (target?.id !== row.id || target.after !== after) setTarget({ id: row.id, after });
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                    setTarget(null);
                    setArmed(null);
                  }}
                  className={`relative mb-1.5 flex items-start gap-3 rounded border bg-white p-3 ${
                    dragged === row.id ? "border-sky-500 opacity-50" : row.transfer.startsWith("move") ? "border-amber-400 bg-amber-50" : "border-neutral-300"
                  }`}
                >
                  {marker && <span aria-hidden className={`absolute inset-x-0 h-1 rounded bg-sky-600 ${target?.after ? "-bottom-1.5" : "-top-1.5"}`} />}
                  <span
                    onMouseDown={() => setArmed(row.id)}
                    onMouseUp={() => setArmed(null)}
                    title="Drag to move this article"
                    aria-hidden
                    data-drag-handle
                    className="flex h-14 w-6 flex-none cursor-grab select-none items-center justify-center rounded text-xl text-neutral-500 hover:bg-neutral-100 active:cursor-grabbing"
                  >
                    ⠿
                  </span>
                  <input
                    key={`${row.id}-${index}`}
                    type="number"
                    min={1}
                    max={included.length}
                    defaultValue={index + 1}
                    aria-label={`Position of ${row.title}`}
                    title="Position in the magazine. Type a number and press Enter to move the article there."
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    onBlur={(event) => {
                      const wanted = Number(event.target.value);
                      if (Number.isInteger(wanted) && wanted >= 1 && wanted !== index + 1) placeAt(row.id, wanted - 1);
                      else event.target.value = String(index + 1);
                    }}
                    className="h-8 w-12 flex-none rounded border border-neutral-300 text-center text-sm font-medium tabular-nums"
                  />
                  <Thumb url={row.thumb} />
                  {text(row)}
                  <div className="flex flex-none items-center gap-1">
                    <button type="button" onClick={() => placeAt(row.id, 0)} disabled={first} title="Move to the top: make this the first article" aria-label="Move to the top" className={iconButton}>
                      ⤒
                    </button>
                    <button type="button" onClick={() => placeAt(row.id, index - 1)} disabled={first} title="Move up one place" aria-label="Move up one place" className={iconButton}>
                      ↑
                    </button>
                    <button type="button" onClick={() => placeAt(row.id, index + 1)} disabled={last} title="Move down one place" aria-label="Move down one place" className={iconButton}>
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setIncluded(row.id, false)}
                      title="Leave this article out of the magazine. It stays in the list below and can be included again."
                      aria-label="Leave out of the magazine"
                      className={`${iconButton} ml-2 text-red-800 hover:bg-red-50`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {advertsOf(row.id).map((advert) => (
                  <AdvertRow
                    key={advert.id}
                    advert={advert}
                    articles={savedArticles}
                    busy={advertBusy}
                    canAsk={canAskClaude}
                    armed={armedAdvert === advert.id}
                    dragging={draggedAdvert === advert.id}
                    onArm={(on) => setArmedAdvert(on ? advert.id : null)}
                    onDragStart={() => setDraggedAdvert(advert.id)}
                    onDragEnd={() => {
                      setDraggedAdvert(null);
                      setArmedAdvert(null);
                      setTarget(null);
                    }}
                    onChange={(change) => changeAdvertNow(advert.id, change)}
                  />
                ))}
              </li>
            );
          })}
        </ol>
      )}

      {leftOut.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-bold">Available, not in the magazine ({leftOut.length})</h2>
          <p className="mt-1 text-sm text-neutral-700">Posts of this month that fit this edition but are not printed.</p>
          <ul className="mt-3">
            {leftOut.map((row) => (
              <li key={row.id} className="mb-1.5 flex items-start gap-3 rounded border border-neutral-300 bg-neutral-50 p-3">
                <button
                  type="button"
                  onClick={() => setIncluded(row.id, true)}
                  disabled={row.missing}
                  title="Add this article to the magazine, in its section and with the other articles of its type"
                  className="h-8 flex-none rounded border border-green-700 bg-white px-3 text-sm font-medium text-green-900 hover:bg-green-50 disabled:opacity-40"
                >
                  + Include
                </button>
                <Thumb url={row.thumb} />
                <div className="min-w-0 flex-1">
                  {text(row)}
                  {advertsOf(row.id).map((advert) => (
                    <p key={advert.id} className="mt-2 rounded bg-violet-100 px-2 py-1 text-xs text-violet-950">
                      The advert of {advert.advertiser || "an advertiser"} is printed with this article. When you save, the app gives the advert a new place and tells you why.
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Always in view while there is something to save. */}
      {(dirty || pending) && (
        <form
          action={action}
          className="sticky bottom-3 z-30 mx-auto mt-6 flex max-w-2xl flex-wrap items-center gap-3 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 shadow-lg"
        >
          <input type="hidden" name="id" value={editionId} />
          <input type="hidden" name="payload" value={payload} />
          <p className="flex-1 text-sm font-medium text-amber-950">{pending ? "Saving…" : "You have changes that are not saved yet."}</p>
          <button type="button" onClick={() => setRows(toRows(articles))} disabled={pending} title="Go back to the last saved list" className={plain}>
            Undo changes
          </button>
          <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}
    </section>
  );
}
