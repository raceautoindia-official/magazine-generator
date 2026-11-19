import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { appExecute, appQuery } from "../db";
import { getEdition, type Edition, type EditionArticle } from "../editions";
import { monthLabel, monthShort, shiftMonth } from "../months";
import { fetchPostContents } from "../posts";
import type { EditionWarning } from "../selection";
import { getSettings } from "../settings";
import { recordTiming, Timer, type TimingStep } from "../timing";
import { buildMagazineHtml, type FrameView, type MagazineArticle, type MagazineModel } from "./html";
import { frameEdits, frameKey, resetFrame, textEdits, textHash, uploadedImage, type FrameEdit, type Slot, type TextEdit } from "../design";
import type { Framing } from "../framing";
import type { PostRecord } from "../selection";
import { printableAdverts, repairAdverts, type PrintAdvert } from "../advert-placement";
import { BAND_SLOTS, bandSlots } from "../advert-sizes";
import { mapLimited } from "../ai/claude";
import { aiCoverPath, aiCoverRejection, extendCoverPhoto, hasAiCover, imageAiAvailable, rejectAiCover, removeAiCover } from "../ai/openai-image";
import { coverBrief, coverFlaws } from "../ai/cover-brief";
import { analyseImage, visionCounts, type ImageAnalysis } from "../ai/vision";
import {
  autoFraming,
  coverArtwork,
  coverCrop,
  dataDir,
  fitsPortraitCover,
  imageCounts,
  portraitCrop,
  prepareImage,
  prepareLogo,
  spreadPhoto,
  withoutWatermark,
  type Focus,
  type PreparedImage,
} from "./images";
import { manualKind } from "./extras";
import { toParagraphs } from "./sanitize";

export type RenderResult = { pageCount: number; notes: string[]; /** How long the run took. */ ms: number };

/** Warnings written by the renderer start with this, so a new render can replace the old ones. */
const PDF_PREFIX = "PDF: ";
/** Below this width a photo looks soft across a two-page spread. */
const SOFT_WIDTH = 1200;

const assetDir = (...parts: string[]) => path.resolve(/* turbopackIgnore: true */ process.cwd(), "assets", ...parts);
const fileUrl = (file: string) => pathToFileURL(file).href;

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

function fonts(): MagazineModel["fonts"] {
  const list: MagazineModel["fonts"] = [];
  for (const [subset, unicodeRange] of [["latin", LATIN], ["latin-ext", LATIN_EXT]] as const) {
    for (const weight of [400, 500, 700, 900]) {
      for (const style of ["normal", "italic"] as const) {
        list.push({ weight, style, unicodeRange, url: fileUrl(assetDir("fonts", `roboto-${subset}-${weight}-${style}.woff2`)) });
      }
    }
  }
  return list;
}

async function optionalAsset(...parts: string[]): Promise<string | null> {
  const file = assetDir(...parts);
  return fs.access(file).then(
    () => fileUrl(file),
    () => null,
  );
}

/** Used until a foreword is written for the edition. States only what the edition itself shows. */
function defaultForeword(edition: Edition, label: string, titles: string[], national: number): string[] {
  const total = titles.length;
  const international = total - national;
  const paragraphs = [
    `This ${label} edition of Race Auto India brings together ${total} ${total === 1 ? "story" : "stories"} published in ${monthLabel(edition.contentMonth)}: ${national} from India and ${international} from international markets.`,
  ];
  if (titles[0]) paragraphs.push(`The edition opens with "${titles[0]}".`);
  if (titles.length > 2) paragraphs.push(`It continues with "${titles[1]}" and "${titles[2]}", followed by the rest of the month's developments.`);
  paragraphs.push("We hope you find this edition useful, and we welcome your feedback.");
  return paragraphs;
}

type Prepared = {
  article: EditionArticle;
  main: PreparedImage | null;
  analysis: ImageAnalysis | null;
  portrait: string | null;
  /** Picture for the space a last text page has left, and whether it may be cropped (a logo or chart may not). */
  tail: string | null;
  tailIsPhoto: boolean;
  /** The article's picture in this edition: the opening spread's, which a person may have replaced. */
  lead: PreparedImage | null;
  leadIsPhoto: boolean;
  /** Each frame's picture and how it sits in the frame, for the Design tab. */
  views: { spread?: View; spreadNarrow?: View; photo?: View; tail?: View; band?: View };
  /** Picture beside a single quarter-page advert. */
  quarter: string | null;
  wide: string | null;
  narrow: string | null;
  logo: string | null;
};

const focusOf = (analysis: ImageAnalysis | null): Focus | null =>
  analysis
    ? {
        x: analysis.focusX,
        y: analysis.focusY,
        left: analysis.subjectLeft,
        right: analysis.subjectRight,
        top: analysis.subjectTop,
        bottom: analysis.subjectBottom,
      }
    : null;

type Entry = { image: PreparedImage; analysis: ImageAnalysis | null };
type View = { key: string; file: string; framing: Framing; edited: boolean };

/** The picture a person chose for a frame: one of the post's own, or one uploaded for this edition. */
async function chosenPicture(editionId: number, post: PostRecord, source: string, model: string): Promise<Entry | null> {
  if (source.startsWith("upload:")) {
    const image = await uploadedImage(editionId, Number(source.slice(7)));
    return image ? { image, analysis: null } : null;
  }
  const stored = source.slice(5);
  if (stored !== post.image && !post.extraImages.includes(stored)) return null;
  const image = await prepareImage(stored);
  if (!image) return null;
  return { image, analysis: image.hasAlpha ? null : await analyseImage(stored, image.file, model) };
}

/** Fetches one article's photos, asks where their subjects are, and makes the crops its pages need. */
async function prepareArticle(article: EditionArticle, model: string, notes: string[], editionId: number, frames: Map<string, FrameEdit>): Promise<Prepared> {
  const post = article.post!;
  const main = await prepareImage(post.image);
  if (!main) notes.push(`No usable photo for "${post.title}".`);
  else if (main.width < SOFT_WIDTH) notes.push(`Photo for "${post.title}" is only ${main.width} px wide and will look soft.`);
  const analysis = main && post.image ? await analyseImage(post.image, main.file, model) : null;

  // Extra images of the post: a company logo goes in the corner of the opening page, and every real photo is
  // given a place of its own before any picture is shown twice. The opening spread always shows the main photo;
  // the first extra photo becomes the full-page photo of a long article, the next fills the space a last text
  // page has left, and the one after that sits beside a single quarter-page advert.
  const photos: { image: PreparedImage; analysis: ImageAnalysis | null }[] = [];
  let logo: string | null = null;
  for (const extra of post.extraImages) {
    // A person's choice on the review page overrules everything below.
    const manual = await manualKind(extra);
    if (manual === "none") continue;
    const candidate = await prepareImage(extra);
    if (!candidate) continue;
    // A transparent background is certainly a logo. Otherwise Claude decides;
    // without Claude, a small image is taken to be one.
    const seen = candidate.hasAlpha ? null : await analyseImage(extra, candidate.file, model);
    const isLogo = manual ? manual === "logo" : candidate.hasAlpha || (seen ? seen.kind === "logo" : candidate.width < 800);
    if (candidate.hasAlpha) {
      await appExecute(
        "UPDATE mg_asset_cache SET kind = 'logo', kind_source = 'measured' WHERE source_path = ? AND kind_source IS NULL",
        [extra],
      );
    }
    if (isLogo) logo ??= await prepareLogo(extra);
    else if (manual === "photo" || seen?.kind !== "graphic") photos.push({ image: candidate, analysis: seen });
  }
  const [second, third, fourth] = photos;

  // The automatic picture of each frame. With one extra photo, the page-filling picture is that photo, not the
  // main one a third time. A person's choice on the Design tab (another picture, or where it sits) comes first.
  const mainEntry: Entry | null = main ? { image: main, analysis } : null;
  const mainIsPhoto = !analysis || analysis.kind === "photo";
  const automatic: Record<Slot, Entry | null> = { spread: mainEntry, photo: second ?? mainEntry, tail: third ?? second ?? mainEntry, band: fourth ?? third ?? null };
  const chosen = async (slot: Slot) => {
    const edit = frames.get(frameKey(article.id, slot));
    let entry = automatic[slot];
    let replaced = false;
    if (edit?.source) {
      const other = await chosenPicture(editionId, post, edit.source, model);
      if (other) {
        entry = other;
        replaced = true;
      } else notes.push(`A picture chosen by hand for "${post.title}" is no longer available; the automatic one is used.`);
    }
    return { entry, replaced, framing: edit?.framing ?? null, edited: Boolean(edit && (edit.framing || replaced)) };
  };
  const spread = await chosen("spread");
  const photo = await chosen("photo");
  const tail = await chosen("tail");
  const band = await chosen("band");
  // Beside a single quarter-page advert: a picture of its own if the post has one, else the full-page photo's
  // picture, unless that is a logo or chart, which would show a meaningless piece of it.
  const bandEntry = band.entry ?? (photo.entry && (photo.replaced || photo.entry !== mainEntry || mainIsPhoto) ? photo.entry : null);
  const view = (slot: Slot, entry: Entry, aspect: number, framing: Framing | null, edited: boolean): View => ({
    key: frameKey(article.id, slot),
    file: entry.image.file,
    framing: framing ?? autoFraming(entry.image, aspect, focusOf(entry.analysis)),
    edited,
  });
  const isPhoto = (entry: Entry | null, replaced: boolean) => (replaced || entry !== mainEntry ? !entry?.analysis || entry.analysis.kind !== "graphic" : mainIsPhoto);
  const tailFocus = focusOf(tail.entry?.analysis ?? null);

  return {
    article,
    main,
    analysis,
    lead: spread.entry?.image ?? null,
    leadIsPhoto: isPhoto(spread.entry, spread.replaced),
    portrait: photo.entry ? await portraitCrop(photo.entry.image, focusOf(photo.entry.analysis), photo.framing) : null,
    tail: tail.entry?.image.file ?? null,
    tailIsPhoto: isPhoto(tail.entry, tail.replaced),
    quarter: bandEntry ? await portraitCrop(bandEntry.image, focusOf(bandEntry.analysis), band.framing) : null,
    wide: spread.entry ? await spreadPhoto(spread.entry.image, "wide", focusOf(spread.entry.analysis), spread.framing) : null,
    narrow: spread.entry ? await spreadPhoto(spread.entry.image, "narrow", focusOf(spread.entry.analysis), spread.framing) : null,
    logo,
    views: {
      ...(spread.entry ? { spread: view("spread", spread.entry, 420 / 297, spread.framing, spread.edited), spreadNarrow: view("spread", spread.entry, 322 / 297, spread.framing, spread.edited) } : {}),
      ...(photo.entry ? { photo: view("photo", photo.entry, 210 / 297, photo.framing, photo.edited) } : {}),
      // This frame's shape is only known once the page is laid out, so its picture is placed by the page itself.
      ...(tail.entry ? { tail: { key: frameKey(article.id, "tail"), file: tail.entry.image.file, framing: tail.framing ?? { x: tailFocus?.x ?? 0.5, y: tailFocus?.y ?? 0.5, zoom: 1 }, edited: tail.edited } } : {}),
      ...(bandEntry ? { band: view("band", bandEntry, 210 / 297, band.framing, band.edited) } : {}),
    },
  };
}

export type CoverStyle = "ai" | "blur" | "crop";
const isCoverStyle = (value: unknown): value is CoverStyle => value === "ai" || value === "blur" || value === "crop";

type BuiltModel = {
  model: MagazineModel;
  adverts: PrintAdvert[];
  /** The cover is to be an AI picture that has not been painted yet; a blurred background stands in for it. */
  coverPending: boolean;
};

export type BuildOptions = {
  /** For the Design tab: nothing is recorded on the edition, and no cover is painted by AI unless `paint` says so. */
  live?: boolean;
  /** With `live`: paint the AI cover if it is wanted and not there yet (a paid request). */
  paint?: boolean;
  /** Only this article (its row id), to try out a change to it. */
  only?: number;
  /** A headline and text to lay that article out with, in place of what is saved. */
  trial?: { articleId: number; title: string; paragraphs: string[] };
};

const toView = (view: View | undefined): FrameView | undefined => (view ? { key: view.key, full: fileUrl(view.file), ...view.framing, edited: view.edited } : undefined);

async function buildModel(edition: Edition, notes: string[], timer: Timer, options: BuildOptions = {}): Promise<BuiltModel> {
  const { settings } = await getSettings();
  const vertical = settings.verticals.find((entry) => entry.key === edition.vertical);
  const label = vertical?.label ?? edition.vertical;
  const included = edition.articles.filter((article) => article.included && article.post && (options.only === undefined || article.id === options.only));
  // What was changed on the Design tab for this edition.
  const frames = await frameEdits(edition.id);
  const texts = await textEdits(edition.id);
  if (options.trial) texts.set(options.trial.articleId, { title: options.trial.title, paragraphs: options.trial.paragraphs, baseHash: "" });
  const contents = await timer.step("Reading the articles' text from the website", "site", () => fetchPostContents(included.map((article) => article.postId)));

  // Photos already on this server and already seen by Claude take almost no time; new ones are downloaded and looked at.
  const before = { downloaded: imageCounts.downloaded, asked: visionCounts.asked };
  const photosFrom = Date.now();
  const prepared = await mapLimited(included, 4, (article) => prepareArticle(article, settings.ai.textModel, notes, edition.id, frames));
  const downloaded = imageCounts.downloaded - before.downloaded;
  const asked = visionCounts.asked - before.asked;
  timer.add({
    name: "Photos: downloading new ones, Claude's look at them, cropping for the pages",
    by: asked > 0 ? "claude" : downloaded > 0 ? "site" : "app",
    ms: Date.now() - photosFrom,
    detail:
      downloaded === 0 && asked === 0
        ? `${included.length} articles; every photo was already here`
        : `${included.length} articles; ${downloaded} photo(s) downloaded, ${asked} looked at by Claude`,
  });

  // Adverts are printed with the article they were placed with.
  const adverts = await printableAdverts(edition.id, notes);
  const advertsOf = (articleId: number) =>
    adverts
      .filter((advert) => advert.articleId === articleId)
      .map((advert) => ({ id: advert.placementId, size: advert.size, image: fileUrl(advert.file) }));
  for (const advert of adverts) {
    if (!included.some((article) => article.id === advert.articleId)) notes.push(`The advert of ${advert.advertiser} belongs to an article that is not in the magazine, so it is not printed. Save the article list to have it placed again.`);
  }
  // One article's text page holds one half page or two quarter pages; anything beyond that is not printed.
  for (const article of included) {
    const small = adverts.filter((advert) => advert.articleId === article.id && bandSlots(advert.size) > 0);
    const half = small.find((advert) => advert.size === "half");
    const printed = half ? [half] : small.slice(0, BAND_SLOTS);
    for (const advert of small.filter((entry) => !printed.includes(entry))) {
      notes.push(`The advert of ${advert.advertiser} is not printed: "${article.post?.title.trim() ?? "its article"}" already has a half page of adverts. Move it to another article.`);
    }
  }

  const articles: MagazineArticle[] = prepared.map(({ article, lead, leadIsPhoto, portrait, tail, tailIsPhoto, quarter, wide, narrow, logo, views }) => {
    const text: TextEdit | undefined = texts.get(article.id);
    return {
    rowId: article.id,
    textEdited: Boolean(text && (text.title !== null || text.paragraphs !== null)),
    frames: { spread: toView(views.spread), spreadNarrow: toView(views.spreadNarrow), photo: toView(views.photo), tail: toView(views.tail), band: toView(views.band) },
    tailImage: tail ? fileUrl(tail) : null,
    tailIsPhoto,
    adverts: advertsOf(article.id),
    // A logo or chart cut to a tall quarter of a page shows a meaningless piece of it; the headline is shown instead.
    bandPhoto: quarter ? fileUrl(quarter) : null,
    imageIsPhoto: leadIsPhoto,
    id: article.postId,
    // As edited for this edition on the Design tab, else as the post has it on the website.
    title: text?.title ?? article.post!.title,
    sectionLabel: settings.sectionLabels[article.section],
    paragraphs: text?.paragraphs ?? toParagraphs(contents.get(article.postId) ?? ""),
    image: lead ? fileUrl(lead.file) : null,
    spreadWide: wide ? fileUrl(wide) : null,
    spreadNarrow: narrow ? fileUrl(narrow) : null,
    portrait: portrait ? fileUrl(portrait) : null,
    logo: logo ? fileUrl(logo) : null,
    };
  });
  for (const article of articles) {
    if (article.paragraphs.length === 0) notes.push(`"${article.title}" has no text.`);
  }

  // Cover: the earliest article squarely about this edition whose photo Claude finds fit for a cover;
  // failing that, the earliest one with a photo.
  const withPhoto = prepared.filter((entry) => entry.main);
  const specific = withPhoto.filter((entry) => entry.article.assignedBy !== "general");
  const earlier = await appQuery<{ cover_style: string | null; cover_pick_post_id: number | null }>(
    "SELECT cover_style, cover_pick_post_id FROM mg_edition_front_matter WHERE edition_id = ?",
    [edition.id],
  );
  // A photo picked by hand wins while its article is still in the edition.
  const picked = withPhoto.find((entry) => entry.article.postId === earlier[0]?.cover_pick_post_id);
  // The cover never shows people. Photos looked at before that was asked are looked at once more; only the
  // few that could become the cover need it.
  if (!picked) {
    const unknown = withPhoto.filter((entry) => entry.analysis && entry.analysis.people === undefined && entry.analysis.kind === "photo" && entry.article.post?.image);
    if (unknown.length > 0) {
      await timer.step(
        "Cover: Claude looks again at older photos to see which show people",
        "claude",
        () =>
          mapLimited(unknown, 4, async (entry) => {
            entry.analysis = (await analyseImage(entry.article.post!.image!, entry.main!.file, settings.ai.textModel, true)) ?? entry.analysis;
          }),
        () => `${unknown.length} photo(s); needed once per photo`,
      );
    }
  }
  const noPeople = (entry: Prepared) => entry.analysis?.people === "none";
  const notOfPeople = (entry: Prepared) => entry.analysis?.people !== "main";
  const fit = (entry: Prepared) => Boolean(entry.analysis?.coverSuitable) && notOfPeople(entry);
  const isPhoto = (entry: Prepared) => entry.analysis?.kind === "photo" && notOfPeople(entry);
  // In order of preference: a fitting photo with nobody in it from an article squarely about this edition; one with
  // only incidental figures; a fitting photo from any article; any real photo that is not of people; and only if
  // the edition has nothing else, whatever comes first.
  const automatic =
    specific.find((entry) => fit(entry) && noPeople(entry)) ??
    specific.find(fit) ??
    withPhoto.find(fit) ??
    specific.find(isPhoto) ??
    withPhoto.find(isPhoto) ??
    specific[0] ??
    withPhoto[0];
  const coverSource = picked ?? automatic;
  if (!picked && coverSource?.analysis?.people === "main") {
    notes.push("Every usable photo in this edition is of people, so the cover shows one of them. Pick another photo on the Cover tab if you can.");
  }
  const coverFocus = focusOf(coverSource?.analysis ?? null);
  // The cover uses a copy of the photo with the site's watermark taken out.
  const coverFrom = Date.now();
  const briefing = coverSource?.main ? await coverBrief(coverSource.main, settings.ai.textModel) : null;
  const coverPhoto = coverSource?.main ? await withoutWatermark(coverSource.main, briefing?.watermark ?? null) : null;
  timer.add({ name: "Cover: Claude's notes on the photo, and taking out the watermark", by: "claude", ms: Date.now() - coverFrom, ...(Date.now() - coverFrom < 400 ? { detail: "already done for this photo" } : {}) });

  // How the wide photo is fitted to the tall page. The person's choice comes first. Otherwise the photo is
  // extended above and below by AI; without an OpenAI key it is cropped when the whole subject fits a
  // tall page, and shown whole on a blurred copy of itself when it does not.
  const fitsCrop = Boolean(coverPhoto && coverFocus && fitsPortraitCover(coverPhoto, coverFocus));
  const style: CoverStyle = isCoverStyle(earlier[0]?.cover_style) ? earlier[0].cover_style : imageAiAvailable() ? "ai" : fitsCrop ? "crop" : "blur";
  let coverMode: "ai-extend" | "crop" | "full" = style === "ai" ? "ai-extend" : style === "crop" ? "crop" : "full";
  let coverPending = false;
  if (coverPhoto && coverMode === "ai-extend" && !(await hasAiCover(coverPhoto))) {
    const rejected = await aiCoverRejection(coverPhoto);
    if (rejected) {
      // Painted before and judged faulty: not painted (and paid for) again until the person asks for a new version.
      notes.push(`The AI cover for this photo had a fault (${rejected}) and is not used; the cover shows the whole photo on a blurred background. Press "Paint a new version" on the Cover tab to try again, or pick another photo.`);
      coverMode = "full";
    } else if (options.live && !options.paint) {
      // The pages are shown at once with a blurred background; the painting (a paid request that takes a while)
      // is done apart from this, and the pages are built again when it is there.
      coverPending = true;
      coverMode = "full";
    } else {
      // One paid request per cover photo, a second only when Claude finds a fault in the first. The result is kept
      // and reused by every later PDF. Two runs that want the same picture at once share one painting.
      const photo = coverPhoto;
      const key = aiCoverPath(photo);
      let painting = paintings.get(key);
      const mine = !painting;
      if (!painting) {
        painting = (async () => {
          let fault: string | null = null;
          for (let attempt = 1; attempt <= 2; attempt++) {
            const paintFrom = Date.now();
            try {
              const file = await extendCoverPhoto(photo, settings.ai.imageModel, coverSource?.analysis?.subject ?? "", briefing);
              timer.add({ name: attempt === 1 ? "Cover: AI paints above and below the photo" : "Cover: AI paints it a second time", by: "openai", ms: Date.now() - paintFrom, detail: "one request to OpenAI" });
              fault = await timer.step("Cover: Claude checks the AI picture for repeated parts and joins", "claude", () => coverFlaws(file, settings.ai.textModel), (found) => (found ? `fault found: ${found}` : "no fault found"));
              if (!fault) break;
            } catch (error) {
              timer.add({ name: "Cover: AI paints above and below the photo", by: "openai", ms: Date.now() - paintFrom, detail: "failed" });
              console.error("cover extension failed", error);
              fault = `the request failed: ${error instanceof Error ? error.message : "unknown error"}`;
              break;
            }
          }
          if (fault && !fault.startsWith("the request failed")) await rejectAiCover(photo, fault);
          return fault;
        })().finally(() => paintings.delete(key));
        paintings.set(key, painting);
      }
      const waitFrom = Date.now();
      const fault = await painting;
      if (!mine) timer.add({ name: "Cover: waiting for the AI picture that was already being painted", by: "openai", ms: Date.now() - waitFrom });
      if (fault) {
        notes.push(`The AI cover was not used (${fault}). The cover shows the whole photo on a blurred background instead. Press "Paint a new version" on the Cover tab to try again, or pick another photo.`);
        coverMode = "full";
      }
    }
  }
  const coverFile = !coverPhoto
    ? null
    : coverMode === "ai-extend"
      ? aiCoverPath(coverPhoto)
      : coverMode === "crop"
        ? await coverCrop(coverPhoto, coverFocus ?? { x: 0.5, y: 0.5, left: 0, right: 1, top: 0, bottom: 1 })
        : await coverArtwork(coverPhoto);
  if (coverSource && !options.live) {
    await appExecute(
      `INSERT INTO mg_edition_front_matter (edition_id, cover_source, cover_post_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE cover_source = VALUES(cover_source), cover_post_id = VALUES(cover_post_id)`,
      [edition.id, coverMode, coverSource.article.postId],
    );
  }

  const frontMatter = await appQuery<{ foreword: string | null; cover_line: string | null }>(
    "SELECT foreword, cover_line FROM mg_edition_front_matter WHERE edition_id = ?",
    [edition.id],
  );
  const storedForeword = frontMatter[0]?.foreword?.trim();
  const editionMonth = shiftMonth(edition.contentMonth, 1);

  const model: MagazineModel = {
    verticalKey: edition.vertical,
    title: `Race Auto India ${label} E-Magazine, ${edition.editionLabel}`,
    coverSubtitle: vertical?.coverSubtitle || label,
    monthShort: monthShort(editionMonth),
    year: Number(editionMonth.slice(0, 4)),
    cover: {
      artwork: coverFile ? fileUrl(coverFile) : null,
      // The cover's artwork already has the page's shape; a person can only zoom into it and then move it.
      frame: coverFile ? { key: "cover", full: fileUrl(coverFile), ...(frames.get("cover")?.framing ?? { x: 0.5, y: 0.5, zoom: 1 }), edited: Boolean(frames.get("cover")?.framing) } : undefined,
      line: frontMatter[0]?.cover_line?.trim() || (coverSource ? (texts.get(coverSource.article.id)?.title ?? coverSource.article.post?.title) : "") || "",
    },
    reportAdvert: vertical?.reportAdvert ?? "",
    advertImage: await optionalAsset("magazine", `advert-${edition.vertical}.jpg`),
    foreword: storedForeword
      ? storedForeword.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
      : defaultForeword(
          edition,
          label,
          articles.map((article) => article.title),
          included.filter((article) => article.section === "national").length,
        ),
    articles,
    assets: {
      logoWhite: fileUrl(assetDir("magazine", "logo-white.png")),
      logoBlackText: fileUrl(assetDir("magazine", "logo-black-text.png")),
      logoWhiteText: fileUrl(assetDir("magazine", "logo-white-text.png")),
      director: fileUrl(assetDir("magazine", "director.jpg")),
      qr: fileUrl(assetDir("magazine", "qr-raceinnovations.png")),
      backCover: fileUrl(assetDir("magazine", "back-cover.jpg")),
    },
    fonts: fonts(),
  };
  return { model, adverts, coverPending };
}

// AI covers being painted now, by the file they will be kept in.
const paintings = new Map<string, Promise<string | null>>();

type LayoutReport = { pages?: number; starts?: Record<string, number>; adverts?: Record<string, number>; broken?: string[]; cut?: string[]; error?: string };

async function printPdf(htmlFile: string, pdfFile: string, coverFile: string, pagesDir: string, timer: Timer): Promise<LayoutReport> {
  let mark = Date.now();
  const lap = (name: string, detail?: string) => {
    const step: TimingStep = { name, by: "app", ms: Date.now() - mark, ...(detail ? { detail } : {}) };
    timer.add(step);
    mark = Date.now();
  };
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      // The document and its fonts and images are local files.
      "--allow-file-access-from-files",
      // Chromium refuses its sandbox when started as root, which is common on a VPS.
      ...(process.getuid?.() === 0 ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
    ],
  });
  try {
    const page = await browser.newPage();
    // Nothing in the document may reach the network.
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().startsWith("file:") || request.url().startsWith("data:")) void request.continue();
      else void request.abort();
    });
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.goto(fileUrl(htmlFile), { waitUntil: "load", timeout: 120_000 });
    await page.waitForFunction("window.__magazine !== undefined", { timeout: 120_000 });
    const report = (await page.evaluate("window.__magazine")) as LayoutReport;
    if (report.error) throw new Error(`Page layout failed: ${report.error}`);

    const cover = await page.$(".page.cover");
    lap("Laying out the pages (fitting text, choosing layouts, numbering)", `${report.pages ?? 0} pages`);
    if (cover) await cover.screenshot({ path: coverFile as `${string}.jpeg`, type: "jpeg", quality: 90 });

    // One picture per page for the on-screen magazine reader: sharp on a full screen, far lighter than the print pages.
    const boxes = (await page.evaluate(
      "Array.from(document.querySelectorAll('.page')).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }; })",
    )) as { x: number; y: number; width: number; height: number }[];
    for (const [index, box] of boxes.entries()) {
      await page.screenshot({
        path: path.join(pagesDir, `${index + 1}.jpg`) as `${string}.jpg`,
        type: "jpeg",
        quality: 80,
        clip: { ...box, scale: 0.75 },
      });
    }

    lap("Pictures of each page for the on-screen reader", `${boxes.length} pictures`);
    await page.pdf({
      path: pdfFile,
      width: "210mm",
      height: "297mm",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 300_000,
    });
    lap("Writing the PDF file");
    return report;
  } finally {
    await browser.close();
  }
}

// One render at a time: Chromium is heavy and the server is shared with the main site.
let queue: Promise<unknown> = Promise.resolve();

/** Builds the edition's PDF and cover image and records them on the edition. */
export function renderEdition(editionId: number, why: { label: string; by?: string | null } = { label: "PDF created" }): Promise<RenderResult> {
  const asked = Date.now();
  const run = queue.then(() => renderNow(editionId, why, Date.now() - asked));
  queue = run.catch(() => undefined);
  return run;
}

async function renderNow(editionId: number, why: { label: string; by?: string | null }, waited: number): Promise<RenderResult> {
  const timer = new Timer();
  // Only one PDF is made at a time; a run that had to wait says so.
  if (waited > 500) timer.add({ name: "Waiting for another PDF to finish", by: "app", ms: waited });
  try {
    return await renderTimed(editionId, timer, waited);
  } finally {
    // Recorded whether it worked or not: a failed run took the time too.
    await recordTiming(editionId, "pdf", why.label, timer, why.by, timer.total() + waited);
  }
}

async function renderTimed(editionId: number, timer: Timer, waited: number): Promise<RenderResult> {
  // An advert whose article has left the magazine is given a new place first.
  const repairFrom = Date.now();
  const repaired = await repairAdverts(editionId).catch((error) => {
    console.error("placing adverts again failed", error);
    return 0;
  });
  if (repaired > 0) timer.add({ name: "Adverts: choosing a new place for those whose article was taken out", by: "claude", ms: Date.now() - repairFrom, detail: `${repaired} advert(s)` });
  const edition = await getEdition(editionId);
  if (!edition) throw new Error("Edition not found.");
  if (!edition.articles.some((article) => article.included && article.post)) {
    throw new Error("This edition has no articles to print.");
  }

  // Marked as "being printed". Any change made while this runs marks the edition as changed again, and then this
  // PDF does not count as showing the latest changes.
  await appExecute("UPDATE mg_editions SET pdf_stale = ? WHERE id = ?", [PRINTING, edition.id]);
  try {
    return await printEdition(edition, timer, waited);
  } catch (error) {
    await appExecute("UPDATE mg_editions SET pdf_stale = 1 WHERE id = ? AND pdf_stale = ?", [edition.id, PRINTING]).catch(() => undefined);
    throw error;
  }
}

/** The value of pdf_stale while a PDF is being made: 0 = up to date, 1 = changed since. */
const PRINTING = 2;

async function printEdition(edition: Edition, timer: Timer, waited: number): Promise<RenderResult> {
  const notes: string[] = [];
  const { model, adverts } = await buildModel(edition, notes, timer);

  const directory = dataDir("editions", String(edition.id));
  await fs.mkdir(directory, { recursive: true });
  const htmlFile = path.join(directory, "magazine.html");
  const pdfFile = path.join(directory, "magazine.pdf");
  const coverFile = path.join(directory, "cover.jpeg");
  await fs.writeFile(htmlFile, buildMagazineHtml(model), "utf8");

  // Printed to temporary files and swapped in only when both are complete,
  // so a failed run never replaces a good PDF with half a file.
  const pdfTemp = `${pdfFile}.new`;
  const coverTemp = path.join(directory, "cover.new.jpeg");
  const pagesDir = path.join(directory, "pages");
  const pagesTemp = path.join(directory, "pages.new");
  let report: LayoutReport;
  try {
    await fs.rm(pagesTemp, { recursive: true, force: true });
    await fs.mkdir(pagesTemp, { recursive: true });
    report = await printPdf(htmlFile, pdfTemp, coverTemp, pagesTemp, timer);
    // What the reader needs to know: how many pages, and where each article starts.
    const contents = model.articles.flatMap((article) => {
      const page = report.starts?.[String(article.id)];
      return page ? [{ page, title: article.title }] : [];
    });
    // Adverts are listed too, so the reader can jump to them.
    for (const advert of adverts) {
      const page = report.adverts?.[String(advert.placementId)];
      if (page) contents.push({ page, title: `Advert: ${advert.advertiser}` });
    }
    contents.sort((a, b) => a.page - b.page);
    const advertPages = Object.fromEntries(adverts.flatMap((advert) => (report.adverts?.[String(advert.placementId)] ? [[advert.placementId, report.adverts[String(advert.placementId)]]] : [])));
    await fs.writeFile(path.join(pagesTemp, "index.json"), JSON.stringify({ pages: report.pages ?? 0, contents, adverts: advertPages }));
    await fs.rename(pdfTemp, pdfFile);
    await fs.rename(coverTemp, coverFile);
    await fs.rm(pagesDir, { recursive: true, force: true });
    await fs.rename(pagesTemp, pagesDir);
  } finally {
    await fs.rm(pdfTemp, { force: true });
    await fs.rm(coverTemp, { force: true });
    await fs.rm(pagesTemp, { recursive: true, force: true });
  }
  const pageCount = report.pages ?? 0;
  if (report.broken?.length) notes.push(`${report.broken.length} image(s) did not load.`);
  for (const where of report.cut ?? []) {
    if (where === "foreword") notes.push("The foreword is too long for its page and is cut off at the end. Shorten it.");
    else if (where === "contents") notes.push("The contents pages cannot hold this many articles; some entries are cut off.");
    else {
      const title = model.articles.find((article) => String(article.id) === where)?.title ?? where;
      notes.push(`Part of the text of "${title}" does not fit on its pages and is cut off.`);
    }
  }

  const kept = edition.warnings.filter((warning) => !warning.message.startsWith(PDF_PREFIX));
  const warnings: EditionWarning[] = [
    ...kept,
    ...notes.map((message) => ({ level: "warning" as const, message: PDF_PREFIX + message })),
  ];
  await appExecute("UPDATE mg_editions SET pdf_path = ?, cover_path = ?, page_count = ?, pdf_stale = IF(pdf_stale = ?, 0, 1), warnings = ? WHERE id = ?", [
    pdfFile,
    coverFile,
    pageCount,
    PRINTING,
    JSON.stringify(warnings),
    edition.id,
  ]);
  return { pageCount, notes, ms: timer.total() + waited };
}

export type EditionFiles = { pdf: string; cover: string; pagesDir: string; pageCount: number; vertical: string; contentMonth: string };

/** Paths of the files made by the last render, or null when there is none yet. */
export async function editionFiles(editionId: number): Promise<EditionFiles | null> {
  const rows = await appQuery<{ pdf_path: string | null; cover_path: string | null; page_count: number | null; vertical: string; content_month: string }>(
    "SELECT pdf_path, cover_path, page_count, vertical, content_month FROM mg_editions WHERE id = ?",
    [editionId],
  );
  const row = rows[0];
  if (!row?.pdf_path || !row.cover_path) return null;
  // Only ever serve files from this edition's own folder.
  const directory = dataDir("editions", String(editionId));
  if (path.dirname(row.pdf_path) !== directory || path.dirname(row.cover_path) !== directory) return null;
  return {
    pdf: row.pdf_path,
    cover: row.cover_path,
    pagesDir: path.join(directory, "pages"),
    pageCount: row.page_count ?? 0,
    vertical: row.vertical,
    contentMonth: row.content_month,
  };
}

const finishedDir = (editionId: number) => dataDir("finished", String(editionId));

/**
 * Keeps a second copy of a finished edition's PDF, cover and page file, apart from the working folder. A finished
 * edition is what was published: if its working files are lost or overwritten, this copy is served, and it is
 * what a backup most needs to hold. The page file has every article's text as it was printed.
 */
export async function keepFinishedCopy(editionId: number): Promise<void> {
  const files = await editionFiles(editionId);
  if (!files) return;
  const target = finishedDir(editionId);
  await fs.mkdir(target, { recursive: true });
  for (const file of [files.pdf, files.cover, path.join(path.dirname(files.pdf), "magazine.html")]) {
    await fs.copyFile(file, path.join(target, path.basename(file))).catch((error) => console.error(`finished copy: ${path.basename(file)} of edition ${editionId} not kept`, error));
  }
}

/** The kept copy of a finished edition's PDF or cover, or null when there is none. */
export async function finishedCopy(editionId: number, kind: "pdf" | "cover"): Promise<string | null> {
  const file = path.join(finishedDir(editionId), kind === "pdf" ? "magazine.pdf" : "cover.jpeg");
  return fs.access(file).then(
    () => file,
    () => null,
  );
}

/** Removes everything made for an edition: its PDF, cover and page pictures. */
export async function removeEditionFiles(editionId: number): Promise<void> {
  await fs.rm(dataDir("editions", String(editionId)), { recursive: true, force: true });
}

export type ReaderIndex = { pages: number; contents: { page: number; title: string }[]; /** Page each advert starts on, by placement id. */ adverts?: Record<string, number> };

/** Page pictures for the on-screen reader, or null for an edition printed before the reader existed. */
export async function readerIndex(editionId: number): Promise<ReaderIndex | null> {
  try {
    const raw = await fs.readFile(path.join(dataDir("editions", String(editionId)), "pages", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as ReaderIndex;
    return parsed.pages > 0 && Array.isArray(parsed.contents) ? parsed : null;
  } catch {
    return null;
  }
}

export type CoverState = {
  mode: string | null;
  /** How the photo is fitted to the page, as chosen by a person; null = the default. */
  style: CoverStyle | null;
  /** Article whose photo is on the cover now. */
  postId: number | null;
  /** Article picked by hand, or null when the choice is automatic. */
  pick: number | null;
  /** Headline typed for the cover; empty means the article's own headline. */
  line: string;
};

export async function coverState(editionId: number): Promise<CoverState> {
  const rows = await appQuery<{
    cover_source: string | null;
    cover_style: string | null;
    cover_post_id: number | null;
    cover_pick_post_id: number | null;
    cover_line: string | null;
  }>("SELECT cover_source, cover_style, cover_post_id, cover_pick_post_id, cover_line FROM mg_edition_front_matter WHERE edition_id = ?", [
    editionId,
  ]);
  return {
    mode: rows[0]?.cover_source ?? null,
    style: isCoverStyle(rows[0]?.cover_style) ? rows[0].cover_style : null,
    postId: rows[0]?.cover_post_id ?? null,
    pick: rows[0]?.cover_pick_post_id ?? null,
    line: rows[0]?.cover_line ?? "",
  };
}

/** Stores the cover photo and headline chosen by hand (null and "" = automatic) and prints again. */
export async function chooseCover(editionId: number, postId: number | null, line: string, by?: string): Promise<RenderResult> {
  const before = await coverState(editionId);
  await appExecute(
    `INSERT INTO mg_edition_front_matter (edition_id, cover_pick_post_id, cover_line) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE cover_pick_post_id = VALUES(cover_pick_post_id), cover_line = VALUES(cover_line)`,
    [editionId, postId, line.trim().slice(0, 255) || null],
  );
  // How the old picture was moved and zoomed says nothing about the new one.
  if (before.pick !== postId) await resetFrame(editionId, "cover").catch(() => undefined);
  return renderEdition(editionId, { label: "Cover photo or headline changed, PDF created again", by });
}

/**
 * Stores how the cover photo is fitted to the page and prints the edition
 * again. With `repaint`, the AI-extended picture kept for the current cover
 * photo is thrown away first, so a new one is painted (one paid request).
 */
export async function setCoverStyle(editionId: number, style: CoverStyle, repaint: boolean, by?: string): Promise<RenderResult> {
  // Another style, or a newly painted picture, is another picture: its framing starts afresh.
  await resetFrame(editionId, "cover").catch(() => undefined);
  await appExecute(
    `INSERT INTO mg_edition_front_matter (edition_id, cover_style) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE cover_style = VALUES(cover_style)`,
    [editionId, style],
  );
  if (repaint) {
    const state = await coverState(editionId);
    const edition = await getEdition(editionId);
    const sourcePath = edition?.articles.find((entry) => entry.postId === state.postId)?.post?.image ?? null;
    const image = await prepareImage(sourcePath);
    if (image) {
      const { settings } = await getSettings();
      const brief = await coverBrief(image, settings.ai.textModel);
      await removeAiCover(await withoutWatermark(image, brief?.watermark ?? null));
    }
  }
  return renderEdition(editionId, { label: repaint ? "New AI cover painted, PDF created again" : "Cover style changed, PDF created again", by });
}

// ---------------------------------------------------------------- the Design tab

/** The address at which a signed-in browser can load one of this app's own files (a cached picture, an advert, a font). */
export function fileAddress(file: string): string {
  const root = path.resolve(/* turbopackIgnore: true */ process.cwd());
  return `/design-file?f=${encodeURIComponent(path.relative(root, file).split(path.sep).join("/"))}`;
}

/** The page with such addresses in place of its file: addresses. */
function toAppAddresses(html: string): string {
  return html.replace(/file:\/\/\/[^"')\s<>]+/g, (address) => {
    try {
      return fileAddress(fileURLToPath(address));
    } catch {
      return address;
    }
  });
}

/**
 * The magazine as one web page, laid out by the same script that lays out the PDF, for showing and editing in the
 * browser. With `only` it holds a single article, which is how a change to its text is tried out before it is saved.
 */
export async function designHtml(editionId: number, options: Pick<BuildOptions, "only" | "trial"> = {}): Promise<string | null> {
  const edition = await getEdition(editionId);
  if (!edition || !edition.articles.some((article) => article.included && article.post)) return null;
  const timer = new Timer();
  const { model, coverPending } = await buildModel(edition, [], timer, { ...options, live: true });
  const html = toAppAddresses(buildMagazineHtml(model));
  if (options.only !== undefined) return html;
  // What the Design tab needs to know about this build, read by it from the page: whether the cover is still to
  // be painted, and where the server's time went. The tab adds the browser's own share (loading the photos,
  // laying out the pages) and has the whole wait recorded, see recordDesignWait.
  const build = JSON.stringify({ ms: timer.total(), steps: timer.steps }).replace(/</g, "\\u003c");
  const facts = `<meta name="mg-cover-pending" content="${coverPending && edition.status === "draft" ? 1 : 0}"><script type="application/json" id="mg-build">${build}</script>`;
  return html.replace("<head>", () => `<head>${facts}`);
}

/** A wait shorter than this is not worth a line in the processing time (a rebuild after a small change). */
const DESIGN_WORTH_RECORDING = 2000;

/**
 * Records how long the person waited for the Design tab's pages: the server's steps as the page reported them,
 * and the rest as the browser's work. Short waits are left out.
 */
export async function recordDesignWait(editionId: number, waited: number, steps: TimingStep[], by?: string | null): Promise<boolean> {
  if (waited < DESIGN_WORTH_RECORDING) return false;
  const timer = new Timer();
  let server = 0;
  for (const step of steps) {
    timer.add(step);
    server += step.ms;
  }
  timer.add({ name: "In the browser: loading the photos and laying out the pages", by: "app", ms: Math.max(0, waited - server) });
  await recordTiming(editionId, "design", "Pages built for the Design tab", timer, by, waited);
  return true;
}

/**
 * Paints the AI cover this edition is waiting for, so the Design tab can show it before any PDF exists. The picture
 * is kept and reused by every later PDF, so this is the same one paid request the first PDF would have made.
 */
export async function paintCover(editionId: number, by?: string | null): Promise<{ painted: boolean; note: string | null }> {
  const edition = await getEdition(editionId);
  if (!edition || !edition.articles.some((article) => article.included && article.post)) throw new Error("This edition has no articles.");
  if (edition.status !== "draft") throw new Error("This edition is finished. Reopen it to change it.");
  const timer = new Timer();
  const notes: string[] = [];
  try {
    await buildModel(edition, notes, timer, { live: true, paint: true });
  } finally {
    await recordTiming(editionId, "design", "AI cover painted for the Design tab", timer, by);
  }
  const note = notes.find((entry) => entry.startsWith("The AI cover")) ?? null;
  return { painted: note === null, note };
}

export type ArticleText = {
  articleId: number;
  title: string;
  paragraphs: string[];
  /** The post as the website has it now. */
  original: { title: string; paragraphs: string[] };
  edited: boolean;
  /** The website's version has changed since the edit was made here. */
  siteChanged: boolean;
};

/** An article's headline and text as this edition prints them, with the website's own for comparison. */
export async function articleText(editionId: number, articleId: number): Promise<ArticleText | null> {
  const edition = await getEdition(editionId);
  const article = edition?.articles.find((entry) => entry.id === articleId);
  if (!article?.post) return null;
  const contents = await fetchPostContents([article.postId]);
  const original = { title: article.post.title.replace(/\s+/g, " ").trim(), paragraphs: toParagraphs(contents.get(article.postId) ?? "") };
  const text = (await textEdits(editionId)).get(articleId);
  const edited = Boolean(text && (text.title !== null || text.paragraphs !== null));
  return {
    articleId,
    title: text?.title ?? original.title,
    paragraphs: text?.paragraphs ?? original.paragraphs,
    original,
    edited,
    siteChanged: edited && text!.baseHash !== textHash(original.title, original.paragraphs),
  };
}
