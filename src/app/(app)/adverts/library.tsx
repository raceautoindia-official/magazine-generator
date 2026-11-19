"use client";

import { useActionState, useState } from "react";
import { ADVERT_SIZES, type AdvertSize } from "@/lib/advert-sizes";
import { uploadAdvert } from "./actions";
import { AdvertCard, type CardAdvert } from "./advert-card";
import { UploadForm } from "./upload-form";

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100"}`;

/** The library: a bar to upload, search and filter, the upload form when asked for, and one compact row per advert. */
export function Library({ adverts, drafts, canDescribe }: { adverts: CardAdvert[]; drafts: { id: number; label: string }[]; canDescribe: boolean }) {
  const [upload, uploadAction, uploading] = useActionState(uploadAdvert, undefined);
  // With nothing in the library the form is the page; otherwise it opens on request and stays out of the way.
  const [open, setOpen] = useState(adverts.length === 0);
  const [query, setQuery] = useState("");
  const [size, setSize] = useState<AdvertSize | "all">("all");
  const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");

  const current = adverts.filter((advert) => !advert.archived);
  const retired = adverts.length - current.length;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const inStatus = status === "all" ? adverts : adverts.filter((advert) => advert.archived === (status === "disabled"));
  const shown = inStatus.filter((advert) => {
    if (size !== "all" && advert.size !== size) return false;
    const text = [advert.advertiser, advert.summary, advert.product, advert.keywords.join(" "), advert.originalName].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const filtered = words.length > 0 || size !== "all" || status !== "all";
  const showForm = open || adverts.length === 0;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">
          Library{" "}
          <span className="font-normal text-neutral-600">
            ({current.length} enabled{retired > 0 && `, ${retired} disabled`})
          </span>
        </h2>
        {!showForm && (
          <button type="button" onClick={() => setOpen(true)} className="ml-auto rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
            + Upload an advert
          </button>
        )}
      </div>

      {showForm && <UploadForm state={upload} action={uploadAction} pending={uploading} canDescribe={canDescribe} onClose={adverts.length > 0 ? () => setOpen(false) : undefined} />}

      {adverts.length === 0 ? (
        <p className="mt-4 rounded border border-dashed border-neutral-400 bg-white p-6 text-center text-sm text-neutral-700">
          No adverts yet. Upload the first one above; it will be listed here, ready to be added to an edition.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-neutral-700">
            Switch an advert off with its <strong>Enabled</strong> switch and it is left out everywhere: it is not offered or suggested for any edition until you switch it on
            again. It stays in the library.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search advertiser, product or words in the description"
              aria-label="Search the library"
              className="w-full max-w-sm rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            />
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show sizes">
              <button type="button" onClick={() => setSize("all")} aria-pressed={size === "all"} className={chip(size === "all")}>
                All sizes
              </button>
              {ADVERT_SIZES.map((entry) => {
                const count = inStatus.filter((advert) => advert.size === entry.key).length;
                return (
                  <button key={entry.key} type="button" onClick={() => setSize(entry.key)} aria-pressed={size === entry.key} disabled={count === 0 && size !== entry.key} className={`${chip(size === entry.key)} disabled:opacity-40`}>
                    {entry.label} <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
            {retired > 0 && (
              <label className="ml-auto flex items-center gap-2 text-sm text-neutral-700">
                Show
                <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Show enabled or disabled adverts" className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm">
                  <option value="all">all adverts</option>
                  <option value="enabled">enabled only ({current.length})</option>
                  <option value="disabled">disabled only ({retired})</option>
                </select>
              </label>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="mt-4 rounded border border-dashed border-neutral-400 bg-white p-6 text-center text-sm text-neutral-700">
              No advert matches.{" "}
              {filtered && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSize("all");
                    setStatus("all");
                  }}
                  className="underline"
                >
                  Clear the search
                </button>
              )}
            </p>
          ) : (
            <ul className="mt-3 space-y-2" data-advert-list>
              {shown.map((advert) => (
                <AdvertCard key={advert.id} advert={advert} drafts={drafts} canDescribe={canDescribe} isNew={upload?.id === advert.id} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
