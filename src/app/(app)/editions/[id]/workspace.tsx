"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { formatDuration } from "@/lib/duration";
import { Elapsed } from "../../elapsed";
import { createPdf, type PdfState } from "./actions";
import { useJob } from "../../use-job";
import { DeleteDraftButton } from "./delete-draft-button";
import { StatusButton } from "./status-button";
import { UNSAVED_MESSAGE, useUnsaved } from "./unsaved";

const TABS = [
  { id: "articles", label: "Articles" },
  { id: "foreword", label: "Foreword" },
  { id: "cover", label: "Cover and photos" },
  { id: "design", label: "Design the pages" },
  { id: "preview", label: "Read and download" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const isTab = (value: string): value is TabId => TABS.some((tab) => tab.id === value);

// Which tab is open. It is kept here, not read from the address: the page's data is refreshed after
// every action, and that refresh can drop the "#cover" part of the address, which used to throw the
// person back to the first tab. The address is still written and read once, so a reload, the Back
// button or a shared link open the same tab.
let openTab: TabId = "articles";
const tabListeners = new Set<() => void>();

function open(next: TabId): void {
  openTab = next;
  window.history.replaceState(window.history.state, "", `#${next}`);
  tabListeners.forEach((listener) => listener());
}

function subscribeToTab(onChange: () => void): () => void {
  const fromAddress = () => {
    const wanted = window.location.hash.slice(1);
    if (isTab(wanted) && wanted !== openTab) {
      openTab = wanted;
      tabListeners.forEach((listener) => listener());
    }
  };
  // A page just opened starts on the tab its address names, or on the first one.
  if (tabListeners.size === 0) {
    const wanted = window.location.hash.slice(1);
    const start: TabId = isTab(wanted) ? wanted : "articles";
    if (start !== openTab) {
      openTab = start;
      queueMicrotask(onChange);
    }
  }
  tabListeners.add(onChange);
  window.addEventListener("hashchange", fromAddress);
  return () => {
    tabListeners.delete(onChange);
    window.removeEventListener("hashchange", fromAddress);
  };
}

/**
 * The edition page: one bar that always says what to do next and holds the main
 * buttons, and the work split over five tabs. Every tab stays loaded, so
 * switching never loses what was typed in another one.
 */
export function Workspace({
  id,
  draft,
  pageCount,
  stale,
  articleCount,
  articles,
  foreword,
  cover,
  design,
  preview,
  runningJob,
}: {
  id: number;
  draft: boolean;
  /** null until a PDF exists. */
  pageCount: number | null;
  stale: boolean;
  articleCount: number;
  articles: ReactNode;
  foreword: ReactNode;
  cover: ReactNode;
  design: ReactNode;
  preview: ReactNode;
  /** A PDF run already going when the page was loaded: the page follows it. */
  runningJob: number | null;
}) {
  const [state, action, pending] = useJob<NonNullable<PdfState>>(createPdf, runningJob);
  const tab = useSyncExternalStore<TabId>(
    subscribeToTab,
    () => openTab,
    () => "articles",
  );
  const unsaved = useUnsaved();
  const hasPdf = pageCount !== null;

  // A freshly made PDF is what the person wants to look at next.
  const madeAt = state?.pages !== undefined ? state.at : undefined;
  useEffect(() => {
    if (madeAt !== undefined) open("preview");
  }, [madeAt]);

  const next: { tone: "amber" | "blue" | "green" | "neutral"; text: string } = !draft
    ? { tone: "green", text: "This edition is finished and locked. Read or download it under “Read and download”. Reopen it to change anything." }
    : pending
      ? { tone: "blue", text: "Creating the PDF. This takes up to a minute; the first time is slower because every photo is downloaded. You can leave this page: the PDF is made either way." }
      : unsaved
        ? { tone: "amber", text: "You have unsaved changes in the article list. Save or undo them before creating the PDF." }
        : articleCount === 0
          ? { tone: "amber", text: "No articles are included yet. Include some in the Articles tab." }
          : !hasPdf
            ? { tone: "blue", text: "Check the articles, the foreword and the order. Look through the pages under “Design the pages”, then create the PDF." }
            : stale
              ? { tone: "amber", text: "The edition was changed after the PDF was made. Create the PDF again to see the changes." }
              : { tone: "green", text: "The PDF is up to date. Read it under “Read and download”, then mark the edition as finished." };

  const tones = {
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    blue: "border-sky-300 bg-sky-50 text-sky-950",
    green: "border-green-300 bg-green-50 text-green-950",
    neutral: "border-neutral-300 bg-white text-neutral-900",
  };
  const panels: Record<TabId, ReactNode> = { articles, foreword, cover, design, preview };
  const badge: Partial<Record<TabId, string>> = {
    articles: unsaved ? "not saved" : String(articleCount),
    preview: !hasPdf ? "no PDF yet" : stale ? "out of date" : `${pageCount} pages`,
  };

  return (
    <>
      <div className="sticky top-0 z-20 -mx-6 mt-5 border-b border-neutral-200 bg-neutral-50/95 px-6 pb-0 pt-3 backdrop-blur">
        <div className={`flex flex-wrap items-center gap-3 rounded border px-4 py-3 ${tones[next.tone]}`}>
          <p className="min-w-64 flex-1 text-sm font-medium" role="status">
            {next.text}
            {pending && (
              <span className="ml-2 rounded bg-white/70 px-2 py-0.5">
                <Elapsed /> so far
              </span>
            )}
          </p>
          {draft && (
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <button
                type="submit"
                disabled={pending || unsaved || articleCount === 0}
                title={unsaved ? UNSAVED_MESSAGE : "Builds the magazine pages from the saved articles, foreword and cover"}
                className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? "Creating the PDF…" : hasPdf ? "Create the PDF again" : "Create the PDF"}
              </button>
            </form>
          )}
          <StatusButton id={id} finished={!draft} canFinish={hasPdf && !stale} />
          {draft && <DeleteDraftButton id={id} />}
        </div>

        {state?.error && !pending && (
          <p role="alert" className="mt-2 rounded bg-red-50 px-4 py-2 text-sm text-red-800">
            {state.error}
          </p>
        )}
        {state?.pages !== undefined && !pending && !stale && (
          <p role="status" className="mt-2 px-1 text-sm text-green-800">
            PDF created: {state.pages} pages{state.ms !== undefined && ` in ${formatDuration(state.ms)}`}.
            {state.notes && state.notes.length > 0 && ` ${state.notes.length} thing(s) to check are listed in the warnings below.`}
          </p>
        )}

        <div role="tablist" aria-label="Parts of this edition" className="mt-3 flex flex-wrap gap-1">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            const warn = (entry.id === "articles" && unsaved) || (entry.id === "preview" && hasPdf && stale);
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`tab-${entry.id}`}
                aria-selected={active}
                aria-controls={`panel-${entry.id}`}
                onClick={() => open(entry.id)}
                className={`-mb-px rounded-t border px-4 py-2 text-sm font-medium ${
                  active ? "border-neutral-300 border-b-white bg-white text-neutral-950" : "border-transparent text-neutral-600 hover:text-neutral-950"
                }`}
              >
                {entry.label}
                {badge[entry.id] && (
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs ${warn ? "bg-amber-200 text-amber-950" : "bg-neutral-200 text-neutral-700"}`}
                  >
                    {badge[entry.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {TABS.map((entry) => (
        <div key={entry.id} role="tabpanel" id={`panel-${entry.id}`} aria-labelledby={`tab-${entry.id}`} hidden={entry.id !== tab} className="pt-6">
          {panels[entry.id]}
        </div>
      ))}
    </>
  );
}
