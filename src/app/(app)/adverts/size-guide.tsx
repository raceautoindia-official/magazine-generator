import { ADVERT_SIZES, type AdvertSize } from "@/lib/advert-sizes";

/** Where each size sits on an open magazine: left, top, width and height in percent of the two pages. */
const AREA: Record<AdvertSize, { left: number; top: number; width: number; height: number }> = {
  double: { left: 0, top: 0, width: 100, height: 100 },
  full: { left: 50, top: 0, width: 50, height: 100 },
  half: { left: 0, top: 50, width: 50, height: 50 },
  quarter: { left: 0, top: 50, width: 25, height: 50 },
};

/** A small drawing of an open magazine with the advert's place shaded. */
export function SizeDiagram({ size, className = "" }: { size: AdvertSize; className?: string }) {
  const area = AREA[size];
  return (
    <span aria-hidden className={`relative block flex-none overflow-hidden rounded-sm border border-neutral-400 bg-white ${className}`} style={{ aspectRatio: "420 / 297" }}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-neutral-300" />
      <span className="absolute bg-violet-600" style={{ left: `${area.left}%`, top: `${area.top}%`, width: `${area.width}%`, height: `${area.height}%` }} />
    </span>
  );
}

/** The four sizes with their measurements, always in view: this is what gets quoted to advertisers. */
export function SizeGuide() {
  return (
    <section aria-label="Advert sizes" className="mt-5">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ADVERT_SIZES.map((size) => (
          <li key={size.key} className="flex gap-3 rounded border border-neutral-300 bg-white p-3">
            <SizeDiagram size={size.key} className="h-12" />
            <div className="min-w-0 text-sm">
              <p className="font-bold">{size.label}</p>
              <p className="tabular-nums text-neutral-800">
                {size.mm[0]} × {size.mm[1]} mm
              </p>
              <p className="text-xs tabular-nums text-neutral-600" title={`Smallest picture that stays sharp: ${size.minimum[0]} × ${size.minimum[1]} px`}>
                best {size.ideal[0]} × {size.ideal[1]} px
              </p>
              <p className="mt-1 text-xs text-neutral-600">{size.where}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-neutral-600">
        No bleed or trim marks are needed: the picture is the page. Ask advertisers to keep both bottom corners clear (about 25 × 20 mm), because the page number is printed
        there. A quarter page has the shape of a full page, and a half page the shape of a double page.
      </p>
    </section>
  );
}
