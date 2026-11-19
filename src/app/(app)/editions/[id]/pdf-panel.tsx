"use client";

import { MagazineReader } from "./magazine-reader";

const link = "rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100";

/** The finished pages: read them like a magazine, and download the files that get published. */
export function PdfPanel({
  id,
  pageCount,
  version,
  stale,
  reader,
}: {
  id: number;
  /** null until a PDF exists. */
  pageCount: number | null;
  version: string;
  /** Something changed since this PDF was created. */
  stale: boolean;
  /** Page pictures for the reader; null for a PDF made before the reader existed. */
  reader: { pages: number; contents: { page: number; title: string }[] } | null;
}) {
  if (pageCount === null) {
    return (
      <section className="rounded border border-dashed border-neutral-400 bg-white p-8 text-center">
        <h2 className="text-lg font-bold">There is no PDF yet</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-neutral-700">
          Press <strong>Create the PDF</strong> in the bar above. When it is ready, the magazine opens here so you can turn
          its pages, and the PDF and cover image can be downloaded.
        </p>
      </section>
    );
  }

  const stamp = encodeURIComponent(version);
  return (
    <section>
      {stale && (
        <p className="mb-4 rounded bg-amber-50 px-4 py-3 text-sm text-amber-900">
          These pages are out of date: the edition was changed after the PDF was made. Create the PDF again before you
          download or publish it.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-bold">The magazine, {pageCount} pages</h2>
        <a href={`/editions/${id}/pdf?download=1`} className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          Download the PDF
        </a>
        <a href={`/editions/${id}/cover?download=1`} className={link}>
          Download the cover image
        </a>
        <a href={`/editions/${id}/pdf?v=${stamp}`} target="_blank" className={link} title="Opens the PDF file itself in a new tab">
          Open the PDF file
        </a>
      </div>

      {reader ? (
        <>
          <MagazineReader key={version} id={id} pages={reader.pages} contents={reader.contents} version={version} />
          <p className="mt-2 text-sm text-neutral-600">
            Turn pages with the arrows at the sides, by clicking a page, or with the left and right arrow keys.
          </p>
        </>
      ) : (
        <>
          <p className="mb-3 rounded bg-sky-50 px-4 py-3 text-sm text-sky-950">
            This PDF was made before the magazine reader was added. Create the PDF again to turn its pages two at a time;
            until then the PDF file is shown below.
          </p>
          <iframe key={stamp} src={`/editions/${id}/pdf?v=${stamp}`} title="Magazine PDF" className="h-[80vh] w-full border border-neutral-300" />
        </>
      )}
    </section>
  );
}
