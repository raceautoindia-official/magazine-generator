"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useJob } from "./use-job";
import { Elapsed } from "./elapsed";
import { generate, type Generated } from "./actions";

export type PreviewRow = {
  key: string;
  label: string;
  byCategory: number;
  byWords: number;
  general: number;
  national: number;
  international: number;
  included: number;
  /** Editions already made for this month, newest first. */
  existing: { id: number; finished: boolean }[];
};

export function GenerateForm({
  month,
  editionName,
  rows,
  minimum,
  recommended,
  runningJob,
}: {
  month: string;
  /** For example "September 2026": the edition these posts become. */
  editionName: string;
  rows: PreviewRow[];
  minimum: number;
  recommended: number;
  /** A generate run for this month already going when the page was loaded. */
  runningJob: number | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useJob<Generated>(generate, runningJob);
  // When the drafts are ready: straight to the one that was made, or to the month's list when there are several.
  const made = state?.ids;
  const madeFor = state?.month;
  useEffect(() => {
    if (made && made.length > 0) router.push(made.length === 1 ? `/editions/${made[0]}` : `/?month=${madeFor}`);
  }, [made, madeFor, router]);
  const [ticked, setTicked] = useState<string[]>([]);
  const usable = rows.filter((row) => row.included > 0).map((row) => row.key);
  const all = usable.length > 0 && usable.every((key) => ticked.includes(key));
  const again = rows.filter((row) => ticked.includes(row.key) && row.existing.length > 0).map((row) => row.label);

  const toggle = (key: string) => setTicked((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));

  return (
    <form
      action={action}
      className="mt-3"
      onSubmit={(event) => {
        if (again.length > 0 && !window.confirm(`${again.join(", ")} already ${again.length === 1 ? "has" : "have"} an edition for this month. Make another draft as well? The existing one is kept.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="month" value={month} />
      <table className="w-full border-collapse overflow-hidden rounded border border-neutral-300 bg-white text-sm">
        <thead>
          <tr className="border-b border-neutral-300 bg-neutral-100 text-left">
            <th className="px-3 py-2">
              <label className="flex items-center gap-2" title="Tick or untick every edition that has posts">
                <input
                  type="checkbox"
                  checked={all}
                  disabled={usable.length === 0}
                  onChange={() => setTicked(all ? [] : usable)}
                  className="h-4 w-4"
                />
                Edition
              </label>
            </th>
            <th className="px-3 py-2 text-right" title="How many posts would be printed">
              Articles
            </th>
            <th className="px-3 py-2 text-right" title="Posts from India, and posts from other markets">
              India / International
            </th>
            <th className="px-3 py-2">Enough for a magazine?</th>
            <th className="px-3 py-2">Already made</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status =
              row.included === 0
                ? { text: "No posts this month", tone: "bg-neutral-200 text-neutral-700" }
                : row.included >= recommended
                  ? { text: "Yes, a full edition", tone: "bg-green-100 text-green-950" }
                  : row.included >= minimum
                    ? { text: `Yes (the usual size is ${recommended})`, tone: "bg-green-50 text-green-950" }
                    : { text: `Thin: ${minimum - row.included} short of the minimum of ${minimum}`, tone: "bg-amber-100 text-amber-950" };
            return (
              <tr key={row.key} className="border-b border-neutral-200 last:border-0">
                <td className="px-3 py-2.5">
                  <label className={`flex items-center gap-2 font-medium ${row.included === 0 ? "text-neutral-500" : ""}`}>
                    <input
                      type="checkbox"
                      name="vertical"
                      value={row.key}
                      checked={ticked.includes(row.key)}
                      disabled={row.included === 0}
                      onChange={() => toggle(row.key)}
                      className="h-4 w-4"
                    />
                    {row.label}
                  </label>
                </td>
                <td
                  className="px-3 py-2.5 text-right font-medium tabular-nums"
                  title={`${row.byCategory} by category, ${row.byWords} placed by keywords or Claude, ${row.general} general posts available as filler`}
                >
                  {row.included}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {row.national} / {row.international}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>{status.text}</span>
                </td>
                <td className="px-3 py-2.5">
                  {row.existing.length === 0 ? (
                    <span className="text-neutral-500">Not yet</span>
                  ) : (
                    row.existing.map((edition, index) => (
                      <Link key={edition.id} href={`/editions/${edition.id}`} className="mr-3 underline">
                        {edition.finished ? "Finished" : "Draft"}
                        {row.existing.length > 1 ? ` ${row.existing.length - index}` : ""}, open
                      </Link>
                    ))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {state?.error && (
        <p role="alert" className="mt-3 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending || ticked.length === 0}
          title={ticked.length === 0 ? "Tick at least one edition first" : undefined}
          className="rounded bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {pending
            ? "Generating…"
            : ticked.length === 0
              ? "Generate"
              : `Generate ${ticked.length} ${ticked.length === 1 ? "edition" : "editions"} for ${editionName}`}
        </button>
        <p className="text-sm text-neutral-700">
          {pending
            ? (
                <>
                  Claude is reading the month&apos;s posts to sort them. This takes up to a minute the first time. <Elapsed className="font-medium" /> so far.
                </>
              )
            : ticked.length === 0
              ? "Tick the editions you want to make. Nothing is generated until you press the button."
              : "Each becomes a draft you can review and change before anything is printed."}
        </p>
      </div>
    </form>
  );
}
