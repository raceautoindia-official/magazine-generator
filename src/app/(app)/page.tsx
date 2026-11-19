import Link from "next/link";
import { storedPlacements } from "@/lib/ai/placement";
import { storedTypes } from "@/lib/ai/types";
import { requireUser } from "@/lib/auth";
import { listEditions, type EditionSummary } from "@/lib/editions";
import { currentMonth, editionLabel, isMonth, monthLabel, shiftMonth } from "@/lib/months";
import { collectPosts } from "@/lib/posts";
import { assignmentsOf, planEdition } from "@/lib/selection";
import { formatDuration } from "@/lib/duration";
import { getSettings } from "@/lib/settings";
import { timingTotals } from "@/lib/timing";
import { activeJobLike } from "@/lib/jobs";
import { GenerateForm, type PreviewRow } from "./generate-form";
import { MonthPicker } from "./month-picker";

function EditionCard({ edition, label, workedMs }: { edition: EditionSummary; label: string; workedMs: number | undefined }) {
  const warnings = edition.warnings.filter((warning) => warning.level === "warning");
  const draft = edition.status === "draft";
  const state = !draft
    ? { text: "Finished", tone: "bg-green-100 text-green-950" }
    : edition.pageCount === null
      ? { text: "Draft, no PDF yet", tone: "bg-sky-100 text-sky-950" }
      : edition.pdfStale
        ? { text: "Draft, PDF out of date", tone: "bg-amber-100 text-amber-950" }
        : { text: "Draft, PDF ready", tone: "bg-sky-100 text-sky-950" };

  return (
    <li>
      <Link
        href={`/editions/${edition.id}`}
        className="flex h-full gap-4 rounded border border-neutral-300 bg-white p-3 hover:border-neutral-500 hover:shadow"
      >
        {edition.pageCount !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by a protected route, not a static asset
          <img
            src={`/editions/${edition.id}/cover?v=${encodeURIComponent(edition.updatedAt)}`}
            alt=""
            loading="lazy"
            className="h-32 w-[5.65rem] flex-none border border-neutral-200 object-cover"
          />
        ) : (
          <div className="flex h-32 w-[5.65rem] flex-none items-center justify-center border border-dashed border-neutral-300 bg-neutral-100 p-2 text-center text-xs text-neutral-600">
            No cover yet
          </div>
        )}
        <div className="min-w-0 text-sm">
          <p className="text-base font-bold leading-snug">{label}</p>
          <p className="text-neutral-700">{edition.editionLabel} edition</p>
          <p className="mt-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${state.tone}`}>{state.text}</span>
          </p>
          <p className="mt-1.5 text-neutral-700">
            {edition.included} articles{edition.pageCount !== null && `, ${edition.pageCount} pages`}
          </p>
          {warnings.length > 0 && (
            <p className="text-amber-800" title={warnings.map((warning) => warning.message).join("\n")}>
              {warnings.length} {warnings.length === 1 ? "thing" : "things"} to check
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-500">
            Made {edition.createdAt.slice(0, 10)} by {edition.createdBy}
            {workedMs !== undefined && (
              <span title="How long the application has worked on this edition. Open it for the breakdown."> · ⏱ {formatDuration(workedMs)}</span>
            )}
          </p>
        </div>
      </Link>
    </li>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  await requireUser();
  const params = await searchParams;
  // Default to last month: an edition is made from the previous month's posts.
  const month = isMonth(params.month) ? params.month : shiftMonth(currentMonth(), -1);

  const { settings } = await getSettings();
  const [posts, editions, worked] = await Promise.all([collectPosts(month), listEditions(), timingTotals()]);

  // The plan Generate would save. Posts Claude has not been asked about yet count as general here;
  // Generate asks about them, so the result can include a few more.
  const placements = await storedPlacements(posts);
  const aiTypes = await storedTypes(posts, settings);
  const rows: PreviewRow[] = settings.verticals.map((vertical) => {
    const { candidates } = planEdition(posts, vertical.key, settings, placements, aiTypes);
    const included = candidates.filter((candidate) => candidate.included);
    return {
      key: vertical.key,
      label: vertical.label,
      byCategory: candidates.filter((candidate) => candidate.assignedBy === "category").length,
      byWords: candidates.filter((candidate) => candidate.assignedBy === "keyword" || candidate.assignedBy === "ai").length,
      general: candidates.filter((candidate) => candidate.assignedBy === "general").length,
      national: included.filter((candidate) => candidate.section === "national").length,
      international: included.filter((candidate) => candidate.section === "international").length,
      included: included.length,
      existing: editions
        .filter((edition) => edition.contentMonth === month && edition.vertical === vertical.key)
        .map((edition) => ({ id: edition.id, finished: edition.status === "finished" })),
    };
  });
  const unused = posts.filter((post) => assignmentsOf(post, settings, placements).length === 0).length;
  const general = rows[0]?.general ?? 0;
  const labels = new Map(settings.verticals.map((vertical) => [vertical.key, vertical.label]));
  const ofMonth = editions.filter((edition) => edition.contentMonth === month);
  const others = editions.filter((edition) => edition.contentMonth !== month);
  const now = currentMonth();

  return (
    <>
      <h1 className="text-2xl font-bold">Make a magazine</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-700">
        A magazine is made from the posts published in one month and is issued as the next month&apos;s edition. Choose the
        month, tick the editions, and generate drafts. Nothing is generated by itself.
      </p>

      <section className="mt-6 rounded border border-neutral-300 bg-neutral-100/60 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-lg font-bold">1. Posts published in</h2>
          <MonthPicker month={month} max={now} previous={shiftMonth(month, -1)} next={month < now ? shiftMonth(month, 1) : null} />
          <p className="text-sm text-neutral-700">
            {posts.length} posts. They become the <strong>{editionLabel(month)}</strong> edition.
          </p>
        </div>
        {month === now && (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {monthLabel(month)} is not over yet. An edition generated now will miss the posts published later this month.
          </p>
        )}

        <h2 className="mt-5 text-lg font-bold">2. Editions to make</h2>
        <GenerateForm
          key={month}
          month={month}
          editionName={editionLabel(month)}
          rows={rows}
          minimum={settings.counts.minimum}
          recommended={settings.counts.recommended}
          runningJob={await activeJobLike(`generate:${month}:`)}
        />

        <details className="mt-4 text-sm text-neutral-700">
          <summary className="cursor-pointer">How the articles are counted</summary>
          <p className="mt-2 max-w-3xl">
            A post goes to the edition its category belongs to. Posts in shared categories (Tech, Auto Comp, Business) go to
            every edition their headline or tags name, or that Claude places them in, so one post can count for more than one
            edition. {general} shared {general === 1 ? "post matches" : "posts match"} no edition and {general === 1 ? "is" : "are"} only
            used to reach the minimum. {unused} {unused === 1 ? "post is" : "posts are"} in categories no edition uses. Hover over a
            number in the Articles column to see how it is made up.
          </p>
        </details>
      </section>

      <h2 className="mt-10 text-lg font-bold">Editions from {monthLabel(month)} posts</h2>
      {ofMonth.length === 0 ? (
        <p className="mt-2 rounded border border-dashed border-neutral-400 bg-white p-5 text-sm text-neutral-700">
          None yet. Tick editions above and press Generate.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ofMonth.map((edition) => (
            <EditionCard key={edition.id} edition={edition} label={labels.get(edition.vertical) ?? edition.vertical} workedMs={worked.get(edition.id)} />
          ))}
        </ul>
      )}

      {others.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-bold">Editions from other months</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {others.map((edition) => (
              <EditionCard key={edition.id} edition={edition} label={labels.get(edition.vertical) ?? edition.vertical} workedMs={worked.get(edition.id)} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
