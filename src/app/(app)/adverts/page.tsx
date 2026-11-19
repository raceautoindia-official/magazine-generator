import { requireUser } from "@/lib/auth";
import { listAdverts } from "@/lib/adverts";
import { claudeAvailable } from "@/lib/ai/claude";
import { appQuery } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { Library } from "./library";
import { SizeGuide } from "./size-guide";

export default async function AdvertsPage() {
  await requireUser();
  const adverts = await listAdverts();
  const { settings } = await getSettings();
  const labelOf = new Map(settings.verticals.map((vertical) => [vertical.key, vertical.label]));
  const uses = await appQuery<{ advert_id: number; id: number; vertical: string; edition_label: string }>(
    `SELECT p.advert_id, e.id, e.vertical, e.edition_label FROM mg_edition_adverts p JOIN mg_editions e ON e.id = p.edition_id ORDER BY e.id DESC`,
  );
  // Drafts an advert can be added to straight from this page.
  const drafts = (
    await appQuery<{ id: number; vertical: string; edition_label: string }>(
      "SELECT id, vertical, edition_label FROM mg_editions WHERE status = 'draft' ORDER BY id DESC LIMIT 40",
    )
  ).map((draft) => ({ id: draft.id, label: `${labelOf.get(draft.vertical) ?? draft.vertical}, ${draft.edition_label} (draft ${draft.id})` }));
  const canDescribe = claudeAvailable();

  return (
    <>
      <h1 className="text-2xl font-bold">Adverts</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-700">
        Upload an advert once and print it in any edition, any month. {canDescribe ? "Claude looks at each advert and writes down what it sells. " : ""}
        When you add the advert to an edition, the app prints it with the article on the same subject and tells you why.
      </p>

      <SizeGuide />

      <Library
        canDescribe={canDescribe}
        drafts={drafts}
        adverts={adverts.map((advert) => ({
          id: advert.id,
          advertiser: advert.advertiser,
          size: advert.size,
          fit: advert.fit,
          keep: advert.keep,
          originalName: advert.originalName,
          width: advert.width,
          height: advert.height,
          link: advert.link ?? "",
          summary: advert.summary,
          product: advert.analysis?.product ?? "",
          keywords: advert.analysis?.keywords ?? [],
          segments: (advert.analysis?.segments ?? []).map((key) => labelOf.get(key) ?? key),
          summaryBy: advert.summaryBy,
          archived: advert.archived,
          createdAt: advert.createdAt,
          usedIn: uses.filter((use) => use.advert_id === advert.id).map((use) => ({ id: use.id, label: `${labelOf.get(use.vertical) ?? use.vertical}, ${use.edition_label}` })),
          version: `${advert.fit}-${advert.keep}`,
        }))}
      />
    </>
  );
}
