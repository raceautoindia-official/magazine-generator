import { createHash } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getEdition, type EditionArticle } from "@/lib/editions";
import { monthLabel } from "@/lib/months";
import { getSettings } from "@/lib/settings";
import { editionTimings } from "@/lib/timing";
import { activeJob } from "@/lib/jobs";
import { claudeAvailable } from "@/lib/ai/claude";
import { getForeword } from "@/lib/ai/foreword";
import { imageAiAvailable } from "@/lib/ai/openai-image";
import { storedTypes } from "@/lib/ai/types";
import { extraImageStates, publicImageUrl } from "@/lib/magazine/extras";
import { articleText, coverState, readerIndex } from "@/lib/magazine/render";
import { frameEdits, parseFrame, textEdits } from "@/lib/design";
import { advertSuggestions, editionAdverts } from "@/lib/advert-placement";
import { sizeSpec } from "@/lib/advert-sizes";
import { listAdverts } from "@/lib/adverts";
import { ArticleEditor } from "./article-editor";
import { CoverPanel } from "./cover-panel";
import { DesignPanel, type DesignChange } from "./design-panel";
import { ExtraImagesPanel } from "./extra-images-panel";
import { ForewordPanel } from "./foreword-panel";
import { PdfPanel } from "./pdf-panel";
import { ProcessingTime } from "./processing-time";
import { Workspace } from "./workspace";

const SOURCE_LABEL = { category: "Category", keyword: "Words", ai: "Claude", general: "General", manual: "Added by hand" } as const;

function ArticleTable({
  articles,
  numbered,
  typeLabels,
}: {
  articles: EditionArticle[];
  numbered: boolean;
  typeLabels: Map<string, string>;
}) {
  return (
    <table className="mt-3 w-full border-collapse bg-white text-sm">
      <thead>
        <tr className="border-b border-neutral-300 text-left">
          {numbered && <th className="px-3 py-2 text-right">#</th>}
          <th className="px-3 py-2">Section</th>
          <th className="px-3 py-2">Type</th>
          <th className="px-3 py-2">Headline</th>
          <th className="px-3 py-2">Why it is here</th>
          <th className="px-3 py-2 text-right">Words</th>
          <th className="px-3 py-2 text-right">Views</th>
        </tr>
      </thead>
      <tbody>
        {articles.map((article, index) => (
          <tr key={article.id} className="border-b border-neutral-200 align-top">
            {numbered && <td className="px-3 py-2 text-right tabular-nums">{index + 1}</td>}
            <td className="px-3 py-2">{article.section === "national" ? "National" : "International"}</td>
            <td className="px-3 py-2">{typeLabels.get(article.type) ?? article.type}</td>
            <td className="px-3 py-2">
              {article.post ? (
                <>
                  <span className="font-medium">{article.post.title}</span>
                  <span className="block text-xs text-neutral-600">
                    {article.post.createdAt.slice(0, 10)} · {article.post.categoryName ?? "No category"} ·{" "}
                    {article.post.marketName ?? "No market"}
                    {article.post.extraImages.length > 0 && ` · ${article.post.extraImages.length} extra image(s)`}
                  </span>
                </>
              ) : (
                <span className="text-red-800">Post {article.postId} no longer exists on the main site</span>
              )}
            </td>
            <td className="px-3 py-2 text-neutral-700">
              {SOURCE_LABEL[article.assignedBy]}
              {article.note && <span className="block text-xs text-neutral-600">{article.note}</span>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{article.post?.words ?? ""}</td>
            <td className="px-3 py-2 text-right tabular-nums">{article.post?.pageviews ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function EditionPage({ params }: PageProps<"/editions/[id]">) {
  await requireUser();
  const { id } = await params;
  const edition = /^\d+$/.test(id) ? await getEdition(Number(id)) : null;
  if (!edition) notFound();

  const { settings } = await getSettings();
  const label = settings.verticals.find((vertical) => vertical.key === edition.vertical)?.label ?? edition.vertical;
  const included = edition.articles.filter((article) => article.included);
  const leftOut = edition.articles.filter((article) => !article.included);
  const draft = edition.status === "draft";
  const labelOfType = new Map(settings.types.map((type) => [type.key, type.label]));
  // Why an article has its type, shown while the type is still the one Claude chose.
  const aiTypes = await storedTypes(
    edition.articles.flatMap((article) => (article.post ? [article.post] : [])),
    settings,
  );
  const typeNote = (article: EditionArticle) => {
    const chosen = aiTypes.get(article.postId);
    return chosen && chosen.type === article.type ? `Type read from the article by Claude: ${chosen.reason}` : "";
  };
  const types = settings.ordering.types.map((key) => ({ key, label: labelOfType.get(key) ?? key }));
  const cover = await coverState(edition.id);

  const extraStates = draft ? await extraImageStates(included.flatMap((article) => article.post?.extraImages ?? [])) : new Map();
  const extraImages = included.flatMap((article) =>
    (article.post?.extraImages ?? []).flatMap((path) => {
      const state = extraStates.get(path);
      return state ? [{ path, url: state.url, manual: state.manual ?? "", usedAs: state.usedAs, title: article.post!.title }] : [];
    }),
  );

  const coverChoices = included.flatMap((article) =>
    article.post?.image ? [{ postId: article.postId, title: article.post.title, image: publicImageUrl(article.post.image) }] : [],
  );
  // What was changed on the Design tab, listed there with a way back.
  const FRAME_WORDS = { spread: "Opening photo", photo: "Full-page photo", tail: "Photo under the text", band: "Photo beside the advert" } as const;
  const titleOfRow = (rowId: number) => edition.articles.find((article) => article.id === rowId)?.post?.title.trim() ?? "an article no longer in this edition";
  const designChanges: DesignChange[] = [];
  for (const [frame, change] of await frameEdits(edition.id)) {
    const parsed = parseFrame(frame);
    if (!parsed) continue;
    const how = [change.source ? "another picture" : "", change.framing ? "moved or zoomed" : ""].filter(Boolean).join(", ");
    designChanges.push({
      kind: "frame",
      id: frame,
      what: `${parsed === "cover" ? "Cover picture" : FRAME_WORDS[parsed.slot]}: ${how || "changed"}`,
      article: parsed === "cover" ? "" : titleOfRow(parsed.articleId),
    });
  }
  for (const [rowId, text] of await textEdits(edition.id)) {
    if (text.title === null && text.paragraphs === null) continue;
    const now = await articleText(edition.id, rowId);
    designChanges.push({
      kind: "text",
      id: String(rowId),
      what: [text.title !== null ? "Headline" : "", text.paragraphs !== null ? "Text" : ""].filter(Boolean).join(" and ") + " edited",
      article: titleOfRow(rowId),
      siteChanged: now?.siteChanged ?? false,
    });
  }
  const timings = await editionTimings(edition.id);
  const reader = edition.pageCount !== null ? await readerIndex(edition.id) : null;
  const placed = (await editionAdverts(edition.id)).map((advert) => ({
    id: advert.id,
    advertId: advert.advertId,
    advertiser: advert.advertiser,
    size: advert.size,
    sizeLabel: sizeSpec(advert.size)?.label ?? advert.size,
    articleId: advert.articleId,
    reason: advert.reason,
    placedBy: advert.placedBy,
    warning: advert.warning,
    // Page numbers are only true while the PDF shows the latest changes.
    page: !edition.pdfStale ? (reader?.adverts?.[String(advert.id)] ?? null) : null,
  }));
  // What Claude suggested for the adverts not in the edition yet; asked for by the picker when something is missing.
  const suggested = draft ? await advertSuggestions(edition.id) : { suggestions: new Map(), missing: 0 };
  const rank = { advertiser: 0, product: 1, segment: 2, none: 4 } as const;
  const advertLibrary = draft
    ? (await listAdverts())
        .filter((advert) => !advert.archived && !placed.some((entry) => entry.advertId === advert.id))
        .map((advert) => ({
          id: advert.id,
          advertiser: advert.advertiser || advert.originalName,
          sizeLabel: sizeSpec(advert.size)?.label ?? advert.size,
          summary: advert.summary,
          suits: advert.analysis?.segments.includes(edition.vertical) ?? false,
          suggestion: suggested.suggestions.get(advert.id) ?? null,
        }))
        // The adverts closest to this edition's articles come first, then those addressed to its readers.
        .sort((a, b) => (a.suggestion ? rank[a.suggestion.relation as keyof typeof rank] : 3) - (b.suggestion ? rank[b.suggestion.relation as keyof typeof rank] : 3) || Number(b.suits) - Number(a.suits))
    : [];
  const foreword = await getForeword(edition.id);
  // Everything outside the Design tab that changes what its pages show. When this changes, the tab builds its
  // pages again; its own changes (a photo moved, a text edited) are not in it, since it shows those as they are made.
  const designVersion = createHash("sha1")
    .update(
      JSON.stringify([
        edition.status,
        included.map((article) => [article.id, article.section, article.type]),
        foreword,
        cover,
        placed.map((advert) => [advert.id, advert.articleId, advert.size]),
        extraImages.map((image) => [image.path, image.manual]),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  const warnings = edition.warnings.filter((warning) => warning.level === "warning");
  const notes = edition.warnings.filter((warning) => warning.level !== "warning");

  return (
    <>
      <p className="text-sm">
        <Link href={`/?month=${edition.contentMonth}`} className="underline">
          ← All editions
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">
          {label}, {edition.editionLabel} edition
        </h1>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${draft ? "bg-sky-100 text-sky-950" : "bg-green-100 text-green-950"}`}>
          {draft ? "Draft" : "Finished"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-neutral-600">
          Made from posts published in {monthLabel(edition.contentMonth)}. Generated {edition.createdAt.slice(0, 16)} by {edition.createdBy}.
        </p>
        <ProcessingTime runs={timings} />
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-bold">
            {warnings.length} {warnings.length === 1 ? "thing" : "things"} to check
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((warning) => (
              <li key={warning.message}>{warning.message.replace(/^PDF: /, "")}</li>
            ))}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <details className="mt-3 text-sm text-neutral-700">
          <summary className="cursor-pointer">
            {notes.length} {notes.length === 1 ? "note" : "notes"} about how this edition was put together
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {notes.map((note) => (
              <li key={note.message}>{note.message}</li>
            ))}
          </ul>
        </details>
      )}

      <Workspace
        id={edition.id}
        runningJob={await activeJob(`pdf:${edition.id}`)}
        draft={draft}
        pageCount={edition.pageCount}
        stale={edition.pdfStale}
        articleCount={included.length}
        articles={
          draft ? (
            <ArticleEditor
              editionId={edition.id}
              ordering={settings.ordering}
              types={types}
              sectionLabels={settings.sectionLabels}
              counts={settings.counts}
              adverts={placed}
              advertLibrary={advertLibrary}
              editionName={label}
              needsSuggestions={claudeAvailable() && suggested.missing > 0}
              canAskClaude={claudeAvailable()}
              otherEditions={settings.verticals
                .filter((vertical) => vertical.key !== edition.vertical)
                .map((vertical) => ({ key: vertical.key, label: vertical.label }))}
              articles={edition.articles.map((article) => ({
                id: article.id,
                included: article.included,
                section: article.section,
                type: article.type,
                title: article.post?.title ?? `Post ${article.postId} no longer exists on the main site`,
                details: article.post
                  ? `${article.post.createdAt.slice(0, 10)} · ${article.post.categoryName ?? "No category"} · ${article.post.marketName ?? "No market"}` +
                    (article.post.extraImages.length > 0 ? ` · ${article.post.extraImages.length} extra image(s)` : "")
                  : "",
                why: [article.note || SOURCE_LABEL[article.assignedBy], typeNote(article)].filter(Boolean).join(" · "),
                words: article.post?.words ?? null,
                views: article.post?.pageviews ?? null,
                thumb: article.post?.image ? publicImageUrl(article.post.image) : null,
                missing: !article.post,
              }))}
            />
          ) : (
            <>
              <h2 className="text-lg font-bold">Articles in page order ({included.length})</h2>
              <ArticleTable articles={included} numbered typeLabels={labelOfType} />
              {placed.length > 0 && (
                <>
                  <h2 className="mt-10 text-lg font-bold">Adverts ({placed.length})</h2>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {placed.map((advert) => (
                      <li key={advert.id} className="rounded border border-violet-300 bg-violet-50 px-3 py-2">
                        <span className="font-medium">
                          {advert.advertiser || "Advertiser not named"} · {advert.sizeLabel}
                          {advert.page !== null && ` · page ${advert.page}`}
                        </span>
                        <span className="block text-neutral-700">
                          With “{included.find((article) => article.id === advert.articleId)?.post?.title ?? "an article no longer in the magazine"}”. {advert.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {leftOut.length > 0 && (
                <>
                  <h2 className="mt-10 text-lg font-bold">Available, not included ({leftOut.length})</h2>
                  <ArticleTable articles={leftOut} numbered={false} typeLabels={labelOfType} />
                </>
              )}
            </>
          )
        }
        foreword={<ForewordPanel id={edition.id} initial={foreword} canWrite={claudeAvailable()} locked={!draft} />}
        cover={
          <>
            <CoverPanel
              id={edition.id}
              hasCover={edition.pageCount !== null}
              mode={cover?.mode ?? null}
              style={cover?.style ?? null}
              canExtend={imageAiAvailable()}
              version={edition.updatedAt}
              locked={!draft}
              pick={cover?.pick ?? null}
              onCover={cover?.postId ?? null}
              line={cover?.line ?? ""}
              choices={coverChoices}
            />
            {draft && extraImages.length > 0 && <ExtraImagesPanel id={edition.id} images={extraImages} />}
          </>
        }
        design={
          <DesignPanel
            id={edition.id}
            draft={draft}
            hasArticles={included.some((article) => article.post)}
            changes={designChanges}
            version={designVersion}
            coverJob={draft ? await activeJob(`cover:${edition.id}`) : null}
            canPaint={imageAiAvailable()}
            articles={included.flatMap((article) => (article.post ? [{ rowId: article.id, title: article.post.title.trim() }] : []))}
          />
        }
        preview={
          <PdfPanel
            id={edition.id}
            pageCount={edition.pageCount}
            version={edition.updatedAt}
            stale={edition.pdfStale}
            reader={reader}
          />
        }
      />
    </>
  );
}
