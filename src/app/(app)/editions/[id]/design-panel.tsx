"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Elapsed } from "../../elapsed";
import { useJob } from "../../use-job";
import { paintAiCover } from "./actions";
import { dragFraming, framingCss, MAX_ZOOM, tidyFraming, type Framing } from "@/lib/framing";
import { chooseFramePicture, frameChoices, reportDesignWait, resetArticleText, resetFrameAt, saveFrameAt, uploadPicture, type PictureChoice } from "./design-actions";
import { TextEditor, type PageShape } from "./text-editor";
import { useUnsaved } from "./unsaved";

export type DesignChange = {
  kind: "frame" | "text";
  /** The frame key, or the article row id as text. */
  id: string;
  /** What was changed, in words. */
  what: string;
  article: string;
  /** For a text change: the website's version has changed since. */
  siteChanged?: boolean;
};

/** Two A4 pages side by side, and one page's height, in CSS pixels. */
const SPREAD_WIDTH = (420 * 96) / 25.4;
const PAGE_HEIGHT = (297 * 96) / 25.4;

const FRAME_NAMES: Record<string, string> = {
  cover: "Cover picture",
  spread: "Opening photo",
  photo: "Full-page photo",
  tail: "Photo under the text",
  band: "Photo beside the advert",
};
const frameName = (key: string) => FRAME_NAMES[key === "cover" ? "cover" : key.split(":")[1]] ?? "Photo";

/** Added to the magazine page while it is shown here: pages side by side as spreads, and what shows that things can be edited. */
const VIEW_CSS = `
html { background: #52525b; overflow: hidden; }
body { display: grid; grid-template-columns: 210mm 210mm; width: 420mm; background: transparent; transform-origin: 0 0; }
.article, .variant { display: contents; }
.page.cover { grid-column: 2; }
.page { break-after: auto; }
.page.mg-away { display: none; }
`;
const EDIT_CSS = `
img[data-frame] { cursor: grab; }
img[data-frame]:hover { outline: 1.2mm solid #7c3aed; outline-offset: -1.2mm; }
img[data-frame].mg-on { outline: 1.6mm solid #7c3aed; outline-offset: -1.6mm; cursor: grabbing; }
[data-p], [data-title] { cursor: text; }
[data-p]:hover, [data-title]:hover { outline: 0.6mm dashed #7c3aed; outline-offset: 0.8mm; background: rgba(124, 58, 237, 0.08); }
.mg-shade-spread::after, .mg-shade-portrait::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.mg-shade-spread::after { background: linear-gradient(to bottom, rgba(0,0,0,0) 50%, rgba(0,0,0,0.93)); }
.mg-shade-portrait::after { background: linear-gradient(to bottom, rgba(0,0,0,0) 80%, rgba(0,0,0,0.6)); }
.headline, .article-logo { z-index: 2; }
`;

/** Which ways a picture has more of itself to show at its present zoom. */
type Room = { x: boolean; y: boolean };
type Selected = { key: string; article: string; framing: Framing; canChange: boolean; edited: boolean; room: Room | null };
type FrameWindow = Window & { __magazine?: { error?: string; layouts?: Record<string, string>; cut?: string[] } };
type Size = "fit" | "width" | "real";

const imagesOf = (doc: Document, key: string) => Array.from(doc.querySelectorAll<HTMLImageElement>(`img[data-frame="${key}"]`));
const framingOf = (image: HTMLImageElement): Framing => tidyFraming({ x: Number(image.dataset.x), y: Number(image.dataset.y), zoom: Number(image.dataset.zoom) });
/** The spread a page is on: the cover is alone on the first, then pages 2-3, 4-5 and so on. */
const spreadOf = (pageIndex: number) => Math.floor((pageIndex + 1) / 2);

/** The frame's own size on screen: the picture's box without the zoom the picture itself carries. */
function frameBox(image: HTMLImageElement, zoom: number) {
  const box = image.getBoundingClientRect();
  return { width: box.width / zoom, height: box.height / zoom };
}

function roomOf(image: HTMLImageElement, framing: Framing): Room | null {
  if (!image.dataset.live || !image.naturalWidth) return null;
  const frame = frameBox(image, framing.zoom);
  const fit = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight) * framing.zoom;
  return { x: image.naturalWidth * fit - frame.width > 1, y: image.naturalHeight * fit - frame.height > 1 };
}

/**
 * A cut picture is swapped for the whole one, placed by CSS at the same framing, so it can be moved and zoomed
 * at once. The dark gradient that is part of the cut picture is drawn over it meanwhile.
 */
async function makeLive(doc: Document, key: string): Promise<void> {
  for (const image of imagesOf(doc, key)) {
    if (image.dataset.live) continue;
    const full = image.dataset.full;
    if (full && image.getAttribute("src") !== full) {
      image.src = full;
      await image.decode().catch(() => undefined);
    }
    image.style.cssText += ";" + framingCss(framingOf(image));
    if (image.dataset.shade) image.parentElement?.classList.add(`mg-shade-${image.dataset.shade}`);
    image.dataset.live = "1";
  }
}

function applyFraming(doc: Document, key: string, framing: Framing): void {
  for (const image of imagesOf(doc, key)) {
    image.dataset.x = String(framing.x);
    image.dataset.y = String(framing.y);
    image.dataset.zoom = String(framing.zoom);
    image.style.cssText = image.style.cssText.replace(/object-fit:[^;]*;?|object-position:[^;]*;?|transform:[^;]*;?|transform-origin:[^;]*;?/g, "") + ";" + framingCss(framing);
  }
}

/** What to tell the person about moving this picture, given where it has room. */
function moveHint(room: Room | null, zoom: number): string {
  if (!room) return "Drag the photo to choose which part of it shows.";
  if (room.x && room.y) return "Drag the photo, or use the arrow keys, to choose which part of it shows.";
  if (room.x) return "This picture is exactly as tall as its frame, so it moves left and right only. Zoom in to move it up and down too.";
  if (room.y) return "This picture is exactly as wide as its frame, so it moves up and down only. Zoom in to move it sideways too.";
  return zoom <= 1.001 ? "The whole picture is already in the frame, so there is nowhere to move it. Zoom in first." : "Drag the photo to choose which part of it shows.";
}

/**
 * The magazine as it will print, one spread at a time: pictures are moved and zoomed in their frames, text is
 * edited in a side panel. Every change is saved as it is made, for this edition only.
 */
export function DesignPanel({
  id,
  draft,
  hasArticles,
  changes,
  articles,
  version,
  coverJob,
  canPaint,
}: {
  id: number;
  draft: boolean;
  hasArticles: boolean;
  changes: DesignChange[];
  /** Included articles in page order, for "Go to". */
  articles: { rowId: number; title: string }[];
  /** Changes whenever something outside this tab changes what the pages show (articles, adverts, foreword, cover). */
  version: string;
  /** The AI cover is being painted already (started from this tab, perhaps in another window). */
  coverJob: number | null;
  /** An OpenAI key is set, so an AI cover can be painted. */
  canPaint: boolean;
}) {
  const router = useRouter();
  const unsaved = useUnsaved();
  const [painted, paint, painting] = useJob<{ painted: boolean; note: string | null }>(paintAiCover, coverJob);
  const holder = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // The page is heavy (every photo of the magazine), so it is loaded when this tab is first opened, not with the edition.
  const [wanted, setWanted] = useState(false);
  /** This tab is the one on screen. */
  const [visible, setVisible] = useState(false);
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed" | "signed-out">("loading");
  /** The version of the edition the pages on screen were built from. */
  const [shownVersion, setShownVersion] = useState(version);
  /** The pages must be built again as soon as nothing is being edited (the AI cover has arrived). */
  const [again, setAgain] = useState(false);
  const [seenPaint, setSeenPaint] = useState<number | undefined>(undefined);
  /** The cover is to be an AI picture that is not painted yet. */
  const [coverPending, setCoverPending] = useState(false);
  const [box, setBox] = useState({ width: 900, height: 640 });
  /** One spread at a time, like turning pages, or every page below the other. */
  const [view, setView] = useState<"spread" | "all">("spread");
  const [size, setSize] = useState<Size>("fit");
  const [spread, setSpread] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [onSpread, setOnSpread] = useState("");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [saved, setSaved] = useState<"" | "saving" | "saved">("");
  const [message, setMessage] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{ key: string; choices: PictureChoice[] | null; busy: boolean } | null>(null);
  const [editing, setEditing] = useState<{ articleId: number; paragraph: number | null; shape: PageShape | null } | null>(null);
  const editable = draft && !unsaved;
  const spreads = pageCount > 0 ? Math.floor(pageCount / 2) + 1 : 0;

  // The AI cover has been painted (or could not be): the pages are built again to show it.
  if (painted?.at !== undefined && painted.at !== seenPaint) {
    setSeenPaint(painted.at);
    if (!painted.error) setAgain(true);
  }
  // Something changed outside this tab, or the cover arrived. The pages are built again by themselves, but never
  // under the person's hands: while a photo or a text is being edited it waits until that is finished.
  const outdated = version !== shownVersion || again;
  if (outdated && visible && wanted && selected === null && chooser === null && editing === null) {
    setShownVersion(version);
    setAgain(false);
    setStatus("loading");
    setSaved("");
    setReload((count) => count + 1);
  }

  /** Fits the pages to the room there is and gives the frame the size of what it shows. */
  const fit = useCallback(() => {
    const doc = frame.current?.contentDocument;
    const width = holder.current?.clientWidth;
    if (!doc?.body || !width) return;
    // Under the bar that stays at the top of the window and this tab's own controls.
    const header = document.querySelector<HTMLElement>('[role="tablist"]')?.parentElement?.offsetHeight ?? 160;
    if (controls.current) controls.current.style.top = `${header}px`;
    const room = window.innerHeight - header - (controls.current?.offsetHeight ?? 110) - 28;
    const wanted = size === "real" ? 1 : size === "fit" && view === "spread" ? Math.min(width / SPREAD_WIDTH, room / PAGE_HEIGHT) : width / SPREAD_WIDTH;
    const scale = Math.max(0.3, Math.min(1, wanted));
    doc.body.style.transform = `scale(${scale})`;
    doc.body.style.rowGap = view === "all" ? "7mm" : "0";
    setBox({ width: Math.round(SPREAD_WIDTH * scale), height: Math.ceil(doc.body.getBoundingClientRect().height) });
  }, [size, view]);

  /** Shows the pages of one spread (or all of them) and says which article they belong to. */
  const show = useCallback(
    (index: number) => {
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
      pages.forEach((page, pageIndex) => page.classList.toggle("mg-away", view === "spread" && spreadOf(pageIndex) !== index));
      const here = pages.filter((_, pageIndex) => spreadOf(pageIndex) === index);
      const names = [...new Set(here.map((page) => (page.classList.contains("cover") ? "Cover" : page.classList.contains("back") ? "Back cover" : page.classList.contains("advert") ? "Advert" : (page.closest("section.article")?.querySelector("[data-title]")?.textContent?.trim() ?? "Front pages"))))];
      setOnSpread(names.join(" · "));
      fit();
      // The two pages are made to fit the window, so the window is moved to show all of them: the edition's
      // title scrolls away, the bar with the tabs and this tab's controls stay.
      if (view === "spread") {
        window.requestAnimationFrame(() => {
          const area = holder.current?.getBoundingClientRect();
          const bar = controls.current?.getBoundingClientRect();
          if (!area || !bar || area.bottom <= window.innerHeight) return;
          const stuckAt = parseFloat(controls.current?.style.top ?? "160");
          window.scrollBy({ top: Math.max(0, Math.min(area.bottom - window.innerHeight + 12, bar.top - stuckAt)), behavior: "smooth" });
        });
      }
    },
    [view, fit],
  );

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      const on = entries.some((entry) => entry.isIntersecting);
      setVisible(on);
      if (on) setWanted(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasArticles]);

  useEffect(() => {
    if (status === "ready") show(spread);
  }, [status, spread, show]);

  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  // ---------------------------------------------------------------- saving a picture's position

  const waiting = useRef<{ key: string; framing: Framing; timer: number } | null>(null);
  const store = async (key: string, framing: Framing) => {
    setSaved("saving");
    const result = await saveFrameAt(id, key, framing);
    setMessage(result.error ?? null);
    setSaved(result.error ? "" : "saved");
    const doc = frame.current?.contentDocument;
    if (!result.error && doc) for (const image of imagesOf(doc, key)) image.dataset.edited = "";
    if (!result.error) setSelected((current) => (current && current.key === key ? { ...current, edited: true } : current));
  };
  /** Saves at once what is waiting to be saved. */
  const flush = () => {
    const pending = waiting.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    waiting.current = null;
    void store(pending.key, pending.framing);
  };
  /** Saves shortly after the last change, so a slide of the zoom is one save, not fifty. */
  const saveSoon = (key: string, framing: Framing) => {
    if (waiting.current) window.clearTimeout(waiting.current.timer);
    setSaved("saving");
    waiting.current = { key, framing, timer: window.setTimeout(flush, 600) };
  };

  /** Moves or zooms the selected picture and saves it. */
  const change = (work: (framing: Framing) => Framing) => {
    const doc = frame.current?.contentDocument;
    if (!doc || !selected || !editable) return;
    const key = selected.key;
    void makeLive(doc, key).then(() => {
      const image = imagesOf(doc, key)[0];
      if (!image) return;
      const next = tidyFraming(work(framingOf(image)));
      applyFraming(doc, key, next);
      setSelected((current) => (current && current.key === key ? { ...current, framing: next, room: roomOf(image, next) } : current));
      saveSoon(key, next);
    });
  };

  const deselect = () => {
    flush();
    frame.current?.contentDocument?.querySelectorAll(".mg-on").forEach((element) => element.classList.remove("mg-on"));
    setSelected(null);
    setSaved("");
  };

  const turn = (to: number) => {
    if (spreads === 0) return;
    deselect();
    setSpread(Math.max(0, Math.min(spreads - 1, to)));
  };

  const refresh = () => {
    flush();
    setSelected(null);
    setSaved("");
    setStatus("loading");
    setReload((count) => count + 1);
  };

  // What the handlers inside the magazine page call: always the latest of the functions above.
  const latest = useRef({ editable, selected, spread, change, deselect, turn, busy: false, painting, version });
  useEffect(() => {
    latest.current = { editable, selected, spread, change, deselect, turn, busy: chooser !== null || editing !== null, painting, version };
  });
  /** The versions of the edition for which painting the cover was started from here: once each, never in a loop. */
  const paintTried = useRef(new Set<string>());
  const startPainting = () => {
    const data = new FormData();
    data.set("id", String(id));
    paint(data);
  };

  const windowKeys = useRef<((event: KeyboardEvent) => void) | null>(null);
  useEffect(
    () => () => {
      if (windowKeys.current) window.removeEventListener("keydown", windowKeys.current);
    },
    [],
  );

  /** Runs once the magazine page has laid itself out: arranges it as spreads and makes its pictures and text respond. */
  const prepare = (doc: Document) => {
    const style = doc.createElement("style");
    style.textContent = VIEW_CSS + (draft ? EDIT_CSS : "");
    doc.head.append(style);
    const count = doc.querySelectorAll(".page").length;
    setPageCount(count);
    // The magazine may have fewer pages than when this spread was opened.
    setSpread((current) => Math.min(current, Math.floor(count / 2)));

    const keys = (event: KeyboardEvent) => {
      const now = latest.current;
      const typing = (event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]");
      if (now.busy || typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (event.key === "Escape" && now.selected) {
        event.preventDefault();
        now.deselect();
      } else if (now.selected && arrows[event.key]) {
        // With a photo selected the arrows move the picture: a little, or a lot with Shift.
        event.preventDefault();
        const [dx, dy] = arrows[event.key];
        const stride = event.shiftKey ? 0.1 : 0.02;
        now.change((framing) => ({ ...framing, x: framing.x + dx * stride, y: framing.y + dy * stride }));
      } else if (!now.selected && (event.key === "ArrowLeft" || event.key === "PageUp")) {
        event.preventDefault();
        now.turn(now.spread - 1);
      } else if (!now.selected && (event.key === "ArrowRight" || event.key === "PageDown")) {
        event.preventDefault();
        now.turn(now.spread + 1);
      }
    };
    doc.addEventListener("keydown", keys);
    // The window keeps one such listener: the one of the pages shown now.
    if (windowKeys.current) window.removeEventListener("keydown", windowKeys.current);
    windowKeys.current = keys;
    window.addEventListener("keydown", keys);
    if (!draft) return;

    let drag: { key: string; image: HTMLImageElement; x: number; y: number; framing: Framing; moved: boolean } | null = null;
    doc.addEventListener("pointerdown", (event) => {
      const now = latest.current;
      if (!now.editable || event.button !== 0) return;
      const target = event.target as HTMLElement;
      const image = target.closest<HTMLImageElement>("img[data-frame]");
      if (!image) {
        // A click beside the photo ends its editing; a click on text goes on to open the text editor.
        if (now.selected) now.deselect();
        return;
      }
      event.preventDefault();
      const key = image.dataset.frame!;
      if (now.selected && now.selected.key !== key) now.deselect();
      const section = image.closest<HTMLElement>("section.article");
      const title = section?.querySelector("[data-title]")?.textContent?.trim() ?? "";
      for (const other of doc.querySelectorAll(".mg-on")) other.classList.remove("mg-on");
      for (const same of imagesOf(doc, key)) same.classList.add("mg-on");
      setSaved("");
      setSelected({ key, article: key === "cover" ? "" : title, framing: framingOf(image), canChange: key !== "cover", edited: "edited" in image.dataset, room: roomOf(image, framingOf(image)) });
      drag = { key, image, x: event.clientX, y: event.clientY, framing: framingOf(image), moved: false };
      image.setPointerCapture(event.pointerId);
      void makeLive(doc, key).then(() => setSelected((current) => (current && current.key === key ? { ...current, room: roomOf(image, framingOf(image)) } : current)));
    });
    doc.addEventListener("pointermove", (event) => {
      if (!drag || !drag.image.dataset.live || !drag.image.naturalWidth) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      const key = drag.key;
      const next = dragFraming(drag.framing, frameBox(drag.image, drag.framing.zoom), { width: drag.image.naturalWidth, height: drag.image.naturalHeight }, dx, dy);
      applyFraming(doc, key, next);
      setSelected((current) => (current && current.key === key ? { ...current, framing: next } : current));
    });
    const drop = () => {
      if (!drag) return;
      const { key, image, moved } = drag;
      drag = null;
      if (moved) void store(key, framingOf(image));
    };
    doc.addEventListener("pointerup", drop);
    doc.addEventListener("pointercancel", drop);
    doc.addEventListener("dragstart", (event) => event.preventDefault());

    // The mouse wheel over the selected photo zooms it; anywhere else it scrolls as usual.
    doc.addEventListener(
      "wheel",
      (event) => {
        const now = latest.current;
        const image = (event.target as HTMLElement).closest<HTMLImageElement>("img[data-frame]");
        if (!now.editable || !now.selected || !image || image.dataset.frame !== now.selected.key) return;
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        now.change((framing) => ({ ...framing, zoom: framing.zoom * factor }));
      },
      { passive: false },
    );

    doc.addEventListener("click", (event) => {
      if (!latest.current.editable) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-p], [data-title]");
      const section = target?.closest<HTMLElement>("section.article[data-row]");
      if (!target || !section) return;
      // The article's pages as they are now are noted here: a change to the text must leave them as they are.
      const view = doc.defaultView as FrameWindow | null;
      const post = section.dataset.article ?? "";
      const shape = view?.__magazine ? { pages: section.querySelectorAll(".page").length, layout: view.__magazine.layouts?.[post] ?? "", cut: (view.__magazine.cut ?? []).includes(post) } : null;
      setEditing({ articleId: Number(section.dataset.row), paragraph: target.dataset.p !== undefined ? Number(target.dataset.p) : null, shape });
    });
  };

  const loaded = () => {
    const view = frame.current?.contentWindow as FrameWindow | null;
    if (!view) return;
    // Not the magazine at all: the session has ended (the login page, or the refusal), or the build failed.
    const body = view.document.body?.textContent?.trim() ?? "";
    if (!view.location.pathname.endsWith("/design/frame") || body === "Sign in first.") return setStatus("signed-out");
    if (!view.document.querySelector(".page")) return setStatus("failed");
    let tries = 0;
    const wait = window.setInterval(() => {
      // Pages asked for since (a reload, a change elsewhere) have taken this frame's place.
      if (frame.current?.contentWindow !== view) return window.clearInterval(wait);
      const report = view.__magazine;
      if (report && !report.error) {
        window.clearInterval(wait);
        prepare(view.document);
        setStatus("ready");
        const pending = view.document.querySelector('meta[name="mg-cover-pending"]')?.getAttribute("content") === "1";
        setCoverPending(pending);
        // The cover this edition is to have is painted now, once, so that it is seen here as it will print.
        const now = latest.current;
        if (pending && draft && canPaint && !now.painting && !paintTried.current.has(now.version)) {
          paintTried.current.add(now.version);
          startPainting();
        }
        // The whole wait, from asking for the pages to seeing them, goes into the edition's processing time.
        let steps: unknown = [];
        try {
          steps = (JSON.parse(view.document.getElementById("mg-build")?.textContent ?? "{}") as { steps?: unknown }).steps ?? [];
        } catch {
          // Without the server's steps the wait is still recorded, as one figure.
        }
        void reportDesignWait(id, Math.round(view.performance.now()), steps).then((recorded) => {
          if (recorded) router.refresh();
        });
      } else if (report?.error || tries++ > 1200) {
        window.clearInterval(wait);
        setStatus("failed");
      }
    }, 100);
  };

  const reset = async (target: DesignChange) => {
    waiting.current = null;
    const result = target.kind === "frame" ? await resetFrameAt(id, target.id) : await resetArticleText(id, Number(target.id));
    setMessage(result.error ?? null);
    if (!result.error) refresh();
  };

  const openChooser = async (key: string) => {
    flush();
    setChooser({ key, choices: null, busy: false });
    const result = await frameChoices(id, key);
    if (result.error) {
      setChooser(null);
      setMessage(result.error);
    } else setChooser({ key, choices: result.choices ?? [], busy: false });
  };
  const pick = async (work: () => Promise<{ error?: string }>) => {
    setChooser((current) => (current ? { ...current, busy: true } : current));
    const result = await work();
    setChooser(null);
    setMessage(result.error ?? null);
    if (!result.error) refresh();
  };

  const goTo = (target: string) => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
    const first = target === "cover" ? pages[0] : doc.querySelector<HTMLElement>(`section.article[data-row="${target}"] .page`);
    if (!first) return;
    if (view === "spread") turn(spreadOf(pages.indexOf(first)));
    else if (frame.current) window.scrollTo({ top: window.scrollY + frame.current.getBoundingClientRect().top + first.getBoundingClientRect().top - 230, behavior: "smooth" });
  };

  if (!hasArticles) {
    return <p className="rounded border border-dashed border-neutral-400 bg-white p-8 text-center text-sm text-neutral-700">Include some articles on the Articles tab first; the pages are shown here once there are any.</p>;
  }

  const plain = "rounded border border-neutral-400 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40";
  const round = "flex h-9 w-9 items-center justify-center rounded border border-neutral-400 bg-white text-lg leading-none hover:bg-neutral-100 disabled:opacity-30";
  const first = spread * 2;
  const pagesHere = spread === 0 ? "the cover" : first >= pageCount ? `page ${pageCount}` : `pages ${first}–${first + 1}`;
  const ready = status === "ready";

  return (
    <section>
      {changes.length > 0 && (
        <details className="mb-3 rounded border border-neutral-300 bg-white px-4 py-3 text-sm" data-design-changes>
          <summary className="cursor-pointer font-medium">
            {changes.length} {changes.length === 1 ? "change" : "changes"} made to the pages of this edition
          </summary>
          <ul className="mt-2 space-y-1.5">
            {changes.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{entry.what}</span>
                  {entry.article && <span className="text-neutral-700"> · {entry.article}</span>}
                  {entry.siteChanged && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-950">The post on the website has changed since; this edition still prints your version.</span>}
                </span>
                {draft && (
                  <button type="button" onClick={() => void reset(entry)} title="Go back to what the app chose, or to the post's own text" className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100">
                    Reset
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Stays in view under the edition's own bar: turning pages, and the selected photo's controls. */}
      <div ref={controls} className="sticky z-10 -mx-2 rounded-b border-b border-neutral-200 bg-neutral-50/95 px-2 pb-2 pt-1 backdrop-blur" style={{ top: 160 }} data-design-controls>
        <div className="flex flex-wrap items-center gap-2">
          {view === "spread" && (
            <>
              <button type="button" onClick={() => turn(0)} disabled={!ready || spread === 0} title="Go to the cover" aria-label="Go to the cover" className={round}>
                ⇤
              </button>
              <button type="button" onClick={() => turn(spread - 1)} disabled={!ready || spread === 0} title="Previous pages (left arrow key)" aria-label="Previous pages" className={round}>
                ←
              </button>
              <button type="button" onClick={() => turn(spread + 1)} disabled={!ready || spread >= spreads - 1} title="Next pages (right arrow key)" aria-label="Next pages" className={round}>
                →
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, spreads - 1)}
                value={spread}
                onChange={(event) => turn(Number(event.target.value))}
                disabled={!ready}
                aria-label="Move through the magazine"
                title="Slide to move through the magazine"
                className="w-40"
              />
              <p className="text-sm" data-spread-label>
                <span className="font-medium tabular-nums">{ready ? pagesHere.charAt(0).toUpperCase() + pagesHere.slice(1) : "…"}</span>
                {ready && <span className="text-neutral-600"> of {pageCount}</span>}
              </p>
            </>
          )}
          <select onChange={(event) => event.target.value && goTo(event.target.value)} value="" aria-label="Go to an article" disabled={!ready} className="max-w-56 rounded border border-neutral-400 bg-white px-2 py-1.5 text-sm">
            <option value="">Go to an article…</option>
            <option value="cover">Cover</option>
            {articles.map((article, index) => (
              <option key={article.rowId} value={article.rowId}>
                {index + 1}. {article.title}
              </option>
            ))}
          </select>
          <span className="ml-auto" />
          <label className="flex items-center gap-1.5 text-sm text-neutral-700">
            Show
            <select value={view} onChange={(event) => { deselect(); setView(event.target.value as "spread" | "all"); }} disabled={!ready} className="rounded border border-neutral-400 bg-white px-2 py-1.5 text-sm" aria-label="One spread or every page">
              <option value="spread">two pages at a time</option>
              <option value="all">every page, one below the other</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-neutral-700">
            Size
            <select value={size} onChange={(event) => setSize(event.target.value as Size)} disabled={!ready} className="rounded border border-neutral-400 bg-white px-2 py-1.5 text-sm" aria-label="Size of the pages">
              {view === "spread" && <option value="fit">fit the window</option>}
              <option value="width">{view === "spread" ? "full width" : "fit the width"}</option>
              <option value="real">real size</option>
            </select>
          </label>
          <button type="button" onClick={refresh} title="Build the pages again from what is saved" className={plain}>
            Reload
          </button>
        </div>

        {selected && draft ? (
          <div className="mt-2 rounded border border-violet-400 bg-white px-3 py-2" data-frame-bar>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">
                <span className="text-neutral-600">Editing: </span>
                <span className="font-bold">{frameName(selected.key)}</span>
                {selected.article && <span className="text-neutral-600"> of “{selected.article.length > 44 ? `${selected.article.slice(0, 42)}…` : selected.article}”</span>}
              </p>
              <span className="flex items-center gap-2 text-sm">
                Zoom
                <button type="button" onClick={() => change((framing) => ({ ...framing, zoom: framing.zoom - 0.1 }))} disabled={selected.framing.zoom <= 1} aria-label="Zoom out" title="Zoom out. The picture always fills its frame, so this stops when it just fits." className="h-8 w-8 rounded border border-neutral-300 text-lg leading-none disabled:opacity-30">
                  −
                </button>
                <input type="range" min={1} max={MAX_ZOOM} step={0.02} value={selected.framing.zoom} onChange={(event) => {
                    // Read now: by the time the picture is ready to change, the slider has been drawn again with its old value.
                    const zoom = Number(event.target.value);
                    change((framing) => ({ ...framing, zoom }));
                  }}
                  aria-label="Zoom" title="Zoom (the mouse wheel over the photo does the same)" className="w-36" />
                <button type="button" onClick={() => change((framing) => ({ ...framing, zoom: framing.zoom + 0.1 }))} disabled={selected.framing.zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in" className="h-8 w-8 rounded border border-neutral-300 text-lg leading-none disabled:opacity-30">
                  +
                </button>
                <span className="w-11 tabular-nums text-neutral-600">{Math.round(selected.framing.zoom * 100)}%</span>
              </span>
              <span role="status" className={`w-16 text-sm ${saved === "saved" ? "text-green-800" : "text-neutral-600"}`} data-save-state>
                {saved === "saving" ? "Saving…" : saved === "saved" ? "✓ Saved" : ""}
              </span>
              <span className="ml-auto" />
              {selected.canChange && (
                <button type="button" onClick={() => void openChooser(selected.key)} title="Show another picture of the post in this frame, or upload one" className={plain}>
                  Change picture
                </button>
              )}
              <button
                type="button"
                onClick={() => void reset({ kind: "frame", id: selected.key, what: "", article: "" })}
                disabled={!selected.edited && saved === ""}
                title={selected.edited || saved !== "" ? "Go back to the picture and position the app chose" : "This photo is as the app placed it; there is nothing to undo"}
                className={plain}
              >
                Undo all changes to this photo
              </button>
              <button type="button" onClick={deselect} title="Finish with this photo (Esc). Your changes are already saved." className="rounded bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white">
                Done
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-600">
              {moveHint(selected.room, selected.framing.zoom)} Changes are saved by themselves.
              {outdated && <span className="ml-1 font-medium text-amber-800">The edition was changed elsewhere: the pages are built again when you press Done.</span>}
            </p>
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-neutral-700" data-design-hint>
            {onSpread && ready && <span className="mr-2 font-medium text-neutral-900">{onSpread}.</span>}
            {!draft
              ? "This edition is finished, so the pages can only be looked at. Reopen it to change them."
              : unsaved
                ? "The article list has changes that are not saved. Save or undo them on the Articles tab; the pages can be edited again after that."
                : "Click a photo to move, zoom or change it. Click a headline or paragraph to edit the text. Changes apply to this edition only."}
          </p>
        )}
      </div>

      {message && (
        <p role="alert" className="mt-3 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
          {message}
        </p>
      )}

      {/* The cover: said plainly whenever what is on screen is not yet what will print. */}
      {draft && painting ? (
        <p role="status" className="mt-3 rounded border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950" data-cover-status="painting">
          <span className="font-medium">The AI is painting the cover.</span> It takes about half a minute and is one request to your OpenAI account; the picture is kept and used by the PDF too. Until it is ready the cover shows the photo on a blurred background. You can go on working.
          <span className="ml-2 rounded bg-white/70 px-2 py-0.5 font-medium">
            <Elapsed /> so far
          </span>
        </p>
      ) : draft && painted?.error ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded bg-red-50 px-4 py-3 text-sm text-red-800" data-cover-status="failed">
          <span className="min-w-0 flex-1">The AI cover could not be painted: {painted.error} The cover shows the photo on a blurred background meanwhile.</span>
          <button type="button" onClick={startPainting} className={plain}>
            Try again
          </button>
        </div>
      ) : draft && painted?.note ? (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-cover-status="fault">
          <span className="min-w-0 flex-1">{painted.note}</span>
          {coverPending && canPaint && (
            <button type="button" onClick={startPainting} title="One request to your OpenAI account, about half a minute" className={plain}>
              Try again
            </button>
          )}
        </div>
      ) : draft && coverPending && ready ? (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-cover-status="pending">
          <span className="min-w-0 flex-1">
            {canPaint
              ? "The cover is set to be stretched with AI, and that picture is not painted yet. It shows the photo on a blurred background meanwhile."
              : "The cover is set to be stretched with AI, but no OpenAI key is set on the server, so it shows the photo on a blurred background. Choose another style on the Cover tab."}
          </span>
          {canPaint && (
            <button type="button" onClick={startPainting} title="One request to your OpenAI account, about half a minute" className={plain}>
              Paint the AI cover now
            </button>
          )}
        </div>
      ) : null}

      <div ref={holder} className={`relative mt-3 rounded bg-zinc-600 ${size === "real" ? "overflow-x-auto" : "overflow-hidden"}`} style={{ minHeight: 320 }}>
        {status !== "ready" && (
          <p role="status" className="absolute inset-x-0 top-0 z-10 bg-zinc-800/90 px-4 py-3 text-center text-sm text-white" data-design-wait={status}>
            {status === "signed-out" ? (
              "You have been signed out (a session lasts 12 hours). Sign in again in another tab, come back here and press “Reload”. What you changed here is already saved."
            ) : status === "failed" ? (
              "The pages could not be shown. Press “Reload”; if it keeps failing, create the PDF to see what is wrong."
            ) : wanted ? (
              <>
                Building the pages… a few seconds, longer the first time while the photos are fetched.
                <span className="ml-2 rounded bg-white/15 px-2 py-0.5 font-medium">
                  <Elapsed key={`${reload}`} /> so far
                </span>
              </>
            ) : (
              "The pages are built when this tab is opened."
            )}
          </p>
        )}
        {wanted && (
          <iframe
            key={reload}
            ref={frame}
            src={`/editions/${id}/design/frame?r=${reload}`}
            onLoad={loaded}
            title="The magazine's pages"
            data-design-frame
            data-status={status}
            className="mx-auto block border-0"
            style={{ width: box.width, height: box.height, visibility: ready ? "visible" : "hidden" }}
          />
        )}
      </div>

      {chooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Choose a picture" data-picture-chooser>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-bold">{frameName(chooser.key)}: choose a picture</h3>
              <button type="button" onClick={() => setChooser(null)} disabled={chooser.busy} className={plain}>
                Close
              </button>
            </div>
            <p className="mt-1 text-sm text-neutral-700">The picture is changed in this frame of this edition only. A new picture starts centred on its subject; you can move and zoom it afterwards.</p>
            {chooser.choices === null ? (
              <p className="mt-4 text-sm text-neutral-600">Loading the pictures…</p>
            ) : (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {chooser.choices.map((choice) => (
                  <li key={choice.source}>
                    <button type="button" disabled={chooser.busy} onClick={() => void pick(() => chooseFramePicture(id, chooser.key, choice.source))} data-choice={choice.source} className="block w-full rounded border border-neutral-300 p-2 text-left hover:border-violet-600 hover:bg-violet-50 disabled:opacity-50">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by this app to signed-in users only */}
                      <img src={choice.url} alt="" className="h-32 w-full rounded bg-neutral-100 object-contain" />
                      <span className="mt-1 block text-xs text-neutral-700">{choice.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-5 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void pick(() => uploadPicture(data));
              }}
            >
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="frame" value={chooser.key} />
              <label className="text-sm font-medium">
                Or upload a picture from your computer
                <input type="file" name="file" required accept="image/*" className="mt-1 block text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:text-white" />
              </label>
              <button type="submit" disabled={chooser.busy} className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {chooser.busy ? "Working…" : "Upload and use it"}
              </button>
              <button type="button" disabled={chooser.busy} onClick={() => void pick(() => chooseFramePicture(id, chooser.key, null))} className={plain} title="Go back to the picture the app chooses for this frame">
                Use the automatic picture
              </button>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <TextEditor
          editionId={id}
          articleId={editing.articleId}
          paragraph={editing.paragraph}
          shape={editing.shape}
          onClose={(kept) => {
            setEditing(null);
            if (kept) refresh();
          }}
        />
      )}
    </section>
  );
}
