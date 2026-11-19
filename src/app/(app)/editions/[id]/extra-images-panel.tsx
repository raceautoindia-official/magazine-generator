"use client";

import { useActionState } from "react";
import { setExtraImage } from "./actions";

export type ExtraImageRow = {
  path: string;
  url: string;
  /** "" when the decision is automatic. */
  manual: string;
  usedAs: string;
  title: string;
};

function ExtraImage({ id, image }: { id: number; image: ExtraImageRow }) {
  const [state, action, pending] = useActionState(setExtraImage, undefined);
  return (
    <li className="flex flex-wrap items-center gap-4 border-t border-neutral-200 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a stored post image on the site's own bucket */}
      <img src={image.url} alt="" className="h-16 w-28 border border-neutral-300 bg-neutral-100 object-contain" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{image.title}</p>
        <p className="text-neutral-700">Now: {image.usedAs}</p>
        {state?.error && (
          <p role="alert" className="text-red-800">
            {state.error}
          </p>
        )}
      </div>
      <form action={action} className="flex items-center gap-2 text-sm">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="path" value={image.path} />
        <select
          name="kind"
          key={image.manual}
          defaultValue={image.manual || "auto"}
          aria-label="Use this image as"
          className="rounded border border-neutral-300 bg-white px-2 py-1"
        >
          <option value="auto">Decide automatically</option>
          <option value="logo">Company logo</option>
          <option value="photo">Second photo</option>
          <option value="none">Do not use</option>
        </select>
        <button type="submit" disabled={pending} className="rounded border border-neutral-400 px-3 py-1 font-medium disabled:opacity-60">
          {pending ? "Saving..." : "Set"}
        </button>
      </form>
    </li>
  );
}

export function ExtraImagesPanel({ id, images }: { id: number; images: ExtraImageRow[] }) {
  return (
    <section className="mt-8 rounded border border-neutral-300 bg-white p-4">
      <h2 className="text-lg font-bold">Extra images of the posts ({images.length})</h2>
      <p className="mt-1 text-sm text-neutral-700">
        A logo is printed small in the corner of the article&apos;s first page. A second photo becomes the full-page photo of a
        long article. Change it here when the automatic decision is wrong, then create the PDF again.
      </p>
      <ul className="mt-3">
        {images.map((image) => (
          <ExtraImage key={image.path} id={id} image={image} />
        ))}
      </ul>
    </section>
  );
}
