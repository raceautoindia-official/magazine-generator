"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Choosing a month shows that month straight away; there is no separate button to press. */
export function MonthPicker({ month, max, previous, next }: { month: string; max: string; previous: string; next: string | null }) {
  const router = useRouter();
  const [loading, startLoading] = useTransition();
  const show = (value: string) => startLoading(() => router.push(`/?month=${value}`));
  const step = "h-10 w-10 rounded border border-neutral-300 bg-white text-lg leading-none hover:bg-neutral-100 disabled:opacity-30";

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => show(previous)} title="The month before" aria-label="The month before" className={step}>
        ‹
      </button>
      <input
        type="month"
        value={month}
        max={max}
        onChange={(event) => event.target.value && show(event.target.value)}
        aria-label="Month of the posts"
        className="h-10 rounded border border-neutral-300 bg-white px-3"
      />
      <button type="button" onClick={() => next && show(next)} disabled={!next} title="The month after" aria-label="The month after" className={step}>
        ›
      </button>
      {loading && <span className="text-sm text-neutral-600">Loading…</span>}
    </div>
  );
}
