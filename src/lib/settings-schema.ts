import { z } from "zod";

// Pure module (no database, no server-only) so the rules can be unit tested.

const ids = z.array(z.number().int().positive());
const words = z.array(z.string().trim().min(1));

const verticalSchema = z.object({
  key: z.string().regex(/^[a-z-]+$/),
  label: z.string().min(1),
  coverSubtitle: z.string(),
  /** Sub-categories that belong to this edition outright. */
  categoryIds: ids,
  /** Main categories whose every sub-category belongs to this edition. */
  parentCategoryIds: ids,
  /** Words that pull a non-specific post (Tech, Auto Comp, Business) into this edition. */
  keywords: words,
  /** Headline of the "For Detailed Report" advert on the publisher page. */
  reportAdvert: z.string(),
});

/** Posts that match no other type get this one. It must always exist. */
export const OTHER_TYPE = "other";

const typeSchema = z.object({
  key: z.string().regex(/^[a-z-]+$/).max(40),
  label: z.string().min(1),
  /** What the type means, in a sentence. Claude reads this when it decides an article's type. */
  description: z.string().default(""),
  /** Words in a headline that mark a post as this type. */
  keywords: words,
  /** Categories whose posts are this type when the headline matches no type's words. */
  parentCategoryIds: ids,
  categoryIds: ids,
});

const baseSchema = z
  .object({
    counts: z.object({
      minimum: z.number().int().min(1),
      recommended: z.number().int().min(1),
      maximum: z.number().int().min(1),
      /** Posts shorter than this are not offered for selection. */
      minimumWords: z.number().int().min(0),
      /** Posts longer than this are offered but never included automatically. */
      maximumWords: z.number().int().min(1).default(2500),
    }),
    verticals: z.array(verticalSchema).min(1),
    /** Posts here are not tied to one vertical; keywords decide where they go. */
    sharedPool: z.object({
      parentCategoryIds: ids,
      categoryIds: ids,
      /**
       * Categories among the shared ones (Insights: guest articles and industry outlooks) whose posts are printed in
       * every edition as full articles when they name no edition in particular, instead of being used only as filler.
       */
      everyEditionCategoryIds: ids.default([]),
    }),
    /** `post_market.id` that counts as national. Everything else is international. */
    indiaMarketId: z.number().int().positive(),
    sectionLabels: z.object({ national: z.string().min(1), international: z.string().min(1) }),
    ordering: z.object({
      sections: z.array(z.enum(["national", "international"])).length(2),
      /** Type keys in the order they are printed inside a section. */
      types: z.array(z.string()),
    }),
    /**
     * Article types. When a post fits several, the one later in this list wins
     * (so "launches a plant" is a plant launch, and an appointment is always managerial).
     * The printed order is ordering.types, not the order here.
     */
    types: z.array(typeSchema).min(1),
    ai: z.object({
      /** Claude model for the foreword, photo analysis and post placement. */
      textModel: z.string().min(1),
      /** OpenAI image model used only when the person asks to extend a cover photo. */
      imageModel: z.string().min(1).default("gpt-image-2.6-sunburst"),
    }),
  })
  .superRefine((value, ctx) => {
    const { minimum, recommended, maximum } = value.counts;
    if (value.counts.maximumWords <= value.counts.minimumWords) {
      ctx.addIssue({ code: "custom", path: ["counts"], message: "Maximum words must be more than minimum words" });
    }
    if (!(minimum <= recommended && recommended <= maximum)) {
      ctx.addIssue({ code: "custom", path: ["counts"], message: "Counts must satisfy minimum <= recommended <= maximum" });
    }
    for (const group of ["sections", "types"] as const) {
      if (new Set<string>(value.ordering[group]).size !== value.ordering[group].length) {
        ctx.addIssue({ code: "custom", path: ["ordering", group], message: "Each entry may appear only once" });
      }
    }
    const typeKeys = value.types.map((type) => type.key);
    if (new Set(typeKeys).size !== typeKeys.length) {
      ctx.addIssue({ code: "custom", path: ["types"], message: "Type keys must be unique" });
    }
    if (!typeKeys.includes(OTHER_TYPE)) {
      ctx.addIssue({ code: "custom", path: ["types"], message: 'A type with the key "other" is needed for posts that fit no other type' });
    }
    const ordered = value.ordering.types;
    if (ordered.length !== typeKeys.length || typeKeys.some((key) => !ordered.includes(key))) {
      ctx.addIssue({ code: "custom", path: ["ordering", "types"], message: "The order must list every type key exactly once" });
    }
    const keys = value.verticals.map((v) => v.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["verticals"], message: "Vertical keys must be unique" });
    }
  });

export type Settings = z.infer<typeof baseSchema>;
export type ArticleTypeRule = Settings["types"][number];
export type Vertical = Settings["verticals"][number];

// Category ids are those of the live race_news database (checked 2026-11-12).
export const DEFAULT_SETTINGS: Settings = {
  counts: { minimum: 10, recommended: 20, maximum: 30, minimumWords: 80, maximumWords: 2500 },
  verticals: [
    {
      key: "cars",
      label: "Cars",
      coverSubtitle: "Car News & Insights",
      categoryIds: [55, 75],
      parentCategoryIds: [],
      keywords: ["car", "suv", "sedan", "hatchback", "mpv", "passenger vehicle", "passenger car", "crossover", "4-wheeler", "four-wheeler"],
      reportAdvert: "Future of Hybrid Vehicles in Passenger Vehicle Industry",
    },
    {
      key: "bikes",
      label: "Bikes",
      coverSubtitle: "Moto & Trio Global 2W & 3W Mobility",
      categoryIds: [53, 54, 74, 76],
      parentCategoryIds: [],
      keywords: ["motorcycle", "bike", "scooter", "two-wheeler", "two wheeler", "2w", "three-wheeler", "three wheeler", "3w", "moped", "rickshaw"],
      reportAdvert: "Future of Hybrid Vehicles in Passenger Vehicle Industry",
    },
    {
      key: "commercial-vehicle",
      label: "Commercial Vehicle",
      coverSubtitle: "Commercial Vehicle News & Insights",
      categoryIds: [10, 11, 12, 20, 22],
      parentCategoryIds: [],
      keywords: ["truck", "bus", "coach", "trailer", "tipper", "lcv", "hcv", "cv", "commercial vehicle", "fleet", "logistics", "pickup", "van"],
      reportAdvert: "Future of Alternative Fuels in Commercial Vehicle Industry",
    },
    {
      key: "farm-equipment",
      label: "Farm Equipment",
      coverSubtitle: "Farm Equipments",
      categoryIds: [],
      parentCategoryIds: [57],
      keywords: ["tractor", "harvester", "farm", "farming", "agri", "agriculture", "agricultural", "tiller", "baler", "implement", "sprayer", "mower"],
      reportAdvert: "Future of Alternative Fuels in Agriculture Machinery Vehicle Industry",
    },
    {
      key: "construction",
      label: "Construction",
      coverSubtitle: "Construction & Mining Equipment",
      categoryIds: [],
      parentCategoryIds: [58],
      keywords: ["excavator", "crane", "loader", "construction", "mining", "dozer", "backhoe", "compactor", "dump truck", "dumper", "telehandler", "skid steer", "earthmoving"],
      reportAdvert: "Future of Alternative Fuels in Agriculture Machinery Vehicle Industry",
    },
  ],
  // 71 is the Insights category of the news posts.
  sharedPool: { parentCategoryIds: [4, 5, 40], categoryIds: [21, 71], everyEditionCategoryIds: [71] },
  indiaMarketId: 1,
  sectionLabels: { national: "NATIONAL NEWS", international: "INTERNATIONAL NEWS" },
  ordering: {
    sections: ["national", "international"],
    types: [
      "vehicle-launch",
      "flag-off",
      "plant-launch",
      "component-launch",
      "interview",
      "guest-article",
      "industrial-outlook",
      "tie-up",
      "partnership",
      "new-purchase",
      "joint-venture",
      "merger-acquisition",
      "other",
      "financials",
      "managerial-changes",
    ],
  },
  types: [
    {
      key: "other",
      label: "Other news",
      description: "Anything that fits none of the other types, such as policy, events, awards, dealership openings and general company news.",
      keywords: [],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "vehicle-launch",
      label: "Vehicle launches",
      description: "A new or updated vehicle, machine or model variant going on sale or being revealed.",
      keywords: ["launch", "launches", "launched", "introduces", "introduced", "unveils", "unveiled", "debuts", "reveals", "facelift", "updated", "updates", "edition", "all-new"],
      parentCategoryIds: [73],
      categoryIds: [],
    },
    {
      key: "flag-off",
      label: "New vehicle flag-offs",
      description: "First units of a vehicle being flagged off, handed over or delivered to a customer or fleet.",
      keywords: ["flag off", "flags off", "flagged off", "flagging off", "hands over", "handed over", "handover", "delivers", "delivered", "delivery", "deliveries"],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "plant-launch",
      label: "Plant launches",
      description: "A factory, plant or production line being opened, announced, expanded or starting production.",
      keywords: ["plant", "factory", "facility", "manufacturing unit", "production line", "assembly line", "inaugurates", "inaugurated", "inauguration", "groundbreaking", "foundation stone"],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "component-launch",
      label: "Components and accessories launches",
      description: "A new part, tyre, lubricant, accessory, system or technology for vehicles being introduced.",
      keywords: ["component", "accessory", "accessories", "tyre", "tire", "lubricant", "engine oil", "helmet", "brake", "axle", "transmission", "sensor", "charger", "battery pack", "spare part", "aftermarket"],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "interview",
      label: "Interviews",
      description: "An interview or conversation with a named person.",
      keywords: ["interview", "in conversation", "q&a", "speaks to", "talks to"],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "guest-article",
      label: "Guest articles",
      description: "An opinion or analysis piece by a named author from outside the newsroom, such as an industry executive or expert, usually with a byline (\"By ...\", \"the author is ...\") and written in the author's own voice. On the website these are filed under Insights.",
      keywords: ["guest article", "guest column", "guest", "opinion", "viewpoint", "authored by", "column"],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "industrial-outlook",
      label: "Industrial outlook",
      description: "A look at where a market or industry segment stands and is heading: sales trends across a month, quarter or year, market size, forecasts, the effect of policy or regulation. About a market as a whole, not one company's news. On the website these are filed under Insights.",
      keywords: ["outlook", "forecast", "market analysis", "growth analysis", "trends", "market share", "penetration", "sales growth", "auto market", "automotive market", "vehicle sales"],
      parentCategoryIds: [],
      // Without Claude, an Insights post whose headline says nothing is taken to be an outlook.
      categoryIds: [71],
    },
    {
      key: "tie-up",
      label: "Tie-ups",
      description: "An agreement, MoU or deal between companies for a specific purpose, such as financing, supply or distribution.",
      keywords: ["tie up", "ties up", "tied up", "mou", "memorandum", "agreement", "signs", "signed", "collaborates", "collaboration", "teams up", "joins hands"],
      parentCategoryIds: [],
      categoryIds: [48],
    },
    {
      key: "partnership",
      label: "Partnerships",
      description: "A broader or long-term partnership or alliance between companies.",
      keywords: ["partner", "partnered", "partnering", "partnership", "alliance"],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "new-purchase",
      label: "New purchases",
      description: "A customer ordering or buying vehicles or equipment, or a manufacturer winning such an order.",
      keywords: ["order", "ordered", "purchase", "purchased", "procures", "procurement", "buys", "bought", "contract"],
      parentCategoryIds: [],
      categoryIds: [],
    },
    {
      key: "joint-venture",
      label: "Joint ventures",
      description: "Companies forming or changing a jointly owned company.",
      keywords: ["joint venture", "jv"],
      parentCategoryIds: [],
      categoryIds: [41],
    },
    {
      key: "merger-acquisition",
      label: "Mergers and acquisitions",
      description: "One company buying, merging with or taking a stake in another.",
      keywords: ["merger", "merges", "merged", "acquisition", "acquires", "acquired", "acquire", "takeover", "buyout", "stake"],
      parentCategoryIds: [],
      categoryIds: [44],
    },
    {
      key: "financials",
      label: "Financials",
      description: "Financial results, sales figures, revenue, funding or investment amounts.",
      keywords: ["results", "revenue", "profit", "net loss", "earnings", "quarterly", "q1", "q2", "q3", "q4", "ebitda", "ipo", "funding", "raises", "invests", "investment", "sales", "dividend"],
      parentCategoryIds: [],
      categoryIds: [45],
    },
    {
      key: "managerial-changes",
      label: "Managerial changes",
      description: "People appointed to, moving between or leaving leadership roles.",
      keywords: ["appoints", "appointed", "appointment", "names", "named", "ceo", "cfo", "managing director", "chairman", "president", "joins as", "steps down", "resigns", "board"],
      parentCategoryIds: [],
      categoryIds: [46],
    },
  ],
  ai: { textModel: "claude-opus-5-5", imageModel: "gpt-image-2.6-sunburst" },
};

/** Types added after a settings version was saved are added to it, after "interview" in the printed order. */
function withNewTypes(saved: Record<string, unknown>): unknown {
  const types = saved.types;
  const ordering = saved.ordering as { types?: unknown } | undefined;
  if (!Array.isArray(types) || !ordering || !Array.isArray(ordering.types)) return saved;
  const have = new Set(types.map((type) => (type as { key?: string }).key));
  const missing = DEFAULT_SETTINGS.types.filter((type) => ["guest-article", "industrial-outlook"].includes(type.key) && !have.has(type.key));
  if (missing.length === 0) return saved;
  const order = (ordering.types as string[]).filter((key) => !missing.some((type) => type.key === key));
  const at = order.includes("interview") ? order.indexOf("interview") + 1 : order.length;
  order.splice(at, 0, ...missing.map((type) => type.key));
  // The Insights category joins the shared categories at the same time.
  const pool = (saved.sharedPool ?? {}) as { categoryIds?: number[]; everyEditionCategoryIds?: number[] };
  const sharedPool = {
    ...pool,
    categoryIds: [...new Set([...(pool.categoryIds ?? []), 71])],
    everyEditionCategoryIds: pool.everyEditionCategoryIds ?? [71],
  };
  return { ...saved, sharedPool, types: [...types, ...missing], ordering: { ...ordering, types: order } };
}

/** Settings saved before article types became a list get the built-in types and their order. */
function upgrade(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if ("types" in raw) return withNewTypes(raw as Record<string, unknown>);
  const rest = { ...(raw as Record<string, unknown>) };
  delete rest.typeRules;
  const ordering = (rest.ordering ?? {}) as Record<string, unknown>;
  return { ...rest, types: DEFAULT_SETTINGS.types, ordering: { ...ordering, types: DEFAULT_SETTINGS.ordering.types } };
}

export const settingsSchema = z.preprocess(upgrade, baseSchema);

/** Readable list of validation problems, one per line. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`);
}
