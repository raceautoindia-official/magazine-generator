"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/duration";

export type TimingStepView = { name: string; ms: number; by: "app" | "claude" | "openai" | "site"; detail?: string };
export type TimingRunView = { id: number; kind: "generate" | "pdf" | "foreword" | "advert"; label: string; totalMs: number; steps: TimingStepView[]; by: string | null; at: string };

const WHO: Record<TimingStepView["by"], { name: string; colour: string }> = {
  claude: { name: "Waiting for Claude", colour: "bg-orange-400" },
  openai: { name: "Waiting for OpenAI (cover picture)", colour: "bg-emerald-500" },
  site: { name: "Reading from the website", colour: "bg-sky-500" },
  app: { name: "The application's own work", colour: "bg-neutral-500" },
};
const KIND: Record<TimingRunView["kind"], string> = { generate: "Generating the draft", pdf: "Creating the PDF", foreword: "Writing the foreword", advert: "Placing adverts" };

/**
 * How long the application has worked on this edition. The chip shows the
 * total; hovering gives the split by kind of work; clicking opens every run
 * with its steps.
 */
export function ProcessingTime({ runs }: { runs: TimingRunView[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Close on a click elsewhere or on Escape, like a menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (runs.length === 0) return null;

  const total = runs.reduce((sum, run) => sum + run.totalMs, 0);
  const byKind = (Object.keys(KIND) as TimingRunView["kind"][])
    .map((kind) => ({ kind, runs: runs.filter((run) => run.kind === kind) }))
    .filter((entry) => entry.runs.length > 0)
    .map((entry) => ({ ...entry, ms: entry.runs.reduce((sum, run) => sum + run.totalMs, 0) }));
  const byWho = (Object.keys(WHO) as TimingStepView["by"][])
    .map((who) => ({ who, ms: runs.reduce((sum, run) => sum + run.steps.filter((step) => step.by === who).reduce((inner, step) => inner + step.ms, 0), 0) }))
    .filter((entry) => entry.ms > 0);
  const whoTotal = byWho.reduce((sum, entry) => sum + entry.ms, 0) || 1;
  const hover = byKind.map((entry) => `${KIND[entry.kind]}: ${formatDuration(entry.ms)}${entry.runs.length > 1 ? ` (${entry.runs.length} times)` : ""}`).join("\n");

  return (
    <div ref={box} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={`${hover}\n\nClick for every step`}
        className={`rounded-full border px-3 py-1 text-sm ${open ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500"}`}
      >
        <span aria-hidden>⏱</span> Processing time: <span className="font-medium tabular-nums">{formatDuration(total)}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Processing time of this edition"
          className="absolute left-0 top-full z-40 mt-2 max-h-[70vh] w-[34rem] max-w-[90vw] overflow-y-auto rounded-lg border border-neutral-300 bg-white p-4 text-sm shadow-xl"
        >
          <p className="font-bold">The application has worked {formatDuration(total)} on this edition</p>
          <p className="mt-1 text-neutral-700">
            This is the time you waited for it, added up over {runs.length} {runs.length === 1 ? "run" : "runs"}. Your own time reviewing is not counted.
          </p>

          <div className="mt-3 flex h-3 overflow-hidden rounded bg-neutral-200" aria-hidden>
            {byWho.map((entry) => (
              <div key={entry.who} className={WHO[entry.who].colour} style={{ width: `${(entry.ms / whoTotal) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {byWho.map((entry) => (
              <li key={entry.who} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 flex-none rounded-sm ${WHO[entry.who].colour}`} aria-hidden />
                <span className="flex-1">{WHO[entry.who].name}</span>
                <span className="tabular-nums text-neutral-700">{formatDuration(entry.ms)}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-4 border-t border-neutral-200 pt-3 font-bold">Every run, newest first</h3>
          <ul className="mt-1 divide-y divide-neutral-200">
            {runs.map((run) => {
              const shown = expanded === run.id;
              const longest = Math.max(...run.steps.map((step) => step.ms), 1);
              return (
                <li key={run.id} className="py-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(shown ? null : run.id)}
                    aria-expanded={shown}
                    title={shown ? "Hide the steps" : "Show the steps of this run"}
                    className="flex w-full items-baseline gap-2 text-left hover:text-neutral-950"
                  >
                    <span aria-hidden className="w-3 text-neutral-500">
                      {shown ? "▾" : "▸"}
                    </span>
                    <span className="flex-1">
                      <span className="font-medium">{run.label}</span>
                      <span className="block text-xs text-neutral-600">
                        {run.at.slice(0, 16)}
                        {run.by ? ` · ${run.by}` : ""}
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">{formatDuration(run.totalMs)}</span>
                  </button>
                  {shown && (
                    <ol className="mt-2 space-y-1.5 pl-5">
                      {run.steps.map((step, index) => (
                        <li key={index}>
                          <div className="flex items-baseline gap-2">
                            <span className={`h-2 w-2 flex-none translate-y-[-1px] rounded-sm ${WHO[step.by].colour}`} title={WHO[step.by].name} />
                            <span className="flex-1">{step.name}</span>
                            <span className="tabular-nums text-neutral-700">{formatDuration(step.ms)}</span>
                          </div>
                          {step.detail && <p className="pl-4 text-xs text-neutral-600">{step.detail}</p>}
                          <div className="ml-4 mt-0.5 h-1 rounded bg-neutral-100" aria-hidden>
                            <div className={`h-1 rounded ${WHO[step.by].colour}`} style={{ width: `${Math.max(1, (step.ms / longest) * 100)}%` }} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
