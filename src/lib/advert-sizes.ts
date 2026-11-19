// Pure module, used on the server and in the browser: the advert sizes on offer and the check of an uploaded picture.

export type AdvertSize = "double" | "full" | "half" | "quarter";
export type AdvertFit = "crop" | "whole";
export type AdvertKeep = "centre" | "top" | "bottom" | "left" | "right";

export type SizeSpec = {
  key: AdvertSize;
  label: string;
  /** Width and height on the page. */
  mm: [number, number];
  /** Pixels for a sharp print (300 per inch). */
  ideal: [number, number];
  /** Below this the advert looks soft. */
  minimum: [number, number];
  /** Where the app prints it. */
  where: string;
  /** False for sizes that cannot be placed in an edition yet. */
  placeable: boolean;
};

export const ADVERT_SIZES: SizeSpec[] = [
  {
    key: "double",
    label: "Double page",
    mm: [420, 297],
    ideal: [4960, 3508],
    minimum: [2480, 1754],
    where: "Between two articles in the middle of the magazine",
    placeable: true,
  },
  {
    key: "full",
    label: "Full page",
    mm: [210, 297],
    ideal: [2480, 3508],
    minimum: [1240, 1754],
    where: "The right-hand page at the end of the article it relates to",
    placeable: true,
  },
  {
    key: "half",
    label: "Half page",
    mm: [210, 148.5],
    ideal: [2480, 1754],
    minimum: [1240, 877],
    where: "The lower half of the first text page of the article it relates to",
    placeable: true,
  },
  {
    key: "quarter",
    label: "Quarter page",
    mm: [105, 148.5],
    ideal: [1240, 1754],
    minimum: [620, 877],
    where: "In the lower half of the first text page of its article, beside a second quarter page or the article's photo",
    placeable: true,
  },
];

export const sizeSpec = (size: string): SizeSpec | undefined => ADVERT_SIZES.find((entry) => entry.key === size);

export const KEEP_LABELS: Record<AdvertKeep, string> = {
  centre: "the middle",
  top: "the top",
  bottom: "the bottom",
  left: "the left side",
  right: "the right side",
};

/** How much of an article's advert space (the lower half of its first text page) a size takes: the half holds two. */
export const bandSlots = (size: string): number => (size === "half" ? 2 : size === "quarter" ? 1 : 0);
export const BAND_SLOTS = 2;

/** How far the picture's shape is from the size's shape; 0 = the same, 0.1 = ten percent wider or taller. */
export function shapeDifference(size: SizeSpec, width: number, height: number): number {
  const wanted = size.ideal[0] / size.ideal[1];
  const got = width / height;
  return Math.max(wanted, got) / Math.min(wanted, got) - 1;
}

/** What a person should know about an uploaded picture, in plain words. Empty when it fits as it is. */
export function checkPicture(size: SizeSpec, width: number, height: number, fit: AdvertFit): string[] {
  const messages: string[] = [];
  const difference = shapeDifference(size, width, height);
  if (difference > 0.03) {
    const wider = width / height > size.ideal[0] / size.ideal[1];
    messages.push(
      fit === "crop"
        ? `The picture is ${wider ? "wider" : "taller"} than a ${size.label.toLowerCase()} (${size.mm[0]} × ${size.mm[1]} mm), so about ${Math.round((1 - 1 / (1 + difference)) * 100)}% of its ${wider ? "width" : "height"} is cut off. Choose "Show the whole picture" if nothing may be cut.`
        : `The picture is ${wider ? "wider" : "taller"} than a ${size.label.toLowerCase()}, so it is shown whole with a plain border ${wider ? "above and below" : "at the sides"}.`,
    );
  }
  // What counts is the part of the picture that ends up on the page.
  const scale = fit === "crop" ? Math.min(width / size.minimum[0], height / size.minimum[1]) : Math.max(width / size.minimum[0], height / size.minimum[1]);
  if (scale < 1) {
    messages.push(
      `The picture is ${width} × ${height} pixels. A ${size.label.toLowerCase()} needs at least ${size.minimum[0]} × ${size.minimum[1]} to look sharp (best: ${size.ideal[0]} × ${size.ideal[1]}), so this one will look soft. Ask the advertiser for a larger file if you can.`,
    );
  }
  return messages;
}
