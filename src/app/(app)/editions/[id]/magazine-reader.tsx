"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Shows the edition the way a printed magazine is read: the cover alone, then
 * two facing pages at a time, then the back cover alone.
 */
export function MagazineReader({
  id,
  pages,
  contents,
  version,
}: {
  id: number;
  pages: number;
  /** Where each article starts, in page order. */
  contents: { page: number; title: string }[];
  /** Changes whenever the PDF is created again, so old pictures are not reused. */
  version: string;
}) {
  // Page 1 is a right-hand page; after it, left pages are even and right pages odd.
  const spreads = useMemo(() => {
    const list: number[][] = [[1]];
    for (let left = 2; left <= pages; left += 2) list.push(left + 1 <= pages ? [left, left + 1] : [left]);
    return list;
  }, [pages]);

  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const at = Math.min(index, spreads.length - 1);
  const spread = spreads[at];
  const source = (page: number) => `/editions/${id}/pages/${page}?v=${encodeURIComponent(version)}`;

  const go = (target: number) => setIndex(Math.max(0, Math.min(spreads.length - 1, target)));
  const goToPage = (page: number) => go(page <= 1 ? 0 : Math.floor(page / 2));

  // Load the neighbouring spreads ahead of time so turning a page is instant.
  useEffect(() => {
    for (const neighbour of [spreads[at + 1], spreads[at - 1]]) {
      for (const page of neighbour ?? []) new Image().src = `/editions/${id}/pages/${page}?v=${encodeURIComponent(version)}`;
    }
  }, [at, spreads, id, version]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const label =
    spread.length === 2 ? `Pages ${spread[0]} and ${spread[1]} of ${pages}` : spread[0] === 1 ? `Cover (page 1 of ${pages})` : `Page ${spread[0]} of ${pages}`;
  // The article that is open: the last one starting on or before the right-hand page.
  const current = [...contents].reverse().find((entry) => entry.page <= spread[spread.length - 1]);
  const arrow =
    "absolute top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-4xl leading-none text-white hover:bg-black/80 disabled:opacity-20";

  return (
    <div
      ref={frame}
      tabIndex={0}
      aria-label="Magazine reader. Use the left and right arrow keys to turn pages."
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "PageDown") go(at + 1);
        else if (event.key === "ArrowLeft" || event.key === "PageUp") go(at - 1);
        else if (event.key === "Home") go(0);
        else if (event.key === "End") go(spreads.length - 1);
        else return;
        event.preventDefault();
      }}
      className={`flex flex-col rounded bg-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${full ? "h-screen" : ""}`}
    >
      <div className={`relative flex items-center justify-center px-16 py-5 ${full ? "min-h-0 flex-1" : "h-[78vh]"}`}>
        <button type="button" onClick={() => go(at - 1)} disabled={at === 0} title="Previous pages (left arrow key)" aria-label="Previous pages" className={`${arrow} left-2`}>
          ‹
        </button>

        <div className="flex h-full max-w-full items-center justify-center shadow-2xl">
          {/* A single page sits where it would in the open magazine: the cover on the right, the back cover on the left. */}
          {spread.length === 1 && spread[0] === 1 && <div className="hidden h-full md:block" style={{ aspectRatio: "210 / 297" }} />}
          {spread.map((page) => (
            // eslint-disable-next-line @next/next/no-img-element -- page pictures come from a protected route
            <img
              key={page}
              src={source(page)}
              alt={`Page ${page}`}
              onClick={() => go(spread.length === 2 && page === spread[0] ? at - 1 : at + 1)}
              title={spread.length === 2 && page === spread[0] ? "Click to go back" : "Click to turn the page"}
              className="h-full w-auto min-w-0 cursor-pointer bg-white object-contain"
              style={{ aspectRatio: "210 / 297" }}
            />
          ))}
          {spread.length === 1 && spread[0] !== 1 && <div className="hidden h-full md:block" style={{ aspectRatio: "210 / 297" }} />}
        </div>

        <button
          type="button"
          onClick={() => go(at + 1)}
          disabled={at === spreads.length - 1}
          title="Next pages (right arrow key)"
          aria-label="Next pages"
          className={`${arrow} right-2`}
        >
          ›
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b bg-neutral-900 px-4 py-3 text-sm text-neutral-100">
        <span className="w-44 font-medium tabular-nums" aria-live="polite">
          {label}
        </span>
        <input
          type="range"
          min={0}
          max={spreads.length - 1}
          value={at}
          onChange={(event) => go(Number(event.target.value))}
          aria-label="Move through the magazine"
          title="Drag to move through the magazine"
          className="min-w-40 flex-1"
        />
        <label className="flex items-center gap-2">
          <span className="text-neutral-300">Go to</span>
          <select
            value={current && current.page > 5 ? current.page : ""}
            onChange={(event) => (event.target.value ? goToPage(Number(event.target.value)) : go(0))}
            className="max-w-72 rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-neutral-100"
          >
            <option value="">Front pages</option>
            {contents.map((entry) => (
              <option key={entry.page} value={entry.page}>
                {entry.page}. {entry.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => (full ? document.exitFullscreen() : frame.current?.requestFullscreen())}
          title={full ? "Leave full screen (Esc)" : "Read on the whole screen"}
          className="rounded border border-neutral-600 px-3 py-1 hover:bg-neutral-700"
        >
          {full ? "Exit full screen" : "Full screen"}
        </button>
      </div>
    </div>
  );
}
