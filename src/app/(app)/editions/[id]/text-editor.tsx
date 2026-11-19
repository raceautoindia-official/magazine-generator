"use client";

import { useEffect, useRef, useState } from "react";
import { loadArticleText, resetArticleText, saveArticleText } from "./design-actions";

/** An article's pages as they are laid out: how many, which layout, and whether any text is cut off. */
export type PageShape = { pages: number; layout: string; cut: boolean };

type Block = { key: number; html: string };
type Loaded = { title: string; blocks: Block[]; edited: boolean; siteChanged: boolean; /** Words in the text when the editor opened. */ startWords: number };
type TrialWindow = Window & { __magazine?: { error?: string; layouts?: Record<string, string>; cut?: string[] } };

const plain = "rounded border border-neutral-400 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50";
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").trim().split(/\s+/).filter(Boolean).length;

/**
 * Lays the article out with text that is not saved yet, in a hidden copy of the page, and reports its pages.
 * The same script that lays out the PDF does the work, so the answer is what the PDF would show.
 */
function tryOut(editionId: number, articleId: number, title: string, paragraphs: string[]): Promise<PageShape> {
  return new Promise((resolve, reject) => {
    const name = `mg-trial-${Date.now()}`;
    const frame = document.createElement("iframe");
    frame.name = name;
    // Off screen but with a real size: the page measures its text to lay it out.
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1700px;height:1200px;border:0;visibility:hidden";
    const form = document.createElement("form");
    form.method = "post";
    form.action = `/editions/${editionId}/design/frame`;
    form.target = name;
    form.style.display = "none";
    for (const [field, value] of [["articleId", String(articleId)], ["title", title], ["paragraphs", JSON.stringify(paragraphs)]] as const) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = field;
      input.value = value;
      form.append(input);
    }
    const finish = (work: () => void) => {
      window.clearInterval(timer);
      frame.remove();
      form.remove();
      work();
    };
    let tries = 0;
    let submitted = false;
    const timer = window.setInterval(() => {
      const view = frame.contentWindow as TrialWindow | null;
      let report: TrialWindow["__magazine"];
      try {
        report = submitted ? view?.__magazine : undefined;
      } catch {
        report = undefined;
      }
      if (report && !report.error && view) {
        const section = view.document.querySelector<HTMLElement>("section.article");
        const post = section?.dataset.article ?? "";
        const shape = { pages: section?.querySelectorAll(".page").length ?? 0, layout: report.layouts?.[post] ?? "", cut: (report.cut ?? []).includes(post) };
        finish(() => (shape.pages > 0 ? resolve(shape) : reject(new Error("The article could not be laid out."))));
      } else if (report?.error || tries++ > 600) {
        finish(() => reject(new Error("The pages could not be laid out to check the change.")));
      }
    }, 100);
    document.body.append(frame, form);
    form.submit();
    submitted = true;
  });
}

/** Why a change cannot be kept, in words; null when the article's pages stay as they are. */
function objection(before: PageShape, after: PageShape): string | null {
  if (after.cut) return "With this text, part of the article no longer fits on its pages and would be cut off. Shorten the text.";
  if (after.pages > before.pages) {
    return `With this text the article needs ${after.pages} pages; it has ${before.pages} now. That would move every page after it. Shorten the text until it fits its ${before.pages} pages.`;
  }
  if (after.pages < before.pages) {
    return `With this text the article needs only ${after.pages} pages; it has ${before.pages} now. That would move every page after it. Keep more of the text so the article still fills its ${before.pages} pages.`;
  }
  if (after.layout !== before.layout) return "With this text the article would change to a different page layout. Keep the text closer to its present length.";
  return null;
}

/**
 * Headline and text of one article, edited for this edition. A change is kept only when the article's pages stay
 * as they are: the same number of pages, the same layout, nothing cut off.
 */
export function TextEditor({
  editionId,
  articleId,
  paragraph,
  shape,
  onClose,
}: {
  editionId: number;
  articleId: number;
  /** The paragraph that was clicked, to scroll to; null for the headline. */
  paragraph: number | null;
  /** The article's pages as they are now; null when that could not be read. */
  shape: PageShape | null;
  onClose: (saved: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "checking" | "saving" | "resetting">("");
  const [changed, setChanged] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const title = useRef<HTMLInputElement>(null);
  const boxes = useRef(new Map<number, HTMLDivElement>());
  const nextKey = useRef(0);

  useEffect(() => {
    let live = true;
    void loadArticleText(editionId, articleId).then((result) => {
      if (!live) return;
      if (!result.text) {
        setError(result.error ?? "The article's text could not be read.");
        return;
      }
      nextKey.current = result.text.paragraphs.length;
      const startWords = result.text.paragraphs.reduce((sum, html) => sum + words(html), 0);
      setCount(startWords);
      setLoaded({ title: result.text.title, blocks: result.text.paragraphs.map((html, key) => ({ key, html })), edited: result.text.edited, siteChanged: result.text.siteChanged, startWords });
    });
    return () => {
      live = false;
    };
  }, [editionId, articleId]);

  // Once the text is there, the paragraph that was clicked is brought into view.
  const shown = loaded !== null;
  useEffect(() => {
    if (!shown) return;
    const target = paragraph === null ? title.current : boxes.current.get(paragraph);
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  }, [shown, paragraph]);

  const current = () => (loaded ? loaded.blocks.map((block) => boxes.current.get(block.key)?.innerHTML ?? block.html) : []);
  const touched = () => {
    setChanged(true);
    setRefusal(null);
    setCount(current().reduce((sum, html) => sum + words(html), 0));
  };

  /** Keeps what was typed in the other paragraphs while one is added or taken away. */
  const rebuild = (change: (blocks: Block[]) => Block[]) => {
    if (!loaded) return;
    const html = current();
    setLoaded({ ...loaded, blocks: change(loaded.blocks.map((block, index) => ({ ...block, html: html[index] }))) });
    setChanged(true);
    setRefusal(null);
  };

  const apply = async () => {
    if (!loaded) return;
    const paragraphs = current().filter((html) => words(html) > 0);
    const headline = title.current?.value ?? loaded.title;
    setError(null);
    setRefusal(null);
    try {
      if (shape) {
        setBusy("checking");
        const after = await tryOut(editionId, articleId, headline, paragraphs);
        const why = objection(shape, after);
        if (why) {
          setRefusal(why);
          setBusy("");
          return;
        }
      }
      setBusy("saving");
      const result = await saveArticleText(editionId, articleId, headline, paragraphs);
      setBusy("");
      if (result.error) setError(result.error);
      else onClose(true);
    } catch (problem) {
      setBusy("");
      setError(problem instanceof Error ? problem.message : "The change could not be checked.");
    }
  };

  const back = async () => {
    if (!window.confirm("Go back to the post's own headline and text for this article? What was edited here is discarded.")) return;
    setBusy("resetting");
    const result = await resetArticleText(editionId, articleId);
    setBusy("");
    if (result.error) setError(result.error);
    else onClose(true);
  };

  const close = () => {
    if (changed && !window.confirm("Close without keeping your changes to this article?")) return;
    onClose(false);
  };

  const format = (command: "bold" | "italic") => {
    // The browser's own command: it works on the selection inside the paragraph being edited.
    document.execCommand(command);
    touched();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Edit the article's text" data-text-editor>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">Edit the article&apos;s text</h3>
            <p className="mt-0.5 text-sm text-neutral-700">For this edition only. The post on the website stays as it is.</p>
          </div>
          <button type="button" onClick={close} disabled={busy !== ""} className={plain}>
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p role="alert" className="mb-3 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {!loaded && !error && <p className="text-sm text-neutral-600">Reading the article…</p>}
          {loaded && (
            <>
              {loaded.siteChanged && (
                <p className="mb-3 rounded bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  The post on the website has changed since this article was edited here. This edition still prints the version below; “Back to the post&apos;s text” takes the website&apos;s
                  current version.
                </p>
              )}
              <p className="mb-3 rounded bg-neutral-100 px-4 py-3 text-sm text-neutral-800">
                A change is kept only if the article&apos;s pages stay as they are{shape ? ` (${shape.pages} pages)` : ""}: the same number of pages and nothing cut off. So wording can change
                freely, and the length only a little. The app checks when you press <strong>Apply</strong>.
              </p>

              <label className="block text-sm font-medium">
                Headline
                <input ref={title} defaultValue={loaded.title} maxLength={500} onInput={touched} className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-base font-bold" />
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <p className="mr-auto text-sm font-medium">
                  Text{" "}
                  <span className="font-normal text-neutral-600">
                    ({loaded.blocks.length} paragraphs{count !== null && `, ${count} words`}
                    {count !== null && count !== loaded.startWords && `; ${count > loaded.startWords ? "+" : "−"}${Math.abs(count - loaded.startWords)} from where you started`})
                  </span>
                </p>
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")} title="Make the selected words bold (Ctrl+B)" className={`${plain} font-bold`}>
                  B
                </button>
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")} title="Make the selected words italic (Ctrl+I)" className={`${plain} italic`}>
                  I
                </button>
              </div>

              <ol className="mt-2 space-y-2">
                {loaded.blocks.map((block, index) => (
                  <li key={block.key} className="group flex items-start gap-2">
                    <span className="mt-2 w-6 flex-none text-right text-xs tabular-nums text-neutral-500">{index + 1}</span>
                    <div
                      ref={(element) => {
                        if (element) boxes.current.set(block.key, element);
                        else boxes.current.delete(block.key);
                      }}
                      contentEditable
                      suppressContentEditableWarning
                      role="textbox"
                      aria-multiline="true"
                      aria-label={`Paragraph ${index + 1}`}
                      data-block={index}
                      onInput={touched}
                      onPaste={(event) => {
                        // Pasted text comes in plain, so no fonts, colours or links from elsewhere get into the magazine.
                        event.preventDefault();
                        document.execCommand("insertText", false, event.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
                      }}
                      onKeyDown={(event) => {
                        // Enter starts a new paragraph below instead of a line break inside this one.
                        if (event.key === "Enter") {
                          event.preventDefault();
                          rebuild((blocks) => [...blocks.slice(0, index + 1), { key: nextKey.current++, html: "" }, ...blocks.slice(index + 1)]);
                        }
                      }}
                      className={`min-h-10 flex-1 rounded border px-3 py-2 text-sm leading-relaxed focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600 ${
                        paragraph === index ? "border-violet-400 bg-violet-50" : "border-neutral-300"
                      }`}
                      dangerouslySetInnerHTML={{ __html: block.html }}
                    />
                    <div className="flex flex-none flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => rebuild((blocks) => [...blocks.slice(0, index + 1), { key: nextKey.current++, html: "" }, ...blocks.slice(index + 1)])}
                        title="Add a paragraph below this one"
                        aria-label={`Add a paragraph below paragraph ${index + 1}`}
                        className="h-7 w-7 rounded border border-neutral-300 text-sm hover:bg-neutral-100"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => rebuild((blocks) => blocks.filter((entry) => entry.key !== block.key))}
                        disabled={loaded.blocks.length <= 1}
                        title="Delete this paragraph"
                        aria-label={`Delete paragraph ${index + 1}`}
                        className="h-7 w-7 rounded border border-neutral-300 text-sm text-red-800 hover:bg-red-50 disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div className="border-t border-neutral-200 px-5 py-4">
          {refusal && (
            <p role="alert" className="mb-3 rounded bg-amber-50 px-4 py-3 text-sm text-amber-950" data-refusal>
              <strong>Not kept.</strong> {refusal}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void apply()} disabled={!loaded || busy !== "" || !changed} className="rounded bg-neutral-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy === "checking" ? "Checking the pages…" : busy === "saving" ? "Saving…" : "Apply"}
            </button>
            <button type="button" onClick={close} disabled={busy !== ""} className={plain}>
              Cancel
            </button>
            {loaded?.edited && (
              <button type="button" onClick={() => void back()} disabled={busy !== ""} className={`${plain} ml-auto`} title="Discard what was edited here and print the post as the website has it">
                Back to the post&apos;s text
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
