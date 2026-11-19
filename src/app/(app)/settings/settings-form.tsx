"use client";

import { useActionState, useEffect, useState } from "react";
import type { Settings } from "@/lib/settings-schema";
import { updateSettings } from "./actions";

const COUNT_FIELDS = [
  { key: "minimum", label: "Minimum articles", help: "An edition with fewer gets a warning." },
  { key: "recommended", label: "Usual number of articles", help: "Taken automatically when available." },
  { key: "maximum", label: "Maximum articles", help: "More than this gets a warning." },
  { key: "minimumWords", label: "Shortest post, in words", help: "Shorter posts are not offered." },
  { key: "maximumWords", label: "Longest post, in words", help: "Longer posts are only included by hand." },
] as const;

const iconButton =
  "flex h-8 w-8 items-center justify-center rounded border border-neutral-300 bg-white text-base leading-none hover:bg-neutral-100 disabled:opacity-30";
const field = "mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm";

/** A list of words edited as text: one box, words separated by commas, stored when the box is left. */
function Words({ value, onChange, label }: { value: string[]; onChange: (words: string[]) => void; label: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <textarea
        key={value.join("|")}
        defaultValue={value.join(", ")}
        rows={2}
        onBlur={(event) =>
          onChange([
            ...new Set(
              event.target.value
                .split(/[,\n]/)
                .map((word) => word.trim().toLowerCase())
                .filter(Boolean),
            ),
          ])
        }
        className={field}
      />
    </label>
  );
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const [state, action, pending] = useActionState(updateSettings, undefined);
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [saved, setSaved] = useState(() => JSON.stringify(initial, null, 2));
  const [seen, setSeen] = useState<number | undefined>(undefined);

  // Every control below edits the same text the "all rules" box shows, so there is one source of truth.
  let parsed: Settings | null = null;
  try {
    parsed = JSON.parse(text) as Settings;
  } catch {
    parsed = null;
  }
  const update = (change: (settings: Settings) => Settings) => parsed && setText(JSON.stringify(change(parsed), null, 2));

  if (state?.saved !== undefined && state.saved !== seen) {
    setSeen(state.saved);
    setSaved(text);
  }
  const dirty = text !== saved;

  // Ask before the page is left with changes that would be lost.
  useEffect(() => {
    if (!dirty) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);

  const moveIn = (group: "sections" | "types", index: number, to: number) =>
    update((settings) => {
      const list: string[] = [...settings.ordering[group]];
      if (to < 0 || to >= list.length) return settings;
      const [entry] = list.splice(index, 1);
      list.splice(to, 0, entry);
      return { ...settings, ordering: { ...settings.ordering, [group]: list } } as Settings;
    });

  const typeLabel = (key: string) => parsed?.types?.find((type) => type.key === key)?.label ?? `${key} (not in the type list)`;
  const sectionLabel = (key: string) => (key === "national" ? "National (India)" : "International");

  const orderList = (group: "sections" | "types", labelOf: (key: string) => string) => {
    const list: string[] = Array.isArray(parsed?.ordering?.[group]) ? parsed.ordering[group] : [];
    return (
      <ol className="mt-2 max-w-xl divide-y divide-neutral-200 rounded border border-neutral-300 bg-white">
        {list.map((key, index) => (
          <li key={key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="w-6 text-right tabular-nums text-neutral-600">{index + 1}</span>
            <span className="flex-1">{labelOf(key)}</span>
            {list.length > 2 && (
              <button type="button" onClick={() => moveIn(group, index, 0)} disabled={index === 0} title="Move to the top" aria-label={`Move ${labelOf(key)} to the top`} className={iconButton}>
                ⤒
              </button>
            )}
            <button type="button" onClick={() => moveIn(group, index, index - 1)} disabled={index === 0} title="Move up one place" aria-label={`Move ${labelOf(key)} up`} className={iconButton}>
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveIn(group, index, index + 1)}
              disabled={index === list.length - 1}
              title="Move down one place"
              aria-label={`Move ${labelOf(key)} down`}
              className={iconButton}
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
    );
  };

  return (
    <form action={action} className="mt-6 space-y-10 pb-24">
      <section>
        <h2 className="text-lg font-bold">How many articles</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
          {COUNT_FIELDS.map((entry) => (
            <label key={entry.key} className="block">
              <span className="text-sm font-medium">{entry.label}</span>
              <input
                type="number"
                min={0}
                disabled={!parsed}
                value={parsed?.counts?.[entry.key] ?? ""}
                onChange={(event) => update((settings) => ({ ...settings, counts: { ...settings.counts, [entry.key]: Number(event.target.value) } }))}
                className={`${field} disabled:bg-neutral-100`}
              />
              <span className="mt-1 block text-xs text-neutral-600">{entry.help}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold">Order of the articles</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-700">
          A new edition is laid out section by section, and inside each section by type, in the order below. Move entries with
          the arrows. You can still reorder single articles on each edition&apos;s page.
        </p>
        <div className="mt-3 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-bold">Sections</h3>
            {orderList("sections", sectionLabel)}
          </div>
          <div>
            <h3 className="text-sm font-bold">Types inside a section</h3>
            {orderList("types", typeLabel)}
          </div>
        </div>
      </section>

      {parsed?.verticals && (
        <section>
          <h2 className="text-lg font-bold">Editions</h2>
          <p className="mt-1 max-w-3xl text-sm text-neutral-700">
            The keywords pull posts from shared categories (Tech, Auto Comp, Business) into an edition when they appear in the
            headline or tags. Separate words with commas.
          </p>
          <div className="mt-3 space-y-2">
            {parsed.verticals.map((vertical, index) => {
              const set = (patch: Partial<Settings["verticals"][number]>) =>
                update((settings) => ({ ...settings, verticals: settings.verticals.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)) }));
              return (
                <details key={vertical.key} className="rounded border border-neutral-300 bg-white">
                  <summary className="cursor-pointer px-4 py-2.5 font-medium">
                    {vertical.label} <span className="font-normal text-neutral-600">· {vertical.keywords.length} keywords</span>
                  </summary>
                  <div className="grid gap-4 border-t border-neutral-200 p-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium">Name</span>
                      <input value={vertical.label} onChange={(event) => set({ label: event.target.value })} className={field} />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">Line under E-MAGAZINE on the cover</span>
                      <input value={vertical.coverSubtitle} onChange={(event) => set({ coverSubtitle: event.target.value })} className={field} />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-sm font-medium">Report advertised on page 2</span>
                      <input value={vertical.reportAdvert} onChange={(event) => set({ reportAdvert: event.target.value })} className={field} />
                    </label>
                    <div className="md:col-span-2">
                      <Words label="Keywords" value={vertical.keywords} onChange={(keywords) => set({ keywords })} />
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {parsed?.types && (
        <section>
          <h2 className="text-lg font-bold">Article types</h2>
          <p className="mt-1 max-w-3xl text-sm text-neutral-700">
            Claude reads each article and picks the type whose description fits best. The headline words are only used when
            Claude is not available. Changing a description makes Claude read the posts again at the next Generate.
          </p>
          <div className="mt-3 space-y-2">
            {parsed.types.map((type, index) => {
              const set = (patch: Partial<Settings["types"][number]>) =>
                update((settings) => ({ ...settings, types: settings.types.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)) }));
              return (
                <details key={type.key} className="rounded border border-neutral-300 bg-white">
                  <summary className="cursor-pointer px-4 py-2.5 font-medium">
                    {type.label} <span className="font-normal text-neutral-600">· {type.description || "no description"}</span>
                  </summary>
                  <div className="grid gap-4 border-t border-neutral-200 p-4">
                    <label className="block max-w-md">
                      <span className="text-sm font-medium">Name</span>
                      <input value={type.label} onChange={(event) => set({ label: event.target.value })} className={field} />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">What it means (read by Claude)</span>
                      <input value={type.description ?? ""} onChange={(event) => set({ description: event.target.value })} className={field} />
                    </label>
                    {type.key !== "other" && <Words label="Headline words (fallback when Claude is not available)" value={type.keywords} onChange={(keywords) => set({ keywords })} />}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <details className="rounded border border-neutral-300 bg-white">
          <summary className="cursor-pointer px-4 py-2.5 font-medium">
            Advanced: all rules as text <span className="font-normal text-neutral-600">· category numbers, section labels, AI models</span>
          </summary>
          <div className="border-t border-neutral-200 p-4">
            <p className="text-sm text-neutral-700">
              Everything above, plus the category numbers of each edition and type, as one text. It is checked before saving and
              nothing is saved if it has a mistake.
            </p>
            <textarea
              name="settings"
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              rows={28}
              className="mt-3 w-full rounded border border-neutral-300 bg-white p-3 font-mono text-xs"
            />
            {!parsed && <p className="mt-1 text-sm text-red-800">This is not valid yet: check for a missing comma, quote or bracket.</p>}
          </div>
        </details>
      </section>

      {/* Always in view, so a change is never left unsaved by accident. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-300 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-3">
          <button
            type="submit"
            disabled={pending || !parsed || !dirty}
            title={!dirty ? "Nothing has changed" : undefined}
            className="rounded bg-neutral-900 px-5 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save settings"}
          </button>
          {dirty && !pending && (
            <button type="button" onClick={() => setText(saved)} className="rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100">
              Undo changes
            </button>
          )}
          <div className="min-w-0 flex-1 text-sm">
            {state?.errors && !pending ? (
              <div role="alert" className="text-red-800">
                <span className="font-medium">Not saved: </span>
                {state.errors.join(" · ")}
              </div>
            ) : dirty ? (
              <span className="text-amber-800">You have changes that are not saved yet.</span>
            ) : state?.saved ? (
              <span role="status" className="text-green-800">
                Saved. New editions use these rules; on an existing draft, “Put in standard order” applies a changed order.
              </span>
            ) : (
              <span className="text-neutral-600">No changes.</span>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
