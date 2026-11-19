import { framingCss } from "../framing";
import { escapeHtml } from "./sanitize";

// Pure module: builds the one HTML document that headless Chromium prints.
// Every page is a fixed 210 x 297 mm box. A small script inside the document
// fits the text, decides each article's layout, and numbers the pages, so page
// numbers in the footers and on the contents pages are computed, never typed.

/**
 * A picture frame as the Design tab needs it: which frame, the whole picture it is cut from, and where the picture
 * sits (see lib/framing). The attributes it becomes change nothing in the PDF.
 */
export type FrameView = { key: string; full: string; x: number; y: number; zoom: number; edited: boolean };

export type MagazineArticle = {
  id: number;
  /** Row of the article in its edition; the Design tab saves changes under it. */
  rowId?: number;
  /** The headline or text was changed for this edition. */
  textEdited?: boolean;
  frames?: { spread?: FrameView; spreadNarrow?: FrameView; photo?: FrameView; tail?: FrameView; band?: FrameView };
  title: string;
  sectionLabel: string;
  /** Sanitized paragraph HTML (strong, em, sup, sub only). */
  paragraphs: string[];
  /** The post's photo as stored, used on the contents pages. */
  image: string | null;
  /** Opening-spread artwork across both pages, and the narrower one used beside the text column. */
  spreadWide: string | null;
  spreadNarrow: string | null;
  /** Portrait crop for the full-page photo of a long article. */
  portrait: string | null;
  /** Company logo attached to the post, shown on the opening page. */
  logo: string | null;
  /** False when the article's image is a logo, chart or other graphic: it is then shown whole, never cropped. */
  imageIsPhoto?: boolean;
  /** Picture that fills a last text page left largely empty (an extra photo of the post when it has one), and whether it may be cropped. */
  tailImage?: string | null;
  tailIsPhoto?: boolean;
  /** Picture shown beside a single quarter-page advert; null when the article's image is a logo or graphic that would crop badly. */
  bandPhoto?: string | null;
  /**
   * Adverts printed with this article: full pages end the article, double pages follow it, and one half page or
   * up to two quarter pages fill the lower half of its first text page.
   */
  adverts?: MagazineAdvert[];
};

export type MagazineAdvert = { id: number; size: "full" | "double" | "half" | "quarter"; image: string };

export type MagazineModel = {
  verticalKey: string;
  title: string;
  coverSubtitle: string;
  /** "Sep 2026" */
  monthShort: string;
  year: number;
  cover: { artwork: string | null; line: string; frame?: FrameView };
  reportAdvert: string;
  advertImage: string | null;
  /** Plain-text paragraphs. */
  foreword: string[];
  articles: MagazineArticle[];
  assets: { logoWhite: string; logoBlackText: string; logoWhiteText: string; director: string; qr: string; backCover: string };
  fonts: { weight: number; style: "normal" | "italic"; url: string; unicodeRange: string }[];
};

/** First page number of the articles: cover, publisher page, foreword, two contents pages come before. */
export const FIRST_ARTICLE_PAGE = 6;

const PUBLISHER_COLOURS: Record<string, { background: string; text: string }> = {
  cars: { background: "#d9b58d", text: "#111111" },
  bikes: { background: "#a99b8c", text: "#111111" },
  "commercial-vehicle": { background: "#2a2e3d", text: "#ffffff" },
  "farm-equipment": { background: "#9ed3ba", text: "#111111" },
  construction: { background: "#1e5c86", text: "#ffffff" },
};

const img = (url: string | null, className: string) =>
  url ? `<img class="${className}" src="${escapeHtml(url)}" alt="">` : "";

/** What tells the Design tab which frame a picture is in. `shade` names the dark gradient that is part of the cut picture. */
const frameAttributes = (view: FrameView | undefined, shade?: "spread" | "portrait") =>
  view
    ? ` data-frame="${view.key}" data-full="${escapeHtml(view.full)}" data-x="${view.x}" data-y="${view.y}" data-zoom="${view.zoom}"${view.edited ? " data-edited" : ""}${shade ? ` data-shade="${shade}"` : ""}`
    : "";

/** A picture already cut to its frame's shape, as img() gives, marked with its frame. */
const framed = (url: string | null, className: string, view: FrameView | undefined, shade?: "spread" | "portrait") =>
  url ? `<img class="${className}" src="${escapeHtml(url)}" alt=""${frameAttributes(view, shade)}>` : "";

function footer(side: "left" | "right", model: MagazineModel, section: string, tone: "light" | "dark"): string {
  const parts = [
    `<span class="num" data-page-number></span>`,
    `<span class="brand">RACE AUTO INDIA</span>`,
    section ? `<span class="section">${escapeHtml(section)}</span>` : "",
    `<span class="grow"></span>`,
    `<span class="month">${escapeHtml(model.monthShort)}</span>`,
  ];
  if (side === "right") parts.reverse();
  return `<div class="footer ${tone}">${parts.join("")}</div>`;
}

function coverPage(model: MagazineModel): string {
  return `<div class="page cover">
  ${model.cover.artwork ? `<img class="backdrop" src="${escapeHtml(model.cover.artwork)}" alt=""${frameAttributes(model.cover.frame)}${model.cover.frame ? ` style="${framingCss(model.cover.frame)}"` : ""}>` : ""}
  <div class="cover-top">${img(model.assets.logoWhite, "cover-logo")}<span>RACE AUTO INDIA</span></div>
  <div class="cover-bottom">
    <div class="emag">E-MAGAZINE</div>
    <div class="cover-sub">${escapeHtml(model.coverSubtitle)}</div>
    <div class="cover-month">${escapeHtml(model.monthShort)}</div>
    ${model.cover.line ? `<div class="cover-line">${escapeHtml(model.cover.line)}</div>` : ""}
  </div>
</div>`;
}

/** "Future of Hybrid Vehicles in ..." as stacked lines; short joining words stay on the line before. */
function advertLines(headline: string): string {
  const lines: string[] = [];
  for (const word of headline.split(/\s+/).filter(Boolean)) {
    if (word.length <= 2 && lines.length > 0) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines
    .map((line) => `<div><b>${escapeHtml(line[0].toUpperCase())}</b>${escapeHtml(line.slice(1).toUpperCase())}</div>`)
    .join("");
}

/** True when a colour is dark enough that black lettering on it would be hard to read. */
function darkBackground(hex: string): boolean {
  const value = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function publisherPage(model: MagazineModel): string {
  const colours = PUBLISHER_COLOURS[model.verticalKey] ?? PUBLISHER_COLOURS.cars;
  return `<div class="page publisher">
  <div class="pub-left" style="background:${colours.background};color:${colours.text}">
    <p class="pub-by">Published in ${escapeHtml(model.monthShort)} by:</p>
    <div class="pub-logo">${img(darkBackground(colours.background) ? model.assets.logoWhiteText : model.assets.logoBlackText, "")}</div>
    <p class="pub-name">Race Editoriale LLP</p>
    <p class="pub-small">43, St.Thomas Mount,<br>Ramapuram,<br>Tamil Nadu 600016</p>
    <p class="pub-strong">www.raceautoindia.com</p>
    <p class="pub-mid">+91 8072098352,<br>+91 9962110101</p>
    <p class="pub-mid">Mail: raceautoindia@gmail.com</p>
    <p class="pub-mid">&copy; Race Editoriale LLP<br>${model.year}. All rights reserved.</p>
    <div class="disclaimer">
      <h3>Disclaimer</h3>
      <p>Race Editoriale LLP considers its sources reliable and verifies as much data as possible. However, reporting inaccuracies can occur, consequently, readers using this information do so at their own risk.</p>
      <p>While every effort has been made to ensure that information is correct at the time of publishing, Race Editoriale LLP cannot be held responsible for the outcome of any action or decision based on the information contained in this publication.</p>
      <p>&copy; Race Editoriale LLP ${model.year}.<br>All rights reserved.</p>
      <p>No part of this publication may be reproduced, stored in a retrieval system, or transmitted in any form without prior written permission of the publisher.</p>
      <p>Permission is only deemed valid if approval is in writing. Race Editoriale LLP reserves all rights to contributions, text, and images, unless previously agreed to in writing.</p>
    </div>
  </div>
  <div class="pub-right">
    ${model.advertImage ? img(model.advertImage, "advert-photo") : ""}
    <div class="advert-head">${advertLines(model.reportAdvert)}</div>
    <div class="advert-box">For Detailed Report<br>Mail us at:<br><u>kh@raceinnovations.in</u><br><u>mkt_research@raceinnovations.in</u></div>
    <div class="advert-qr">${img(model.assets.qr, "")}</div>
    <p class="advert-site">www.raceinnovations.in</p>
  </div>
</div>`;
}

function forewordPage(model: MagazineModel): string {
  return `<div class="page foreword"><div class="frame">
  <div class="fore-head">
    <div><h1>Foreword</h1><h2>Dear Readers</h2></div>
    ${img(model.assets.director, "director")}
  </div>
  <div class="fore-text" data-fit="foreword">${model.foreword.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>
  <div class="fore-sign">Rajesh Khanna MP<br>Director, Race Auto India</div>
</div></div>`;
}

function contentsPages(model: MagazineModel): string {
  const half = Math.ceil(model.articles.length / 2);
  const groups = [model.articles.slice(0, half), model.articles.slice(half)];
  const size = half <= 8 ? "large" : half <= 11 ? "medium" : "small";
  const pictures = model.articles.filter((article) => article.image).map((article) => article.image as string);
  const collages = [pictures.slice(0, 3), pictures.slice(3, 9)];

  return groups
    .map((group, index) => {
      const list = group
        .map(
          (article) =>
            `<li><span class="toc-num" data-toc="${article.id}"></span><span class="toc-title">${escapeHtml(article.title)}</span></li>`,
        )
        .join("");
      const collage = collages[index].map((url) => `<div>${img(url, "")}</div>`).join("");
      return `<div class="page contents contents-${index + 1}">
  ${index === 0 ? `<div class="contents-word"><span>CONTENTS</span></div>` : ""}
  <div class="contents-main">
    <div class="collage collage-${collages[index].length}">${collage}</div>
    <ol class="toc ${size}">${list}</ol>
  </div>
</div>`;
    })
    .join("\n");
}

/**
 * Both layouts of an article are written out; the script in the page keeps one.
 * Short: one spread, the text in a white column on the right-hand page.
 * Long: a photo spread, then a text page and a full-page photo.
 * An article with a half or quarter page advert always takes the long layout, since the advert needs a text page:
 * it fills the lower half of the first one, and the text flows above it and on to further pages.
 * Full-page adverts end the article on right-hand pages; where that would leave the article with an odd number
 * of pages, the article's full-page photo comes before them. Double-page adverts follow as spreads of their own.
 */
function articlePages(article: MagazineArticle, model: MagazineModel): string {
  // A short paragraph that is bold from start to end is a sub-heading: keep it with the text below it.
  const body = article.paragraphs
    .map((p, index) => (/^<strong>[^<]{1,140}<\/strong>$/.test(p) ? `<p class="sub" data-p="${index}">${p}</p>` : `<p data-p="${index}">${p}</p>`))
    .join("");
  const title = escapeHtml(article.title);
  const section = article.sectionLabel;
  const canvas = (narrow: boolean) =>
    `<div class="canvas ${narrow ? "narrow" : ""}">${framed(narrow ? article.spreadNarrow : article.spreadWide, "spread-photo", narrow ? article.frames?.spreadNarrow : article.frames?.spread, "spread")}</div>`;
  const headline =
    (article.logo ? `<div class="article-logo">${img(article.logo, "")}</div>` : "") + `<h1 class="headline" data-title>${title}</h1>`;

  const band = advertBand(article);

  // The picture that fills a last text page left largely empty: the second photo if the post has one, else its main one.
  const tailImage = article.tailImage ?? article.image;
  const tailCropped = article.tailImage ? article.tailIsPhoto !== false : article.imageIsPhoto !== false;
  const tailView = article.frames?.tail;
  const tail = tailImage
    ? ` data-tail="${escapeHtml(tailImage)}" data-tail-fit="${tailCropped ? "cover" : "whole"}"` +
      (tailView ? ` data-tail-frame="${tailView.key}" data-tail-x="${tailView.x}" data-tail-y="${tailView.y}" data-tail-zoom="${tailView.zoom}" data-tail-style="${framingCss(tailView)}"${tailView.edited ? " data-tail-edited" : ""}` : "")
    : "";
  const row = article.rowId !== undefined ? ` data-row="${article.rowId}"${article.textEdited ? " data-text-edited" : ""}` : "";

  return `<section class="article" data-article="${article.id}"${row}${band ? " data-force-long" : ""}${tail}>
<div class="variant" data-variant="short">
  <div class="page spread left">${canvas(true)}${headline}${footer("left", model, section, "light")}</div>
  <div class="page spread right">${canvas(true)}
    <div class="panel"><div class="panel-body" data-fit="panel">${body}</div>
      <div class="footer dark panel-footer"><span class="section">${escapeHtml(section)}</span><span class="grow"></span><span class="brand">RACE AUTO INDIA</span><span class="num" data-page-number></span></div>
    </div>
  </div>
</div>
<div class="variant" data-variant="long">
  <div class="page spread left">${canvas(false)}${headline}${footer("left", model, section, "light")}</div>
  <div class="page spread right">${canvas(false)}${footer("right", model, section, "light")}</div>
  <div class="page text${band ? " with-band" : ""}" data-text-page>
    <div class="text-head"><span class="kicker">${escapeHtml(section)}</span><h2 data-title>${title}</h2></div>
    <div class="columns" data-fit="columns">${body}</div>
    ${footer("left", model, section, "dark")}
    ${band}
  </div>
  <div class="page photo" data-photo-page>${framed(article.portrait ?? article.image, "full-photo", article.frames?.photo, "portrait")}${footer("right", model, section, "light")}</div>
</div>
${advertPages(article, model)}
</section>`;
}

/**
 * The lower half of the article's first text page: one half-page advert, or two quarter pages side by side.
 * A single quarter page sits on the outer side with the article's own photo beside it, so the half is always full.
 */
function advertBand(article: MagazineArticle): string {
  const adverts = article.adverts ?? [];
  const picture = (advert: MagazineAdvert, wide: boolean) =>
    `<img class="band-cell${wide ? " wide" : ""}" data-advert="${advert.id}" src="${escapeHtml(advert.image)}" alt="">`;
  const half = adverts.find((advert) => advert.size === "half");
  if (half) return `<div class="advert-band">${picture(half, true)}</div>`;
  const quarters = adverts.filter((advert) => advert.size === "quarter").slice(0, 2);
  if (quarters.length === 0) return "";
  const cells = quarters.map((advert) => picture(advert, false));
  if (cells.length === 1) {
    const photo = article.bandPhoto === undefined ? (article.portrait ?? article.image) : article.bandPhoto;
    cells.push(
      photo
        ? `<div class="band-cell band-photo">${framed(photo, "", article.frames?.band)}</div>`
        : `<div class="band-cell band-plain"><i>RACE AUTO INDIA</i><span>${escapeHtml(article.sectionLabel)}</span><b>${escapeHtml(article.title)}</b></div>`,
    );
  }
  return `<div class="advert-band">${cells.join("")}</div>`;
}

/** The page number alone, where every page has it. Written for a left-hand page; the script turns it round on a right-hand one. */
const NUMBER_ONLY = `<div class="footer light"><span class="num" data-page-number></span><span class="grow"></span></div>`;

function advertPages(article: MagazineArticle, model: MagazineModel): string {
  const adverts = article.adverts ?? [];
  const full = adverts.filter((advert) => advert.size === "full");
  const double = adverts.filter((advert) => advert.size === "double");
  // Only a short article needs this page: a long one has its own full-page photo.
  const filler = full.length
    ? `<div class="page photo" data-filler-page>${framed(article.portrait ?? article.image, "full-photo", article.frames?.photo, "portrait")}${footer("right", model, article.sectionLabel, "light")}</div>`
    : "";
  return (
    filler +
    full.map((advert) => `<div class="page advert" data-advert="${advert.id}" data-advert-full>${img(advert.image, "advert-full")}${NUMBER_ONLY}</div>`).join("") +
    double
      .map(
        (advert) =>
          `<div class="page advert" data-advert="${advert.id}">${img(advert.image, "advert-wide")}${NUMBER_ONLY}</div>` +
          `<div class="page advert" data-advert="${advert.id}">${img(advert.image, "advert-wide second")}${NUMBER_ONLY}</div>`,
      )
      .join("")
  );
}

const STYLE = `
@page { size: 210mm 297mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "Roboto", sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
p, h1, h2, h3, ol { margin: 0; padding: 0; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; break-after: page; background: #fff; }
.page.back { break-after: auto; }
img { display: block; }

/* Cover */
.cover { background: #14171c; color: #fff; }
.cover .backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cover-top { position: absolute; top: 12mm; left: 12mm; right: 12mm; display: flex; align-items: center; gap: 8mm; font-size: 21pt; font-weight: 400; letter-spacing: 0.3pt; }
.cover-logo { width: 26mm; height: 26mm; }
.cover-bottom { position: absolute; left: 12mm; right: 12mm; bottom: 18mm; text-align: center; }
.emag { font-size: 50pt; font-weight: 900; color: #f6c915; letter-spacing: 0.5pt; line-height: 1; }
.cover-sub { margin-top: 5mm; font-size: 19pt; font-weight: 700; }
.cover-month { margin-top: 3mm; font-size: 16pt; font-weight: 700; color: #f6c915; }
.cover-line { margin: 6mm auto 0; max-width: 150mm; font-size: 10.5pt; font-weight: 500; line-height: 1.35; opacity: .95; }

/* Publisher page */
.publisher { display: flex; }
.pub-left { width: 105mm; height: 100%; padding: 13mm 9mm 8mm 13mm; text-align: center; }
.pub-by { font-size: 12pt; font-weight: 700; }
.pub-logo img { width: 40mm; margin: 5mm auto 4mm; }
.pub-name { font-size: 12.5pt; font-weight: 700; }
.pub-small { font-size: 8.5pt; line-height: 1.3; margin-top: 1mm; }
.pub-strong { font-size: 10.5pt; font-weight: 700; margin-top: 6mm; }
.pub-mid { font-size: 9.5pt; line-height: 1.3; margin-top: 6mm; }
.disclaimer { margin-top: 11mm; text-align: left; font-size: 8.6pt; line-height: 1.32; }
.disclaimer h3 { font-size: 11.5pt; margin-bottom: 4mm; }
.disclaimer p { margin-bottom: 4mm; }
.pub-right { width: 105mm; height: 100%; display: flex; flex-direction: column; background: #fff; }
.advert-photo { width: 100%; height: 68mm; object-fit: cover; }
.advert-head { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 4mm 7mm; font-size: 25pt; letter-spacing: 1.6pt; line-height: 1.45; font-weight: 400; }
.advert-head b { color: #f6b800; font-weight: 900; font-size: 31pt; }
.advert-box { background: #1b1e24; color: #fff; text-align: center; font-size: 11pt; font-weight: 700; line-height: 1.45; padding: 4mm 3mm; }
.advert-qr { padding: 6mm 0 3mm; }
.advert-qr img { width: 32mm; height: 32mm; margin: 0 auto; }
.advert-site { text-align: center; font-size: 11pt; font-weight: 700; padding-bottom: 7mm; }

/* Foreword */
.foreword { padding: 7mm; }
.frame { height: 100%; border: 1.2pt solid #111; outline: 0.5pt solid #111; outline-offset: -3.4pt; padding: 12mm 12mm 12mm; display: flex; flex-direction: column; }
.fore-head { display: flex; justify-content: space-between; align-items: flex-end; }
.fore-head h1 { font-size: 40pt; font-weight: 700; margin-bottom: 26mm; }
.fore-head h2 { font-size: 21pt; font-weight: 700; }
.director { width: 64mm; height: 70mm; object-fit: cover; }
.fore-text { margin-top: 9mm; flex: 1; overflow: hidden; font-size: 10.5pt; line-height: 1.95; text-align: justify; }
.fore-text p { margin-bottom: 3mm; }
.fore-sign { font-size: 15pt; font-weight: 500; line-height: 1.5; padding-top: 6mm; }

/* Contents */
.contents { display: flex; padding: 12mm 12mm 14mm; gap: 6mm; }
.contents-word { width: 20mm; flex: none; }
.contents-word span { display: block; writing-mode: vertical-rl; transform: rotate(180deg); font-size: 44pt; font-weight: 900; letter-spacing: -0.5pt; line-height: 20mm; height: 110mm; text-align: right; }
.contents-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9mm; }
.collage { flex: 1; min-height: 45mm; display: grid; gap: 1.2mm; overflow: hidden; }
.collage div { overflow: hidden; min-height: 0; }
.collage img { width: 100%; height: 100%; object-fit: cover; }
.collage-0 { display: none; }
.collage-1 { grid-template: 1fr / 1fr; }
.collage-2 { grid-template: 1fr 1fr / 1fr; }
.collage-3 { grid-template: 3fr 2fr / 1fr 1fr; }
.collage-3 div:first-child { grid-column: 1 / 3; }
.collage-4 { grid-template: 1fr 1fr / 1fr 1fr; }
.collage-5, .collage-6 { grid-template: 1fr 1fr / 1fr 1fr 1fr; }
.toc { list-style: none; flex: none; }
.toc li { display: flex; align-items: center; gap: 4mm; }
.toc-num { flex: none; width: 15mm; color: #12d6e6; font-weight: 900; }
.toc-title { font-weight: 700; line-height: 1.2; }
.toc.large li { margin-bottom: 6mm; } .toc.large .toc-num { font-size: 25pt; } .toc.large .toc-title { font-size: 14pt; }
.toc.medium li { margin-bottom: 4mm; } .toc.medium .toc-num { font-size: 21pt; } .toc.medium .toc-title { font-size: 12pt; }
.toc.small li { margin-bottom: 2.4mm; } .toc.small .toc-num { font-size: 16pt; width: 12mm; } .toc.small .toc-title { font-size: 10.5pt; }

/* Article spreads: one 420 mm wide picture shown half on each page */
.spread { background: #15181d; }
.canvas { position: absolute; top: 0; left: 0; width: 420mm; height: 297mm; }
.spread.right .canvas { left: -210mm; }
.spread-photo { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
.canvas.narrow .spread-photo { width: 322mm; }
.headline { position: absolute; left: 13mm; right: 13mm; bottom: 27mm; color: #fff; font-size: 27pt; line-height: 1.12; font-weight: 700; }
/* Solid white plate so any logo stays readable on any photo. */
.article-logo { position: absolute; top: 12mm; left: 13mm; background: #fff; padding: 2.2mm 3mm; border-radius: 1.2mm; }
.article-logo img { max-width: 40mm; max-height: 20mm; }
.panel { position: absolute; top: 0; right: 0; width: 98mm; height: 100%; background: #fff; padding: 14mm 11mm 24mm 11mm; display: flex; flex-direction: column; justify-content: center; }
.panel-body { max-height: 255mm; overflow: hidden; font-size: 10.5pt; line-height: 1.32; text-align: justify; hyphens: auto; }
.panel-body p, .columns p { margin-bottom: 0.95em; }
.panel-body p:last-child, .columns p:last-child { margin-bottom: 0; }
p.sub { break-after: avoid; margin-bottom: 0.45em; }
.panel-body p, .columns p { orphans: 2; widows: 2; }

/* Long article: text page and full-page photo */
.text { padding: 15mm 15mm 26mm; display: flex; flex-direction: column; }
.text-head { flex: none; border-bottom: 1.5pt solid #111; padding-bottom: 4mm; margin-bottom: 6mm; }
.text-head .kicker { color: #e10600; font-size: 8pt; font-weight: 700; letter-spacing: 0.4pt; }
.text-head h2 { font-size: 19pt; line-height: 1.15; font-weight: 700; margin-top: 1.5mm; }
.columns { flex: 1; min-height: 0; column-count: 2; column-gap: 8mm; column-fill: auto; overflow: hidden; font-size: 10.5pt; line-height: 1.34; text-align: justify; hyphens: auto; }
/* The article's picture in the space a last text page has left */
.tail-photo { flex: 1; min-height: 0; margin-top: 7mm; position: relative; overflow: hidden; background: #eef0f2; }
.tail-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.tail-photo.whole img { object-fit: contain; }
.photo { background: #15181d; }
.full-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

/* Footers */
.footer { position: absolute; z-index: 2; left: 13mm; right: 13mm; bottom: 9mm; display: flex; align-items: center; gap: 4mm; font-size: 7.5pt; font-weight: 700; }
.footer.light { color: #fff; }
.footer.dark { color: #111; }
.footer .grow { flex: 1; }
.footer .num { background: #333; color: #fff; border: 0.6pt solid #8a8a8a; padding: 1.1mm 2.3mm; font-size: 11.5pt; }
.footer .section { color: #e10600; font-size: 8.5pt; }
.footer.light .section { color: #ff3b30; }
.panel-footer { left: 11mm; right: 11mm; }

/* Adverts: the picture fills the page; a double page is one picture shown half on each page */
.advert { background: #fff; }
.advert-full { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.advert-wide { position: absolute; top: 0; left: 0; width: 420mm; height: 297mm; object-fit: cover; }
.advert-wide.second { left: -210mm; }
/* Half and quarter pages: the lower half of a text page, edge to edge, with the text above it. The page number keeps
   its corner, over the advert; the other footer parts would lie across the advert and are left out. */
.text.with-band { padding-bottom: 156mm; }
.text.with-band .footer > :not(.num):not(.grow) { display: none; }
.advert-band { position: absolute; left: 0; right: 0; bottom: 0; height: 148.5mm; display: flex; background: #15181d; }
.band-cell { flex: none; width: 105mm; height: 148.5mm; object-fit: cover; }
.band-cell.wide { width: 210mm; }
.band-photo { position: relative; overflow: hidden; }
.band-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.band-plain { display: flex; flex-direction: column; justify-content: flex-end; gap: 3mm; padding: 10mm; color: #fff; }
.band-plain i { margin-bottom: auto; font-style: normal; font-size: 9pt; font-weight: 700; letter-spacing: 0.6pt; color: #f6c915; }
.band-plain span { color: #ff3b30; font-size: 8.5pt; font-weight: 700; }
.band-plain b { font-size: 17pt; line-height: 1.15; }

.back { background: #111; }
.back img { width: 100%; height: 100%; object-fit: cover; }
`;

// Runs inside the page. Plain ES2017, no dependencies.
const SCRIPT = `
(async function () {
  await document.fonts.ready;
  const overflowsDown = (el) => el.scrollHeight > el.clientHeight + 1;
  const overflowsAcross = (el) => el.scrollWidth > el.clientWidth + 1;

  // Shrinks the font in small steps until the box holds its text. Returns false if it never fits.
  function fit(el, overflows, from, to) {
    for (let size = from; size >= to - 0.001; size -= 0.25) {
      el.style.fontSize = size + "pt";
      if (!overflows(el)) return true;
    }
    return false;
  }

  const layouts = {};
  const cut = [];

  // A paragraph longer than a whole page cannot be moved to the next page in one piece:
  // split plain-text paragraphs in two at a sentence end. Returns false when it cannot.
  function splitParagraph(p) {
    if (p.children.length > 0) return false;
    const text = p.textContent;
    const middle = Math.floor(text.length / 2);
    let at = -1;
    const ends = /[.!?]["')\\u201d]?\\s+/g;
    for (let m = ends.exec(text); m; m = ends.exec(text)) {
      const index = m.index + m[0].length;
      if (at < 0 || Math.abs(index - middle) < Math.abs(at - middle)) at = index;
    }
    if (at <= 0 || at >= text.length) return false;
    const rest = p.cloneNode(false);
    rest.textContent = text.slice(at);
    p.textContent = text.slice(0, at).trim();
    p.after(rest);
    return true;
  }
  // Whole paragraphs are moved to the next page, which can leave the foot of a page empty when the paragraph that
  // follows is long. As many of its opening sentences as fit are brought back, and the paragraph continues overleaf.
  function pullBack(box, nextBox) {
    const p = nextBox.firstElementChild;
    if (!p || p.children.length > 0 || p.classList.contains("sub")) return;
    const last = box.lastElementChild;
    if (last && last.classList.contains("sub")) return;
    const text = p.textContent;
    const ends = [];
    const pattern = /[.!?]["')\\u201d]?\\s+/g;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) ends.push(m.index + m[0].length);
    const part = p.cloneNode(false);
    box.append(part);
    for (let i = ends.length - 1; i >= 0; i--) {
      part.textContent = text.slice(0, ends[i]).trim();
      if (!overflowsAcross(box)) {
        p.textContent = text.slice(ends[i]);
        // Remembered, so the two parts are joined again if the text is laid out once more at another size.
        part.dataset.joined = "1";
        return;
      }
    }
    part.remove();
  }
  for (const article of document.querySelectorAll(".article")) {
    const short = article.querySelector('[data-variant="short"]');
    const long = article.querySelector('[data-variant="long"]');
    // Full-page adverts that end this article, and the photo page that keeps its page count even beside them.
    const fullAdverts = article.querySelectorAll("[data-advert-full]").length;
    const filler = article.querySelector("[data-filler-page]");
    // A half or quarter page advert needs a text page, which only the long layout has.
    if (!article.hasAttribute("data-force-long") && fit(short.querySelector('[data-fit="panel"]'), overflowsDown, 10.5, 9.5)) {
      long.remove();
      layouts[article.dataset.article] = "short";
      if (filler && fullAdverts % 2 === 0) filler.remove();
      continue;
    }
    short.remove();
    if (filler) filler.remove();
    layouts[article.dataset.article] = "long";

    const first = long.querySelector("[data-text-page]");
    const photo = long.querySelector("[data-photo-page]");
    const columns = first.querySelector('[data-fit="columns"]');
    // Lays the text out at one size: the first page, then further text pages for what does not fit, whole
    // paragraphs at a time. Starts from scratch each time, so it can be tried at several sizes.
    const layOut = (size) => {
      long.querySelectorAll("[data-text-page]").forEach((textPage, index) => {
        if (index === 0) return;
        columns.append(...Array.from(textPage.querySelector('[data-fit="columns"]').children));
        textPage.remove();
      });
      // A paragraph that an earlier attempt continued overleaf is made whole again.
      columns.querySelectorAll("[data-joined]").forEach((part) => {
        const rest = part.nextElementSibling;
        if (rest) rest.textContent = part.textContent + " " + rest.textContent;
        part.remove();
      });
      columns.style.fontSize = size + "pt";
      let page = first;
      let box = columns;
      let guard = 0;
      let lost = false;
      let count = 1;
      while (overflowsAcross(box) && guard++ < 60) {
        const next = page.cloneNode(true);
        // Only the first text page has the heading; a third page is cloned from the second, which has none.
        const head = next.querySelector(".text-head");
        if (head) head.remove();
        // Nor do the adverts in its lower half repeat on the pages that follow.
        const band = next.querySelector(".advert-band");
        if (band) band.remove();
        next.classList.remove("with-band");
        const nextBox = next.querySelector('[data-fit="columns"]');
        nextBox.innerHTML = "";
        page.after(next);
        // Move paragraphs from the end to the next page until this one fits. A single
        // paragraph too long for the page is split in two and the second part moved.
        let steps = 0;
        while (overflowsAcross(box) && steps++ < 500) {
          if (box.children.length > 1) nextBox.prepend(box.lastElementChild);
          else if (!splitParagraph(box.firstElementChild)) break;
        }
        if (overflowsAcross(box)) lost = true;
        else pullBack(box, nextBox);
        if (nextBox.children.length === 0) {
          next.remove();
          break;
        }
        page = next;
        box = nextBox;
        count++;
      }
      return { pages: count, lost: lost || overflowsAcross(box) };
    };
    // Start large so a moderately long article still fills its page.
    if (!fit(columns, overflowsAcross, 12, 8.75)) {
      // Too long for one page even at the smallest size. That size says how many pages the text needs; the text is
      // then set at the largest size that still fits in as many, so the last page is not left with a few lines.
      let result = layOut(8.75);
      const needed = result.pages;
      let settled = false;
      if (!result.lost) {
        for (let size = 12; size > 8.75 + 0.001; size -= 0.25) {
          const attempt = layOut(size);
          if (!attempt.lost && attempt.pages <= needed) {
            result = attempt;
            settled = true;
            break;
          }
        }
      }
      if (!settled) result = layOut(8.75);
      if (result.lost) cut.push(article.dataset.article);
    }
    const textPages = long.querySelectorAll("[data-text-page]");
    // A short text above adverts looks tidier in two columns of equal length than in one full and one nearly empty.
    if (textPages.length === 1 && first.classList.contains("with-band")) {
      columns.style.columnFill = "balance";
      if (overflowsAcross(columns) || overflowsDown(columns)) columns.style.columnFill = "auto";
    }
    // Where the last text page is left largely empty, the text is set in two equal columns at the top and the
    // article's picture fills the rest of the page. (A page with adverts in its lower half has no such space.)
    const lastPage = textPages[textPages.length - 1];
    const lastBox = lastPage.querySelector('[data-fit="columns"]');
    if (article.dataset.tail && !lastPage.classList.contains("with-band") && lastBox.children.length > 0) {
      const room = lastBox.clientHeight;
      lastBox.style.flex = "none";
      lastBox.style.columnFill = "balance";
      const used = lastBox.offsetHeight;
      // Worth it from about a third of the text area, and at least 45 mm, so the picture is not a thin strip.
      if (room - used > room * 0.3 && room - used > 170) {
        const tail = document.createElement("div");
        tail.className = "tail-photo" + (article.dataset.tailFit === "whole" ? " whole" : "");
        const image = document.createElement("img");
        image.src = article.dataset.tail;
        image.alt = "";
        // Where the picture sits in this space, as set on the Design tab; a logo or chart shown whole is not moved.
        if (article.dataset.tailFrame && article.dataset.tailFit !== "whole") {
          image.style.cssText = article.dataset.tailStyle;
          image.dataset.frame = article.dataset.tailFrame;
          image.dataset.full = article.dataset.tail;
          image.dataset.x = article.dataset.tailX;
          image.dataset.y = article.dataset.tailY;
          image.dataset.zoom = article.dataset.tailZoom;
          if ("tailEdited" in article.dataset) image.dataset.edited = "";
        }
        tail.append(image);
        lastBox.after(tail);
      } else {
        lastBox.style.flex = "";
        lastBox.style.columnFill = "";
      }
    }
    // Articles always take an even number of pages so every spread starts on a left-hand page.
    // The full-page photo is kept only when the text pages and the full-page adverts together are an odd number.
    if ((textPages.length + fullAdverts) % 2 === 0) photo.remove();
    textPages.forEach((textPage, index) => {
      const footer = textPage.querySelector(".footer");
      if (index % 2 === 1) footer.append(...Array.from(footer.children).reverse());
    });
  }

  const foreword = document.querySelector('[data-fit="foreword"]');
  if (foreword && !fit(foreword, overflowsDown, 12.5, 8)) cut.push("foreword");
  for (const main of document.querySelectorAll(".contents-main")) {
    if (overflowsDown(main) && !cut.includes("contents")) cut.push("contents");
  }

  const pages = Array.from(document.querySelectorAll(".page"));
  const starts = {};
  const adverts = {};
  pages.forEach((page, index) => {
    page.querySelectorAll("[data-page-number]").forEach((el) => (el.textContent = String(index + 1)));
    [page].concat(Array.from(page.querySelectorAll("[data-advert]"))).forEach((el) => {
      if (el.dataset.advert && !(el.dataset.advert in adverts)) adverts[el.dataset.advert] = index + 1;
    });
    // A full-page photo is drawn for a right-hand page; beside adverts it can fall on a left-hand one (an even number).
    // The number-only footer of an advert page is drawn for a left-hand page; on a right-hand one (an odd number) it is turned round.
    if (page.matches(".page.advert") && (index + 1) % 2 === 1) {
      const footer = page.querySelector(".footer");
      if (footer) footer.append(...Array.from(footer.children).reverse());
    }
    if (page.matches("[data-photo-page], [data-filler-page]") && (index + 1) % 2 === 0) {
      const footer = page.querySelector(".footer");
      if (footer) footer.append(...Array.from(footer.children).reverse());
    }
    const article = page.closest(".article");
    if (article && !(article.dataset.article in starts)) starts[article.dataset.article] = index + 1;
  });
  document.querySelectorAll("[data-toc]").forEach((el) => {
    el.textContent = String(starts[el.dataset.toc] || "").padStart(2, "0");
  });

  await Promise.all(Array.from(document.images).map((image) => (image.complete ? null : new Promise((done) => { image.onload = image.onerror = done; }))));
  const broken = Array.from(document.images).filter((image) => image.naturalWidth === 0).map((image) => image.getAttribute("src"));
  window.__magazine = { pages: pages.length, starts: starts, layouts: layouts, broken: broken, cut: cut, adverts: adverts };
})().catch(function (error) { window.__magazine = { error: String(error && error.stack || error) }; });
`;

export function buildMagazineHtml(model: MagazineModel): string {
  const fonts = model.fonts
    .map(
      (font) =>
        `@font-face { font-family: "Roboto"; font-style: ${font.style}; font-weight: ${font.weight}; src: url("${font.url}") format("woff2"); unicode-range: ${font.unicodeRange}; }`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(model.title)}</title>
<style>${fonts}\n${STYLE}</style>
</head>
<body>
${coverPage(model)}
${publisherPage(model)}
${forewordPage(model)}
${contentsPages(model)}
${model.articles.map((article) => articlePages(article, model)).join("\n")}
<div class="page back">${img(model.assets.backCover, "")}</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
