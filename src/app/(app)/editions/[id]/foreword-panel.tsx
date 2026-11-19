"use client";

import { useActionState, useState } from "react";
import { formatDuration } from "@/lib/duration";
import { Elapsed } from "../../elapsed";
import { askForForeword, storeForeword } from "./actions";

/** Roughly what fits on the foreword page before the text gets small. */
const COMFORTABLE_WORDS = 250;
const MOST_WORDS = 350;

export function ForewordPanel({
  id,
  initial,
  canWrite,
  locked,
}: {
  id: number;
  initial: string;
  canWrite: boolean;
  /** A finished edition cannot be changed. */
  locked: boolean;
}) {
  const [written, write, writing] = useActionState(askForForeword, undefined);
  const [saved, save, saving] = useActionState(storeForeword, undefined);
  const [text, setText] = useState(initial);
  /** The text as it is stored, to tell whether the box has changes. */
  const [stored, setStored] = useState(initial);
  const [seen, setSeen] = useState<string | undefined>(undefined);

  // Show Claude's text in the box as soon as it arrives; it is already stored.
  if (written?.text !== undefined && written.text !== seen) {
    setSeen(written.text);
    setText(written.text);
    setStored(written.text);
  }
  if (initial !== stored && !writing && !saving && text === stored) {
    setStored(initial);
    setText(initial);
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const busy = writing || saving;
  const changed = text.trim() !== stored.trim();
  const length =
    words === 0
      ? { tone: "text-neutral-600", note: "Empty: a short automatic summary is printed instead." }
      : words > MOST_WORDS
        ? { tone: "text-red-800 font-medium", note: `Too long for the page: about ${MOST_WORDS} words fit. The end would be cut off.` }
        : words > COMFORTABLE_WORDS
          ? { tone: "text-amber-800", note: "Fits, but the text will be printed smaller." }
          : { tone: "text-green-800", note: "A good length for the page." };

  if (locked) {
    return (
      <section className="rounded border border-neutral-300 bg-white p-5">
        <h2 className="text-lg font-bold">Foreword</h2>
        {initial ? (
          <div className="mt-3 max-w-3xl space-y-3 text-sm leading-relaxed">
            {initial.split(/\n\s*\n/).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-700">No foreword was written; the short automatic summary was printed.</p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded border border-neutral-300 bg-white p-5">
      <h2 className="text-lg font-bold">Foreword</h2>
      <p className="mt-1 max-w-3xl text-sm text-neutral-700">
        Printed on page 3 under “Dear Readers”, signed by the director. Claude can write it from this edition&apos;s articles,
        and you can edit it or type your own. Leave a blank line between paragraphs.
      </p>

      <form
        action={write}
        className="mt-4"
        onSubmit={(event) => {
          // Writing again replaces what is in the box, including changes made by hand.
          if (text.trim() && !window.confirm("Replace the current foreword with a new one written by Claude?")) event.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={busy || !canWrite}
          title={canWrite ? "Claude reads the included articles and writes 170 to 230 words" : "No Anthropic API key is set on the server"}
          className="rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
        >
          {writing ? "Claude is writing, about 20 seconds…" : text ? "Write a new one with Claude" : "Write with Claude"}
        </button>
        {writing && (
          <span className="ml-3 text-sm text-neutral-700">
            <Elapsed /> so far
          </span>
        )}
        {!canWrite && <span className="ml-3 text-sm text-neutral-700">Not available: no Anthropic API key is set on the server.</span>}
      </form>

      <form action={save} className="mt-4">
        <input type="hidden" name="id" value={id} />
        <textarea
          name="foreword"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={14}
          aria-label="Foreword text"
          placeholder="Type the foreword here, or let Claude write it."
          className="w-full max-w-4xl rounded border border-neutral-300 p-4 text-sm leading-relaxed"
        />
        <p className={`mt-1 text-sm ${length.tone}`}>
          {words} words. {length.note}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !changed}
            title={changed ? undefined : "Nothing has changed since the last save"}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => setStored(text)}
          >
            {saving ? "Saving…" : "Save the foreword"}
          </button>
          {changed && !busy && (
            <>
              <button
                type="button"
                onClick={() => setText(stored)}
                className="rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100"
              >
                Undo changes
              </button>
              <span className="text-sm text-amber-800">Not saved yet.</span>
            </>
          )}
        </div>
      </form>

      {(written?.error || saved?.error) && !busy && (
        <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {written?.error || saved?.error}
        </p>
      )}
      {written?.text !== undefined && !writing && !changed && text === written.text && (
        <p role="status" className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-900">
          Written and saved{written.ms !== undefined && ` in ${formatDuration(written.ms)}`}. Read it before printing: it is built only from this edition&apos;s articles, but check the names
          and figures. Create the PDF again to see it on page 3.
        </p>
      )}
      {saved?.saved && !saving && !changed && text !== written?.text && (
        <p role="status" className="mt-3 text-sm text-green-800">
          Saved. Create the PDF again to see it on page 3.
        </p>
      )}
    </section>
  );
}
