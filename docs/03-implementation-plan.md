# Magazine Generator: implementation plan

Date: 2026-11-12 (revised the same day after round 3 answers, see section 12)
Follows: [01-existing-system-analysis.md](01-existing-system-analysis.md), [02-requirements-decisions.md](02-requirements-decisions.md)

## 1. What the app does

On request, for any month and any vertical the person chooses, the app reads that month's posts from the Race Auto India database, selects and orders them by editable rules, lays them out in the existing magazine style, writes a foreword, builds a cover, and produces a PDF. The person who makes the magazine today can review and adjust the draft, then downloads the PDF and cover image and uploads them through the existing admin panel.

## 2. Decisions from round 2

| Topic | Decision |
|---|---|
| Category to edition mapping | Proposed table accepted (see doc 02, Q1) |
| Non-specific posts (Tech, Auto Comp, Business) | Generator guesses the vertical from tags and keywords; a post that fits no single vertical goes to more than one edition; the editor can move posts |
| Article count | Minimum 10, recommended 20, maximum 30 per edition. Below 10: warning. All three numbers editable in Settings |
| Article order | India first, then International. Inside each: launches and facelifts first, management news last, everything else between. Editable in the app |
| Section label | India market: NATIONAL NEWS. Any other market: INTERNATIONAL NEWS. Existing magazines are not a reference for this (they contain manual errors) |
| Edition naming | Posts from month M are published as the edition of month M+1 (October posts: "November 2026 Edition") |
| Cover | Image of the top-ranked article, fitted properly to the cover; otherwise an AI-generated image of the same subject |
| Foreword | AI-written from the edition's contents |
| Page 2 (publisher page) | Fixed content; only the changing parts are filled in |
| Login | Existing admin email and password, checked against the main site's users table |
| Server | Ubuntu, 32 GB RAM, about 20 GB free: ample for PDF generation |

## 3. Findings from seven downloaded editions

Editions examined: Cars Sep and Aug 2026, Bikes Sep 2026, Commercial Vehicle Aug and Jun 2026, Agriculture Aug 2026, C and E Equip Jul 2026. Text and structure were extracted from the PDFs; visual layout was studied in the site's flipbook (Cars Sep, pages 1 to 15).

| Property | Value |
|---|---|
| Page size | A4 portrait (595 x 842 pt), every page, every edition |
| Made with | Adobe InDesign |
| Fonts | Roboto (Regular, Medium, Bold, Black, italics); CV editions also use Roboto Condensed. Roboto is free to use |
| Length | 50 to 90 pages, 2,400 to 5,500 words |
| Articles per edition | 10 or 11 |
| Fixed pages | 1 cover, 2 publisher page, 3 foreword, 4 to 5 contents, last page back cover |

Page 2 is the same in every edition except:

- the month ("Published in Sep 2026 by:"),
- the report advert headline, which depends on the vertical ("Future of Hybrid Vehicles in Passenger Vehicle Industry" for Cars and Bikes, "Future of Alternative Fuels in Agriculture Machinery Vehicle Industry" for Agriculture and C and E).

Manual errors found, which the generator removes by construction: find-and-replace damage ("Sepision", "raceinJulyations.in", "Sep be reproduced"), wrong copyright year (2024) and wrong month in running headers ("May 2026" in a September edition), and "INTERNATIONAL NEWS" printed on every article including India ones.

### Post supply against the article target

Published posts per month, from the site's API:

| Vertical (direct categories only) | Aug 2026 | Sep 2026 | Oct 2026 |
|---|---|---|---|
| Cars | 13 | 10 | 0 |
| Bikes (2W and 3W) | 15 | 17 | 6 |
| Commercial Vehicle (Truck, Bus and Coach) | 12 | 3 | 0 |
| Farm Equipment | 11 | 5 | 0 |
| Construction | 8 | 5 | 0 |
| Non-specific pool (Tech, Auto Comp, Business) | 27 | 12 | 1 |
| All posts | 91 | 52 | 8 |

No vertical reached 30 in any of these months, so the limits are minimum 10, recommended 20, maximum 30. From direct categories alone, the minimum of 10 is met by four of five verticals in August, by Cars and Bikes in September, and by none in October; how many non-specific posts each vertical gains is not known until the selection engine runs.

## 4. Architecture

| Part | Choice | Reason |
|---|---|---|
| App | Next.js (App Router, TypeScript), one process | Requested stack; UI and server logic together |
| News data | Direct read-only SQL on `race_news` with `mysql2` | Same VPS; fastest and simplest |
| Own data | Separate MySQL database `magazine_generator` (fallback: tables prefixed `mg_` if the DB user cannot create a database) | Generator never writes to the main site's tables |
| PDF | Pages as HTML and CSS, printed by headless Chromium (Puppeteer), merged with `pdf-lib` | Free, real text in the PDF, Roboto embeds cleanly |
| Images | `sharp` for cropping, resizing and resolution checks; originals fetched from the S3 bucket and cached on disk | Free |
| AI | Claude API (Anthropic Console key in `.env`, official `@anthropic-ai/sdk`). Used for the foreword, for checking whether an attached image is a logo, and for choosing the cover photo and its crop. Model is a setting; default `claude-opus-5-5` | A handful of small calls per edition |
| Hosting | Same VPS, PM2 process, Nginx reverse proxy on a subdomain (for example `magazine.raceautoindia.com`), Let's Encrypt certificate | No new infrastructure cost |
| Secrets | `.env` file on the server, never in git | Avoids repeating the main app's problem |

Running cost: the Claude calls only. At the default model's list price ($4 per million input tokens, $20 per million output tokens) a foreword is roughly 5,000 tokens in and 500 out, about 3 US cents per edition; the image checks add a few cents more. Switching the setting to `claude-haiku-5-5` cuts this by roughly 40 times.

Claude does not generate images. Cover image generation uses the OpenAI API (section 6), at most one image per edition, billed per image to the existing OpenAI account.

## 5. Generation pipeline

1. **Collect.** Published posts (`status = 1`, `is_scheduled = 0`) created in the edition's month, with category, market, tags, main image and extra images.
2. **Assign to verticals.** Direct category mapping first. For non-specific posts, score tags, keywords and title against per-vertical word lists; no clear winner means the post is offered to every edition it could fit.
3. **Classify.** Section from market (India or International). Type from category and headline words: launch or facelift ("launches", "introduces", "unveils", "updated", "edition"), management ("appoints", "names", "CEO", category Appointments and Restructure), other.
4. **Select and order.** Drop posts below a minimum word count. Order by the configured sequence (India then International; launch, other, management), then by featured flag and page views. Take up to the recommended count (20); the person can raise it to the maximum (30) in review. Record a warning if fewer than the minimum (10) are available, and a note if between 10 and 20.
5. **Front matter.** Cover from the first article's image; foreword from the selected headlines and summaries; contents pages from the final order; page 2 from the fixed template.
6. **Lay out.** Each article gets a template chosen by word count and image size (section 6). Page numbers and footers are computed, never typed.
7. **Render.** Chromium prints the pages; the result is stored as a draft with a page-by-page preview.
8. **Review (optional).** Edits change the stored draft; re-render takes seconds.
9. **Finish.** Download PDF, cover JPG, and the suggested title, slug and keywords for the upload form.

Nothing is generated automatically. The person picks a month and one or more verticals and presses Generate; this can be repeated for any past month at any time. Generating again for the same month and vertical creates a new draft and keeps the earlier one.

## 6. Page templates

| Template | Content |
|---|---|
| Cover | Full-bleed photo, logo, RACE AUTO INDIA, E-MAGAZINE, vertical subtitle, month and year |
| Publisher page | Fixed text, month, per-vertical report advert, QR code |
| Foreword | Heading, director photo, text, signature block |
| Contents | Photo collage from article images, page numbers and headlines; extends to more pages when an edition carries more articles |
| Article, 2 pages | Full-page photo with headline overlaid, then a text page. Used when the image is large enough |
| Article, 1 page | Photo on the upper part, headline, text in two columns. Used for short posts or small images |
| Article, extra photos | When a post has additional stored images, a photo page or inset is added |
| Back cover | Fixed |

Every article page carries the footer: page number, RACE AUTO INDIA, NATIONAL NEWS or INTERNATIONAL NEWS, edition month. At one to two pages per article, an edition comes to roughly 16 to 26 pages with 10 articles, 26 to 46 with 20, and 36 to 66 with 30, against 50 to 90 today.

Cover fitting: stored photos are landscape and the cover is portrait. Claude looks at the top-ranked articles' photos and returns the best candidate and where its subject sits; the app crops a portrait area around that point and checks the result is sharp enough for A4. If no photo survives a portrait crop, the cover uses a layout that keeps the whole photo, with the top and bottom filled by a blurred, darkened extension of the same picture under the title and cover line. The person can pick any other article's image or upload their own.

Logos: the logo is uploaded as one of the post's extra images. The generator inspects each extra image's original file and decides in three steps:

1. Certain by measurement: transparent background, or small with few colours on a flat background. Treated as a logo.
2. Certain by measurement: large photograph with many colours. Treated as a photo.
3. Anything in between is shown to Claude with one question (logo or photo). The answer is stored, so each image is checked once.

A logo is placed in the corner of the article's opening page and never used as a photo. The review screen shows the decision with a switch. Uploading logos as PNG with a transparent background makes step 1 certain.

Side effect on the website: the article page shows all of a post's images in its slider, so an attached logo will also appear there. A dedicated logo field in the main app's post form would avoid that, at the cost of changing that app.

### AI image generation for covers

Claude reads images but does not create them, so image work uses a second provider: OpenAI, with the key the main site already has (decided in round 5). It is used only where the plain crop does not give a good cover. The exact OpenAI image model and its price are to be confirmed at build time; the main site's current model (`dall-e-3`) only generates from text and cannot take an input photo.

| Need | What provides it |
|---|---|
| API key for an image provider | The main site already has an OpenAI account (it calls `dall-e-3`, which only generates from text). OpenAI's image editing API, or an equivalent from Google, Stability or Black Forest Labs, would be required |
| Extend a landscape photo to portrait | Image edit call with the original photo and a mask covering the new top and bottom areas. The real vehicle stays untouched |
| Regenerate the scene as a portrait image | Image edit call with the photo as reference. The vehicle is redrawn, so details can change |
| Prompt writing and result checking | Claude: writes the prompt from the article, then compares the result with the original photo and rejects changed vehicles, garbled badges or text |
| Crop, resize, blur, sharpen, format | `sharp`, already in the plan, free |
| Enlarging small results to A4 | Provider upscaling, or `sharp` resampling at lower quality |

Default mode is "extend": on a news magazine cover, a redrawn vehicle that differs from the real product is a factual error. "Regenerate" is available as a second choice. Use is limited to one cover per edition, approved by the person in the review screen, with the plain crop always available.

## 7. Screens

| Screen | Purpose |
|---|---|
| Login | Existing admin account |
| Dashboard | Month picker and vertical checkboxes with a Generate button; post counts per vertical for the chosen month before generating; list of existing drafts and finished editions with warnings (too few posts, low-resolution images) |
| Edition review | Article list with drag to reorder, include or exclude, move to another edition, change section or type, choose image, mark logo; list of unused posts for that month |
| Front matter | Cover image choice and crop, cover line, foreword text with regenerate, report advert |
| Preview | Page thumbnails and full PDF view |
| Finish | Download PDF and cover image; copy title, slug, keywords |
| Settings | Category mapping, vertical word lists, ordering sequence, type keywords, target and minimum article counts, minimum word count, publisher page text, report advert per vertical, AI model |

## 8. Own database (outline)

- `editions`: vertical, content month, edition label, status, warnings, PDF path, cover path, timestamps.
- `edition_articles`: edition, post id, position, section, type, template, chosen image, logo image, included flag.
- `edition_front_matter`: cover image source and crop, cover line, foreword text, advert choice.
- `settings`: rules as JSON, versioned so a change does not alter finished editions.
- `asset_cache`: fetched images with dimensions.

Post text is always read live from `race_news` at render time and copied into the finished edition's record on finish, so a finished edition can be re-downloaded unchanged.

## 9. Build order

| Phase | Deliverable | Checks |
|---|---|---|
| 1. Foundation | Project, database connections, login, settings store, deployment to the subdomain | Login works with an admin account; non-admins refused |
| 2. Selection engine | Collect, assign, classify, select, order; dashboard with counts and warnings | Run against Aug and Sep 2026 and compare with the articles in the real editions |
| 3. Templates and PDF | All page templates, Roboto, footers, contents, render to PDF | Side-by-side with Cars Sep 2026; A4; text selectable; page numbers match contents |
| 4. Generated front matter | Foreword, cover fitting, AI fallback, publisher page | Cover sharpness check; foreword mentions only articles in the edition |
| 5. Review and finish | Review, front matter, preview and finish screens | Reorder, exclude and move a post, then confirm the PDF reflects it |
| 6. Hardening | Error reporting, backups of the generator database, user guide | Dry run of a full month for all five verticals |

Phases 1 to 3 produce a usable PDF; 4 and 5 add the generated parts and editing.

## 10. Before deployment

- Rotate the database passwords that are in the public repository, and give the generator its credentials through `.env`. The generator will use the same database user as agreed, but not the leaked password.
- DNS record for the subdomain.
- An Anthropic Console API key and the OpenAI API key, placed in `.env` on the server by the owner.
- On the server: `npm ci`, `npm run migrate` (applies migrations 001 to 012), `npm run build`, then PM2 with `deploy/ecosystem.config.cjs` (one process) and nginx with `deploy/nginx.conf.example`.
- Chromium's system libraries for PDF creation.
- A nightly `npm run backup` by cron, with `BACKUP_DIR` on another disk if there is one; see `docs/05-user-guide.md`.

## 11. Open points

None blocking. One choice remains available later: adding a logo field to the main app (section 6).

## 12. Round 3 answers (2026-11-12)

| Topic | Decision |
|---|---|
| Article count | Minimum 10, recommended 20, maximum 30 (corrected in round 4) |
| Triggering | Manual only. Any month, any vertical, whenever wanted. No automatic generation |
| Logo handling | Left to the developer: measurement first, Claude for unclear cases, manual switch (section 6) |
| AI provider | Claude API with a Console key |

## 13. Phase 2 as built (2026-11-12)

Checked against the local copy of `race_news` for August and September 2026.

| Edition | August: included (by category + by words) | September: included (by category + by words + general) |
|---|---|---|
| Cars | 15 (13 + 2) | 10 (10 + 0 + 0) |
| Bikes | 16 (15 + 1) | 17 (17 + 0 + 0) |
| Commercial Vehicle | 20 (17 + 3; 7 more available) | 10 (3 + 2 + 5) |
| Farm Equipment | 15 (11 + 4) | 10 (5 + 3 + 2) |
| Construction | 14 (8 + 6) | 10 (5 + 2 + 3) |

Points that differ from, or add to, section 5:

- Shared posts with no edition words ("general" posts) are included only to reach the minimum, and the draft carries a note saying how many were used.
- Within a section and type, posts placed by category come before posts placed by words.
- Posts not included are stored with the draft, so review can offer them.
- `mg_edition_articles` gained `assigned_by` and `match_note` (migration 002) to show why each post is in an edition.

Known weak spots, all correctable in review once phase 5 exists:

- Word matching cannot place posts that name only a brand (a BharatBenz dealership post has no truck word in its headline or tags). Asking Claude to place the few unmatched shared posts each month would fix this; candidate for phase 4, when the Claude client is added.
- The main site's data has errors the rules follow faithfully: a Thar SUV filed under Two Wheeler, "Škoda Introduces Updated Slavia in India" filed under the Europe market.
- "Launch" is decided by headline words, so "Hyundai Introduces Assured Buyback Programme" counts as a launch.
- A general post can open an edition (September Commercial Vehicle). The cover step in phase 4 must pick the first post placed by category or words, not simply the first post.

## 14. Phase 3 as built (2026-11-12)

Rendered from the local copy of `race_news`: Cars from August posts (15 articles, 52 pages, 5.2 MB, about 12 seconds), Commercial Vehicle from September posts (10 articles, 36 pages), Bikes from August posts (16 articles, 38 pages). Pages were checked by eye against the Cars September 2026 edition.

Changes from section 6:

- Articles follow the reference editions' spread design instead of the one-page and two-page templates planned: the photo runs across two facing pages with the headline at the foot of the left page. Short posts carry their text in a white column on the right page (2 pages). Longer posts add a two-column text page and a full-page photo (4 pages).
- The cover keeps the whole photo, placed across the page on a blurred, darkened copy of itself. Cropping to a full-bleed portrait cover is left to phase 4, where Claude can say where the subject is.
- The PDF is printed in one pass from one document, so `pdf-lib` was not needed.
- The back cover is the reference edition's page used as an image.
- Until phase 4 the foreword is a short factual summary built from the edition's own contents.
- Commercial Vehicle has no report advert photo (the reference used a full-page background there); the headline is "Future of Alternative Fuels in Commercial Vehicle Industry", taken from the reference.

Findings:

- Stored photos carry the site's logo watermark in the bottom-left corner, and some have white bands along an edge. The bands are trimmed automatically; the watermark stays and is visible on full-page photos.
- Stored photos are mostly 1920 x 1080. Across a 420 mm spread that is about 115 dpi: fine on screen, soft in print. The renderer warns below 1200 px wide.
- Transparent gradients printed by Chromium showed pink in pdf.js, which the site's flipbook is likely to use, so the PDF avoids transparency altogether.
- Automatic "interesting area" cropping picked wrong regions too often; crops are taken from the centre until phase 4 supplies focal points.
- The publisher page's last disclaimer sentence was printed as "Race Editoriale LLP by all rights to contributions" in the reference editions; the owner corrected it to "reserves all rights" (13 November 2026).
- The social media icons on the reference publisher page are not included; the main repository only has 32 px versions.

## 15. Phase 4 as built (2026-11-12)

Tested with real API calls on Commercial Vehicle (September posts) and Cars (August posts).

| Part | How it works | Result in the test |
|---|---|---|
| Placing shared posts | At Generate, shared posts that match no edition's words are sent to Claude in one request; the answer is stored per post in `mg_post_placements` and reused | BharatBenz dealership, ZF disc brake and Hiab tail lift went to Commercial Vehicle; Uno Minda amplifier and Volvo EX30 to Cars |
| Foreword | Button on the edition page; Claude writes 170 to 230 words from the edition's own article text only. Editable and saved by hand | 227 words; every figure checked was present in the articles |
| Photo analysis | On Create PDF, Claude looks at each photo once (kind, subject, where it sits, fit for a cover); stored in `mg_asset_cache.analysis` | Crops now centre on the vehicle |
| Cover | Earliest edition-specific article whose photo is fit for a cover. Full-page crop when the whole subject fits a portrait page, otherwise the whole photo on a blurred copy | Line-up of trucks kept whole; Jeep photo with large lettering skipped |
| Cover extension | Optional button; OpenAI generates scenery above and below the photo, and the original photo is laid back over the result | One request, about 35 seconds including the reprint |
| Logos | An extra image with a transparent background is a logo; otherwise Claude decides. Shown on a white plate at the top of the opening page | Not exercised: no post in the test months has a logo attached |

Every AI step is optional: without a key, or when a request fails, posts stay general, crops come from the centre and the foreword falls back to the automatic summary.

Consequence for counts: with Claude placing shared posts, few "general" posts remain to fill a thin edition. Commercial Vehicle for September now has 8 relevant articles and a warning, instead of 10 with unrelated filler.

Open: the OpenAI image model is the setting `ai.imageModel` (default `gpt-image-2.6-sunburst`, taken from OpenAI's guide); its price per image was not stated on the pages read. The mask behaviour of the edit endpoint could not be confirmed from the reference page, which is why the original photo is always laid back over the result.

## 16. Phase 5 as built (2026-11-13)

Tested by driving the edition page in a headless browser on two throwaway drafts (Cars and Bikes, August posts), checking the database after each step.

| Part | How it works |
|---|---|
| Article list | Changes are made in the browser and stored with one Save: order (Up, Down, First), Leave out and Include, section, type. "Put in standard order" sorts by the section and type order from Settings |
| Sending a post elsewhere | Per post: move or copy to another edition. It goes to the end of the newest draft of that edition for the same month, marked "manual". If there is no such draft the save is refused with a message to generate it first |
| Warnings | After every save the count warnings (below minimum, above maximum, below recommended, posts without image) are worked out again; warnings from the last PDF run are kept |
| Out-of-date PDF | Any change sets `mg_editions.pdf_stale`; the page says the PDF is out of date until it is created again |
| Cover | Pick any included article's photo and type a cover headline; stored in `cover_pick_post_id` and `cover_line`, and the PDF is created again at once. The pick is dropped automatically if that article leaves the edition |
| Extra images | Each extra image of an included post is listed with what it is used as and why. A choice by hand (`mg_asset_cache.manual_kind`: logo, photo, none) overrules the measurement and Claude, in every edition that uses the image |
| Finished | "Mark as finished" needs an up-to-date PDF. A finished edition cannot be changed, printed again or deleted until "Reopen as draft" |

Not built: adding a post that the selection did not offer to the edition at all (for example from another month or an unrelated category), and drag-and-drop ordering. The `snapshot` column is unused: a finished edition's record is its PDF.

Migration: `db/migrations/004_review.sql`.

## 17. Article types and default order (2026-11-13)

The three fixed types (launch, other, management) were replaced by a list kept in Settings (`types`), each with a key, a label, headline words and optional categories. Default printed order, as given by the owner:

1. Vehicle launches
2. New vehicle flag-offs
3. Plant launches
4. Components and accessories launches
5. Interviews
6. Tie-ups
7. Partnerships
8. New purchases
9. Joint ventures
10. Mergers and acquisitions
11. Other news (posts that fit none of the named types; this position is our choice)
12. Financials
13. Managerial changes

- How a type is decided: headline words first; if the headline matches no type, the post's category (New Launches, Joint Venture, Mergers & Acquisition, Financials, Appointments, Agreements). The site's "Investment" category is not used, because it holds plant openings, dealerships and offices alike. When a headline fits several types, the type later in the `types` list wins, so "plans new tractor plant" is a plant launch and an appointment is always managerial.
- Default order: `ordering.sections` and `ordering.types`, edited with Up and Down on the Settings page. It applies to new editions; on an existing draft, "Put in standard order" applies it.
- On August and September 2026 posts: 69 vehicle launches, 1 flag-off, 5 plant launches, 3 component launches, 0 interviews, 1 tie-up, 4 partnerships, 5 new purchases, 1 joint venture, 3 mergers and acquisitions, 36 other, 10 financials, 5 managerial. Known misses: monthly sales reports count as financials; "Appoints ... Distributor" counts as managerial; a product headline with "Introduces" counts as a vehicle launch even when it is a programme.
- Migration `005_article_types.sql` renames the old keys in existing drafts. Settings saved in the old shape are upgraded when read.

## 18. Article type read from the full text by Claude (2026-11-13)

Asked for by the owner: instead of trusting the headline, read the article.

- At Generate, every post that can appear in an edition and is not too short is sent to Claude with its full text (first 7,000 characters), its site category and the list of types with their descriptions from Settings. Ten posts per request, three requests at a time.
- The answer (type and a short reason) is stored in `mg_post_types` and reused by the dashboard preview and by every later edition. If the list of types or their descriptions change in Settings, posts are read again at the next Generate.
- The edition page shows the reason next to each article while its type is still the one Claude chose. A type changed by hand always stays.
- Without a key, or when a request fails, the type comes from the headline words and category as described in section 17, and the edition gets a warning.
- Test on real posts: August 2026, 91 posts in 16 seconds, 28 types different from the headline's; September 2026, 52 posts in 9 seconds, 13 different. Every change read was an improvement, for example "Tamil Nadu Launches 250 New Buses" from vehicle launch to flag-off, "Faresin Appoints Haulotte Telehandler Distributor" from managerial to tie-up, "Hyundai Introduces Assured Buyback Programme" from vehicle launch to other.
- Migration `006_post_types.sql`.

## 19. Cover: Claude briefs the image model, and the watermark is removed (13 November 2026)

Asked for by the owner.

- **Cover brief.** Before a photo goes on the cover, Claude looks at it once more (the whole photo plus an enlargement of its bottom-left corner) and returns: the setting, what should continue above the photo, what should continue below it, the lighting, what the scene must not gain, how the added height should be shared above and below, and whether the site's watermark is there. Stored next to the cached photo (`<key>.brief3.json`), so each photo is read once. Code: `src/lib/ai/cover-brief.ts`.
- **Prompt to the image model.** "Extend the cover photo with AI" now sends those notes to OpenAI instead of a general instruction, and places the photo higher or lower on the page as Claude suggests. The original photo is still laid back over the result.
- **Watermark.** Whenever a cover image is made, in any layout (full-page crop, whole photo on a blurred copy, AI-extended), the round Race Auto India mark stamped on the stored photo is taken out first. The mark is looked for over the **whole photo**, not only the bottom-left corner where it usually sits. It is recognised by its design: a ring of blue, red, yellow and green arcs in fixed quarters. Claude is also asked whether it sees the mark and where; with Claude's sighting a weaker match is accepted, and Claude's position is the fallback if the design is not recognised. The disc is then filled from its rim, so floor gradients and shadows continue, and the grain of the area beside it is laid on top. The magazine's own masthead logo at the top of the cover is unchanged.
- **Tested.** On 12 cached photos with the mark at the bottom left: found and removed in all 12 with Claude's sighting, and in 11 of 12 from the design alone (0.4 seconds per photo). With the mark moved to the top right, top left, bottom right and the middle of a photo: found and removed in all four, both from the design alone and seen by Claude. A cleaned photo searched again gave no false find in 11 photos. The fill is invisible on plain areas (sky, floors, roads, sand) and leaves a soft smudge where the mark sat over detail (a hedge and kerb, a trouser leg, a windscreen). One real AI extension with the new prompt took 34 seconds and joined the photo without a visible seam.
- **Limits.** Only the cover photo is cleaned; the photos inside the magazine still carry the mark. Without an Anthropic key there is no brief: the image model gets the general instruction as before, and the watermark is removed only when its design is recognised clearly.

## 20. Cover: repeated parts, the watermark fill, and the default style (13 November 2026)

Reported by the owner on a real cover (Commercial Vehicle, a Tata Intra EV photo): a second roof line and load appeared above the photo, the spot where the watermark had been was a blur, and the blurred-background cover was the default.

- **Repeated parts above the photo.** OpenAI's guide says masked edits are prompt-based and may not follow the mask exactly: the model repaints the whole picture, with the photo a little larger, smaller or shifted. The original photo was laid back at the place it had been sent, so the model's own copy of the vehicle showed around it. Three changes: the areas to be painted are now sent as a smear of the photo's own top and bottom edge colours instead of a blurred copy of the whole photo (which showed the model a ghost vehicle to imitate); the prompt says to finish objects cut by the photo's edge once and never to draw a second copy; and after the picture comes back, the place where the model put the photo is measured (size and shift) and the original is laid exactly over it. If it cannot be found, the original goes where it was sent, as before.
- **Watermark fill.** The smooth fill is replaced by one that rebuilds the disc from pieces of the surrounding picture, working inward from the rim and carrying lines across first. Texture and sharpness now match the surroundings. About one second per photo.
- **Default style.** A new edition's cover is the photo stretched to the full page with AI whenever an OpenAI key is set. "Whole photo, blurred above and below" and "Cropped to fill the page" are choices on the Cover tab (`cover_style`, migration `007_cover_style.sql`). The AI picture is made once per cover photo, during Create the PDF (about half a minute, one request charged to the OpenAI account), and reused afterwards; "Paint a new version" asks for another. If the request fails, the blurred layout is used and the edition gets a warning.
- **Tested.** The owner's truck photo again: no second roof, the load and cab finished cleanly, the watermark spot not visible. The browser test covers the default, switching to the blurred style, and picking another photo.
- **Also fixed.** After a change on the Cover tab the page could jump back to the Articles tab, because the data refresh dropped the tab from the address. The open tab is now kept in memory.
- **Not yet handled.** When the model moves the photo and the measured place differs a lot from the sent one, parts of the photo can fall off the page edge; this did not happen in three real runs (the photo stayed within one pixel).

## 21. Publisher-page logo and processing time (13 November 2026)

**Logo on page 2.** The publisher page used the black-lettered logo on every edition, which disappeared on the dark Commercial Vehicle and Construction backgrounds. A white-lettered version (`assets/magazine/logo-white-text.png`, made from the black one; the coloured arcs are unchanged) is now used whenever the page's background colour is dark, decided from the colour itself, so a new edition colour needs no extra rule.

**Processing time.** Asked for by the owner: show on each magazine's page how long the application spent on it, with the breakdown.

- Every run that takes real time leaves a record in `mg_edition_timings` (migration `008_timings.sql`): generating the draft, each creation of the PDF (including the ones caused by a cover change), and each foreword written by Claude. A run that fails is recorded too.
- Each record holds its steps with their time and who the time was spent waiting for: Claude, OpenAI, the website, or the application's own work. Steps of a PDF run: reading the articles' text, photos (download, Claude's look, crops; with how many were new), the cover notes and watermark, the AI cover picture when one is painted, laying out the pages, the page pictures for the reader, writing the PDF file, waiting for another PDF when there was a queue, and "everything in between" when the named steps leave more than a quarter of a second unexplained.
- When several editions are generated together, the work done once for the month (reading the posts, Claude's sorting and reading) is shared out equally between them, so the editions' times add up to what was really spent.
- **Where it is shown.** On the edition page, a "Processing time" chip sits next to the line that says when and by whom the edition was generated. Hovering shows the split by kind of work; clicking opens a panel with the total, a bar split by who was waited for, and every run, each of which opens to its steps. On the dashboard each edition card shows its total. While something is running, a clock counts next to it, and when it finishes the message says how long it took.
- Your own time reviewing is not measured, and editions made before this change have no records until something is run on them again.

## 22. Cover: no people, and a check of every AI cover (14 November 2026)

Reported by the owner on the Commercial Vehicle edition from March posts: the cover was a portrait of an executive, and the AI extension had drawn a doubled hairline above his head and a jacket that did not meet at the join.

- **No people on the cover.** Claude's reading of each photo now says whether people are what the photo is of ("main"), only incidental ("background") or absent ("none"), and a photo of people is never judged fit for a cover. The automatic choice prefers, in order: a fitting photo with nobody in it from an article squarely about the edition; one with only incidental figures; a fitting photo from any article; any real photo that is not of people. Only when every photo in the edition is of people does one of them go on the cover, with a warning. A photo picked by hand on the Cover tab is still used as picked. Photos looked at before this change are looked at once more, the first time an edition containing them is printed.
- **What the image model may paint.** Claude's notes on the cover photo now say whether the subject is cut off by the photo's top or bottom edge. Where it is not, the image model is told to paint background only there and to let no part of the subject appear outside the photo; where it is, to finish the missing part once.
- **Every AI cover is checked.** After the picture is made, Claude looks at it as a picture editor would: a part of the subject drawn twice, a visible join, a subject completed wrongly, invented text or vehicles. If it finds a fault, the picture is painted once more; if the second is faulty too, the cover uses the whole photo on a blurred background instead, the edition gets a warning saying what was wrong, and that photo is not painted again until "Paint a new version" is pressed. Tested on three real covers: the reported portrait and the earlier truck cover with the second roof were both rejected with the fault named correctly, and the good truck cover was accepted.
- **Result on the reported edition:** the cover is now the red Kenworth truck from the launch article, extended cleanly.
- **Cost.** One more Claude request per new AI cover (the check), and a second OpenAI request only when the first picture is faulty.

## 23. Guest articles and Industrial outlook (14 November 2026)

Asked for by the owner: two more article types, for the posts filed under the **Insights category of the news posts** (category 71, a main category beside Business, Tech and Vehicles). The category has no posts yet.

- **The two types.** "Guest articles" (a piece by a named outside author, in the author's own voice) and "Industrial outlook" (where a market or segment stands and is heading; about a market as a whole, not one company's news). In the printed order they come after Interviews and before Tie-ups; the order is changed on the Settings page as for any type. There are now 15 types.
- **The Insights category is read.** Until now its posts would have been ignored, because the category belonged to no edition. It is now one of the shared categories, like Tech and Business: a post about one segment goes to that edition by its headline words, its tags or Claude's placement.
- **Industry-wide Insights posts go to every edition.** A shared post that names no edition is normally only filler. For the Insights category (`sharedPool.everyEditionCategoryIds`) such a post is a full article in every edition, since an outlook for the whole market concerns all of them.
- **Deciding between the two types.** Claude reads the article, as for every type, and is told that both are filed under Insights on the site. Without Claude, a headline with "guest", "column", "opinion" or "viewpoint" is a guest article, and any other Insights post is an industrial outlook.
- **Existing posts were scanned.** Adding types changes the list Claude chooses from, so every post is read again. All 779 posts of March to September 2026 were read with the new list. Five ordinary posts turned out to be industrial outlooks: "TREM V 2026: India Tractor Price Hike Impact", "India Vehicle Scrappage Policy Outlook and Strategic Direction", "India 5-Star Car Safety Rating Bharat NCAP System", "India Tractor Retail Sales Hit Record High" and "India Mandates Load-Body Cover Systems for Tippers and Dumpers from April 2027". None is a guest article. Drafts generated earlier keep the types they had; generating again uses the new ones.
- **Settings saved earlier** receive the two types and the Insights category automatically when they are read.
- **Not the same as the site's Insights section.** The site also has a separate Insights section with its own tables (18 market analyses). It is not read by the generator. It was wired in by mistake for a short time on this day and taken out again when the owner clarified; nothing of it remains in the code or the data.
- **Not tested with real Insights-category posts**, because there are none: the rules were checked with made-up posts, and Claude's choice between the two types has only been seen on the five ordinary posts above.

## 24. Adverts, step 1: library, Claude's description, full and double pages (16 November 2026)

Asked for by the owner: adverts added on demand, printed between the articles and not in a section of their own; every uploaded advert described by Claude; that description used to print the advert with the article it relates to; a double page in the middle of the magazine by default; the reason for each place shown where the order is edited.

**What was built**

- **Advert library** (`/adverts`, "Adverts" in the navigation). An advert is uploaded once as a picture (JPG, PNG, WebP, TIFF, GIF, SVG; up to 30 MB) with the size that was booked, and can then be printed in any edition and month. Stored under `data/adverts/<id>/` (the file as uploaded, the page picture, a small picture); tables `mg_adverts` and `mg_edition_adverts` (migration 009).
- **Sizes.** Double page 420 × 297 mm (best 4960 × 3508 px, smallest 2480 × 1754), full page 210 × 297 mm (2480 × 3508, smallest 1240 × 1754), half page 210 × 148.5 mm, quarter page 105 × 148.5 mm. No bleed: the magazine is read on screen. Half and quarter pages came with step 2 (section 25).
- **Shape check before upload.** The form shows the picture as it will sit on the page and says, before anything is sent, how much is cut off or that the picture is too small to look sharp. "Fill the space" crops (keeping the middle, top, bottom, left or right); "Show the whole picture" adds a border in the picture's own prevailing colour. A soft picture is warned about, not refused.
- **Claude's description.** One request per advert at upload: advertiser, product, a two or three sentence summary, the editions it suits and up to 12 words an article on the subject would contain. The advertiser's name is read from the advert when the field is left empty. The summary can be corrected by hand, or Claude asked again.
- **Placement.** Adding an advert to an edition (Articles tab) chooses its place at once:
  - a **double page** follows the article that ends at the middle of the magazine;
  - a **full page** goes with the article Claude picks from the advert's description and each article's headline, type and first 700 characters of text (one request per addition). Order of preference: an article about the advertiser, then the same kind of product, then the same segment. Closeness of subject comes first; when the closest article is mainly about a competitor it is still chosen and a warning is shown on the row;
  - a full page that relates to nothing goes near the middle, with an article that has no other advert, and says so;
  - without a Claude key, or when the request fails, shared words decide (the advertiser's name counts most).
- **The reason is shown** on the Articles tab: each advert is a violet row under its article with "Why here", who placed it (Claude, the app's rules, by hand), a competitor warning when there is one, and its page number once the PDF is up to date.
- **Moving an advert**: drag it by its handle onto an article, use its up and down arrows, or pick the article from "Print it with". ↻ has the place chosen again; ✕ takes it out of the edition (it stays in the library). These are saved at once, unlike changes to the article list.
- **An advert follows its article.** When the article is left out, sent to another edition or deleted, the advert is placed again on save (and before a PDF, as a safety net) and its reason starts with "Its article is no longer in the magazine".
- **Timing.** Adding and re-placing are recorded under "Placing adverts" in the processing time.

**How the pages stay in step**

Every article still starts on a left-hand page. A full-page advert is the right-hand page that ends its article:

| Article | Without advert | With one full page |
|---|---|---|
| Short (one spread) | spread | spread, the article's full-page photo, advert |
| Long, one text page | spread, text, photo | spread, text, advert (takes the photo's place) |
| Long, two text pages | spread, text, text | spread, text, text, photo, advert |

The article's own full-page photo is kept or dropped so that the count is even; no house advert or filler from outside is needed. A double page is a spread of its own after the article (and after its full pages). Advert pages carry no footer or page number; the pages around them are numbered through, and the contents pages follow.

**Not done in this step**

- **Half and quarter pages** inside an article's text: built in step 2, section 25.
- **Clickable adverts**: the web address is stored with the advert; the PDF does not link it yet.
- **PDF uploads**: the page has to be exported as a picture first.
- **Page 2 and the back cover** stay the publisher's own, as decided.
- **Bookings** across months and a billing record of what ran where (the library lists the editions each advert is in).

**Tested**

- Page arithmetic on a made-up magazine of 17 articles covering every article length with one, two or three full pages and double pages: every article starts on a left-hand page, every run of full pages ends on a right-hand page, every double page starts on a left-hand page, page numbers sit on the outer edge, 96 pages.
- A real draft (Commercial Vehicle, March posts, 20 articles) with four invented test adverts. Claude described all four correctly and read the advertiser's name from the one uploaded without it. Reefer bodies went with the reefer-body article and fuel cells with a hydrogen article, each with a competitor warning where due; a coffee advert was recognised as unrelated; the double page went after article 10 of 20. PDF: 74 pages, adverts on pages 35, 43, 44-45 and 49.
- In a browser: upload with warnings, correcting a description, retire, delete, arrows, the list, drag and drop, take out and add again, leaving out an article with an advert, the PDF and the reader's list.
- Not tested: real advertisers' artwork; TIFF, GIF and SVG uploads (only PNG was uploaded); files near 30 MB; a production build.
- Claude's choice is not identical on every run: asked again, the fuel cell advert moved between two hydrogen articles. Both were sensible.

## 25. Adverts, step 2: half and quarter pages inside articles (16 November 2026)

- **Where they are printed.** A half page (210 × 148.5 mm) fills the lower half of the first text page of the article it relates to, edge to edge. The article's text and the page footer sit above it; the text that no longer fits flows on to further text pages. A quarter page (105 × 148.5 mm) sits in the same lower half: two quarter pages side by side, or one on the outer side with the article's photo beside it. When the article's picture is a logo or a graphic (as Claude classified it), a dark panel with the headline is shown beside the quarter page instead, because a logo cut to that shape shows a meaningless piece of it.
- **The article takes the long layout.** A half or quarter page needs a text page, and only the long layout (photo spread, then text pages) has one. A short article that would otherwise be one spread becomes four pages: spread, text page with the advert, full-page photo.
- **Room.** An article's text page holds one half page or two quarter pages, no more. Automatic placement only offers articles with room; when Claude's first choice is full, its next choices are tried, and the reason says so. Moving an advert by hand onto a full article is refused with the reason. Full and double pages are not limited by this.
- **Placement** is otherwise as for a full page: Claude picks the article from the advert's description, closest subject first, with a competitor warning where due; an unrelated advert goes near the middle with an article that has no advert.
- **Upload.** All four sizes can now be uploaded; the shape and sharpness check works for each.

**Tested**

- Page arithmetic, extended to 28 made-up articles and 38 adverts (150 to 2,400 words; half, quarter, two quarters, and mixes with full and double pages): the article takes the long layout, the adverts are on its first text page, the lower half is filled edge to edge, text and footer sit above it, later text pages carry no advert, every article still starts on a left-hand page.
- The real draft (edition 63) with three more invented adverts: tyres (half), fleet tracking and truck finance (quarters). Claude placed tyres with the tipper semi-trailer article, truck finance with the delivery financed by a truck finance arm, and fleet tracking with a fleet article. PDF: 78 pages with seven adverts.
- The room rule on that draft: two quarter pages share an article; a half page is refused there; a quarter is refused beside a half; a full page is accepted.
- The browser test of step 1 passes again with all seven adverts.
- Not tested: a half or quarter page on an article whose text is cut off for other reasons; real artwork.

**Known limits**

- A very short article (about 150 words) with a half page leaves white space between its text and the footer.
- The advert is always on the first text page, never a later one.

## 26. Page numbers on advert pages (16 November 2026)

Asked for by the owner: the page number is shown on every page, in its usual place, whatever is on the page.

- **Full and double page adverts** now carry the page number in the outer bottom corner, where every other page has it. Nothing else of the footer is printed on them.
- **Text pages with a half or quarter page** keep the number in the same corner, over the advert. Before this it had moved up above the advert together with the rest of the footer. The brand name, section label and month are left out on these pages, since they would lie across the advert; the section label is still at the top of the page.
- **Trade-off.** The number is a small dark box (about 9 × 7 mm, 13 mm from the outer edge and 9 mm from the bottom) printed over the advertiser's artwork. Printed magazines usually leave the number off full-page adverts for this reason. Advertisers should keep the two bottom corners clear, about 25 × 20 mm each; the Adverts page says so under "Sizes to give advertisers". Both corners, because the same advert can fall on a left-hand or a right-hand page.
- **Tested** on the made-up magazine: every page of every article after its opening spread has its number at the same distance from the outer edge and the bottom, on text, photo, advert and mixed pages alike.

## 27. Text pages left largely empty (16 November 2026)

Reported by the owner: page 31 of the test edition was about 70% empty. An article whose first text page carries a half-page advert had a few lines left over, and they went alone to the next page. The same could happen to any long article without adverts.

Three changes to how a long article's text is laid out, for every article:

- **The text is set at the largest size that fits its pages.** The smallest size (8.75 pt) decides how many text pages the article needs. The text was then left at that size; it is now set at the largest size, up to 12 pt, that still fits in as many pages, so the pages fill evenly.
- **A paragraph may continue overleaf.** Only whole paragraphs used to move to the next page, which left the foot of a page empty when a long paragraph followed. As many of that paragraph's opening sentences as fit are now kept on the page. Paragraphs with bold lead-ins and sub-headings are still moved whole.
- **The article's picture fills what is left.** When the last text page is still more than about a third empty (and at least 45 mm), its text is set in two equal columns at the top and the article's picture fills the rest of the page. A logo or chart is shown whole on a light background, never cropped. A page with adverts in its lower half is left as it is.

The text itself is never shortened: posts are printed as written.

Tested on the made-up magazine: no text page without adverts is more than 35% empty (all were 0 to 2%). On the test edition, page 30 now ends with the start of the next paragraph and page 31 holds the rest of the text at 12 pt with the photo below it.

## 28. Every photo of a post is used before one is repeated (16 November 2026)

Asked by the owner: pictures repeat because posts lack pictures; with three or four, would nothing repeat?

- **Why pictures repeat.** An article shows a picture in up to four places: the opening spread, the full-page photo that ends a long article, the space a last text page has left, and beside a single quarter-page advert. Of the 780 posts of March to September 2026, 762 have one picture, 13 have two, 1 has three and 4 have four or more. With one picture, the same one is shown in every place.
- **Before this change** only one extra photo of a post was used (as the full-page photo); a third and fourth were ignored, and the page-filling picture was always the main photo again.
- **Now** each real photo gets a place of its own, in the order the post stores them: main photo on the opening spread; first extra as the full-page photo; second extra in the space a last text page has left; third extra beside a single quarter-page advert. With fewer photos the later places fall back to an earlier extra photo, and only then to the main one. Logos and graphics among the extra images are not counted as photos, as before; the choice per image on the Cover and photos tab still applies.
- **Still repeated whatever the post has:** the contents pages show each article's main photo small, and the cover shows one article's main photo. That is how a contents page and a cover work, not a shortage of pictures.

## 29. Adverts page made easier to use (16 November 2026)

Asked for by the owner. The page had the upload form always open at the top and every advert shown as a full form, so the library was hard to scan.

- **Sizes always in view.** Four tiles, each with a small drawing of an open magazine showing where that size is printed, its measurements in mm and pixels, and the note about keeping the bottom corners clear. This replaces the folded table.
- **Library first.** Each advert is one compact row: picture, advertiser, size, the first two lines of its description and the editions it is in. The fields appear only when Edit is pressed. A new advert, or one without a description, opens by itself.
- **Search and filter.** A search box (advertiser, product, description, file name), a button per size with its count, and retired adverts hidden until "Show retired" is ticked.
- **Upload on request.** The form opens from "+ Upload an advert" (and is open by itself while the library is empty). The picture can be dropped onto it or chosen. The size is selected from the picture's shape and pixel size, with a line saying so; a picture of no known shape says that instead. The optional advertiser and web address are folded away. The upload button is live only once a picture is chosen.
- **After upload** the new advert is marked New, scrolled into view and opened for checking.
- **Add to an edition from the library.** Each row lists the draft editions the advert is not in yet; Add places it there and links to the Articles tab to see where and why.
- **Editing.** Save is live only after a change, the row says "Not saved yet", and closing with unsaved changes asks first. An advert in use says why it cannot be deleted.

Tested in a browser: search, size filter, size suggestion for a quarter-page and a square picture, upload, edit and save, add to an edition from the row, retire and show retired.

## 30. Choosing an edition's adverts in one go (17 November 2026)

Reported by the owner: adding adverts to an edition meant choosing one from a drop-down, confirming, and repeating for each.

- **A picker with tick boxes** replaces the drop-down on the Articles tab. Every library advert not yet in the edition is a card with its picture, advertiser, size and the start of its description. Clicking a card ticks it.
- **Ticked for you.** Adverts that Claude found addressed to this edition's readers are listed first, marked "For <edition>", and on an edition without adverts they are ticked already. "Tick all", "Only those for <edition>" and "Untick all" change the lot.
- **One press adds them all.** The button says how many ("Add 6 adverts and place them"). All places are chosen together in a single request to Claude, which is faster than one request each and lets it keep two adverts off the same article.
- **Opens by itself** on an edition that has no adverts while the library has some; afterwards it opens from "+ Add adverts (n in the library)".
- Adding a single advert from a row of the Adverts page works as before.

Tested in a browser on a draft made for the test and deleted afterwards: seven adverts offered, six ticked already, six added and placed with one press in 13 seconds on six different articles, the seventh added later.

## 31. Adverts suggested from the edition's content (17 November 2026)

Asked for by the owner: the advert picker on the edition page should suggest adverts from what the edition contains.

- **Claude reads the edition's articles** (headline, type and the first 700 characters of each) together with the descriptions of the library adverts not in the edition yet, and says for each advert which article it belongs with and why. One request for all adverts. The picker asks by itself when it opens; nothing has to be pressed.
- **On each card:** "Suggested" when an article is about the advertiser or about the kind of product advertised; "Same segment" when only the vehicle segment is shared; "No related article" otherwise; and a line naming the article and the reason. "Competitor's article" is shown when that article is mainly about a competitor. A double page names the middle article, since that is where it is printed.
- **Order and ticks.** Suggested adverts come first and are ticked on an edition that has no adverts yet, unless the person has started ticking. "Only the suggested (n)" ticks exactly those.
- **Stored.** Suggestions are kept per edition and advert (table `mg_edition_advert_suggestions`, migration 010) and reused until the edition's included articles change or the advert's description or size changes. A reload does not ask Claude again; an advert uploaded later is asked about alone.
- **What is suggested is what happens.** Adding ticked adverts uses the stored suggestions as their places, so no second request is made and the reason on the row is the one that was on the card. A half or quarter page can still move to its next choice when the article's text page is full.
- **Without a Claude key** the picker works as before: adverts addressed to the edition's readers are marked and ticked.

Tested in a browser on a draft made for the test and deleted afterwards: suggestions appeared by themselves in 18 seconds; 4 of 7 adverts were suggested and ticked, 2 marked "Same segment", the coffee advert "No related article"; after a reload they were shown at once; the 4 were added in half a second, with the three full and quarter pages on exactly the articles their cards named.

## 32. Disabling an advert (17 November 2026)

Asked for by the owner: a way, on the Adverts page, to disable an advert so that it is not considered at all.

- **A switch on every row** of the library, in plain view: Enabled (green) or Disabled. One press changes it. It replaces the "Retire" button that was inside the Edit view; the stored flag is the same (`mg_adverts.archived`).
- **A disabled advert is left out everywhere:** it is not shown in an edition's advert picker, not sent to Claude for suggestions, and refused if something tries to add it anyway. It cannot be added from its own row either.
- **It stays in the library**, greyed with a dashed border and a line saying it is left out, so it can be switched on again. "Show: all / enabled only / disabled only" filters the list, and the heading counts both.
- **Editions it is already in keep it.** Disabling stops new use; it does not pull the advert out of a magazine that already prints it. The row says so and links to those editions.
- **Enabled again**, it is offered again, and Claude is asked about that one advert only the next time a picker opens.

Tested in a browser (switch off, stays in view, filters, switch on) and against a draft made for the test (six of seven adverts sent to Claude, none suggested or addable for the disabled one).

## 33. Design tab: editing pictures and text on the finished pages (18 November 2026)

Asked for by the owner before Phase 6: see the magazine in its final design before the PDF is made and change it there. Move a picture inside its frame, zoom it, change it for another; add, remove or reword text. Decisions taken with the owner: edits belong to that edition only and never change the post; a frame can show one of the post's pictures or an uploaded one; a picture always fills its frame (no zooming out past that); text can be edited only as far as the layout is not affected; the team uses Chrome.

**What a person sees**

- A fifth tab, **Design the pages**, between "Cover and photos" and "Read and download". It shows every page of the magazine as two-page spreads, built in the browser by the same script that lays out the PDF. "Go to" jumps to an article; "Real size" shows the pages unscaled. The tab loads when it is first opened (it holds every photo of the magazine), not with the edition.
- **Pictures.** Dragging a photo moves the picture inside its frame at once; a bar at the foot of the window has zoom (100% to 400%), Save, Change picture, Reset and Done. The position is saved when the mouse is let go. Frames: the cover, each article's opening photo, its full-page photo, the photo under a short last text page and the photo beside a single quarter-page advert.
- **Another picture.** "Change picture" offers the post's own pictures and those uploaded for this edition, and takes an upload (stored as a JPEG of at most 2480 px width under the edition's folder). The cover's picture is still chosen on the Cover tab.
- **Text.** Clicking a headline or paragraph opens the article's text in a side panel: headline, every paragraph, bold and italic, add and delete a paragraph, a running word count. Pasted text comes in plain. Enter starts a new paragraph.
- **The layout guard.** On Apply the article is laid out with the new text in a hidden copy of the page. The change is kept only when the article keeps its number of pages and its layout and nothing is cut off; otherwise it is refused with the reason ("needs 10 pages; it has 4 now"). So wording can change freely and length only a little.
- **Changes list.** The tab lists every change made to the edition with a Reset each, and says when the post on the website has changed since its text was edited here.
- A finished edition shows the pages without editing. While the article list has unsaved changes, editing waits for them to be saved.

**How it is built**

- **One layout, two places.** `designHtml()` builds the same document as the PDF with the app's own file addresses in place of `file:` ones (`/design-file`, signed-in users, data and assets folders only) and without painting an AI cover (a cover not painted yet shows the whole photo on its blurred copy until the PDF is created). It is shown in a same-origin frame; a few CSS rules added there arrange the pages as spreads.
- **Framing** (`lib/framing.ts`): a frame shows a part of its picture that has the frame's shape; x and y (0 to 1) say where that part lies in the room it has, zoom (1 to 4) how small it is. The picture can therefore never leave part of a frame empty. The same three numbers give the cut for the PDF (`frameArea`) and the CSS for the live view (`framingCss`), and the automatic crop around the subject is expressed in them too, so a picture does not jump when it is first touched.
- **Cut pictures stay cut.** Opening photos and full-page photos have a dark gradient that is part of the picture file (transparent overlays are unreliable in PDF viewers). For the PDF they are still cut by the server, now with the saved framing. On the Design tab, selecting one swaps the cut file for the whole picture placed by CSS with a gradient drawn over it; after a reload the page shows the newly cut file.
- **Stored per edition** (migration 011): `mg_edition_frames` (picture and framing per frame), `mg_edition_texts` (headline and paragraphs per article, with a hash of the website's text at the time), `mg_edition_uploads`. Text edited back to the original is stored as "not changed", so the article follows the website again.
- **No editor package.** Text is edited with the browser's own editable boxes, and its bold and italic commands; pictures with pointer events. The text is reduced on the server to paragraphs with bold, italic, superscript and subscript, by the same code that cleans the posts' own HTML.

**Tested** in a browser on the test edition (78 pages): the live pages are as many as the PDF's; selecting a photo changes nothing on the page (measured difference between the cut picture and the live one: 0 of 255); zoom and drag move the picture and are saved; dragged far past its edge the picture stops at the edge; after a reload the page uses the newly cut file; a text change that would take 10 pages instead of 4 is refused with the reason; a reworded paragraph is kept and the article keeps its 4 pages; an uploaded picture fills an opening spread. The PDF made afterwards contains the edited text, the uploaded picture and the reframed photo.

**Not tested:** the cover frame, the photo under a short text page and the photo beside a quarter-page advert (they use the same code as the frames that were tested); Firefox and Safari; a magazine of 30 long articles (the tab loads every picture at once).

**Known limits**

- The check on a text change takes a few seconds, because the article is laid out for real.
- A change of length that would add or remove pages is refused, not offered with a warning. That is the rule the owner asked for.
- Foreword and cover headline are still edited on their own tabs.
- Old cut pictures stay in the cache folder after a frame is moved again; they are small and can be cleared with the cache.

## 34. Design tab made easier to use (18 November 2026)

Reported by the owner after trying it: the bar for a selected photo stayed on screen with both a Save and a Done button, and getting to a page meant a very long scroll.

- **Two pages at a time.** The tab now shows one spread, sized to fit the window, with buttons to go to the cover, back and forward, a slider through the whole magazine, the page numbers ("Pages 14–15 of 78") and the article the pages belong to. The left and right arrow keys turn the pages. "Go to an article" opens its first spread. "Show: every page, one below the other" brings back the long view for those who want it; "Size" chooses between fitting the window, full width and real size. After anything that rebuilds the pages (another picture, a text change, an undo) the same spread is shown again.
- **The photo bar** is part of the controls above the pages, so it no longer covers the bottom of a page. It says what is being edited ("Editing: Opening photo of …").
- **No Save button.** A change of zoom or position is saved by itself and the bar says "Saving…" then "✓ Saved". "Done" (or Esc, or a click beside the photo, or turning the page) ends the editing; nothing is lost either way.
- **Why a photo will not move.** The bar says when a picture has no room in one direction ("exactly as tall as its frame, so it moves left and right only. Zoom in to move it up and down too").
- **More ways to change a photo.** The mouse wheel over the selected photo zooms it; the arrow keys move it a little, with Shift a lot. "Reset" became "Undo all changes to this photo" and is switched off when there is nothing to undo.
- **A bug found while testing:** the zoom slider read its new value a moment too late and could snap back to the old one. Fixed.
- **Checked while testing:** a longer text that still fits the article's pages is kept; the type gets smaller to make room, down to the smallest size the layout uses. Only a text that needs more or fewer pages, or is cut off, is refused.

Tested in a browser: opens on the cover alone with the frame 771 px tall in a 1000 px window; arrows and arrow keys turn pages; "Go to" opens an article on a left-hand page; the bar is above the pages, names the photo and has no Save button; the slider saves by itself; with a photo selected the arrow keys move the photo and not the pages; Esc closes; undo rebuilds the pages on the same spread; and the earlier checks of dragging, the edge limit, text and uploaded pictures in the every-page view.

## 35. Phase 6: hardening (19 November 2026)

**Production build.** `next build` had never been run. It builds without warnings (one file-tracing warning in the file route was fixed) and `next start` serves every page and file route. The route that serves pictures to the Design tab refuses files outside the data and assets folders (`.env.local` and `../../package.json` both give 404).

**Long work runs in the background** (GEN-01, COV-03, PDF-03). Generating drafts, creating the PDF, changing the cover style and changing the cover photo no longer hold a request open. The action records a job (`mg_jobs`, migration 012), starts the work in the server process and answers at once; the page asks every second and a half how it is going (`useJob`).
- A slow run can no longer be cut off by the web server's time limit.
- One run per subject: a second press, or a second tab, joins the run already going (enforced by a unique key in the table, so two presses in the same instant cannot both start).
- A page reloaded in the middle picks the run up again.
- A run cut short by a server restart is reported as "did not finish, start it again" the next time anyone asks.
- A cover change is refused while a PDF of that edition is being created, since that run would print the old cover.
- The app must still run as one process: the work lives in it.

**Backups** (OPS-01, AD-18, DES-13). `npm run backup` dumps every mg_ table to `BACKUP_DIR/db/<date-time>.sql.gz` (the newest 14 kept) and mirrors `data/editions`, `data/adverts` and `data/finished` into `BACKUP_DIR/files`, adding and updating files but never removing them. `npm run restore -- <file> --yes` loads a dump; with `APP_DB_NAME` set it loads into another database. The cron line and the restore steps are in the user guide. The cache of post pictures is left out on purpose.

**A finished edition keeps its own copy** (FIN-01). Marking an edition as finished copies its PDF, cover and page file to `data/finished/<id>/`. If the working PDF or cover is lost, the copy is served.

**A session that ends does not cost typed work** (REV-02). Saving the article list, the foreword, an article's text on the Design tab and the settings no longer jump to the login page when the session has ended: the page stays, with what was typed, and says to sign in again in another tab. Asking about a background job does the same.

**User guide.** `docs/05-user-guide.md`: the eight steps of making a magazine, what to do when something goes wrong, and running the server (one process, updating, backups, restoring).

**Tested**
- Jobs: three presses start one run; a failure is recorded with its reason; a run left "running" by a dead process is reported as cut short and can be started again.
- In a browser, against the development server and against the production build: Create the PDF answers at once, a reload and a second tab show the same run, one run is made; Generate opens the new draft when it is ready, one draft is made. The Design tab test passes against the production build too.
- Backup, then restore into a scratch database: 16 tables, 1,340 rows and 12 links between tables identical to the live database; a second backup copied no file.
- **Dry run of a full month** (August 2026 posts, all five editions, covers without the paid AI step):

| Edition | Articles | India / International | Pages | PDF size | Time |
|---|---|---|---|---|---|
| Cars | 17 | 10 / 7 | 60 | 5.7 MB | 27 s |
| Bikes | 16 | 12 / 4 | 38 | 3.2 MB | 30 s |
| Commercial Vehicle | 20 | 8 / 12 | 58 | 6.2 MB | 33 s |
| Farm Equipment | 15 | 7 / 8 | 36 | 5.3 MB | 30 s |
| Construction | 16 | 4 / 12 | 40 | 5.5 MB | 32 s |

  Every edition: an even number of pages, every article in the contents and starting on a left-hand page, no text cut off, no picture missing. One was taken to "finished": its copy was kept and found again after its working PDF was deleted, and it refused a picture change and an advert.

**Not done**
- An error log that a person can read in the app; failures are in the server log and, for background work, in the job's message.
- Two people editing the same edition at once (DES-12): the last save wins.
- Copying backups off the server: that depends on where the owner wants them.
- The session-ended message for the smaller actions (moving an advert, disabling one, choosing an extra image): those still go to the login page, and carry nothing typed.
- Not tested: a restart of the real server in the middle of a run (the case was simulated with a database row); cron; nginx; the AI cover step in the dry run.

## 36. The Design tab and the rest of the edition agree (19 November 2026)

Found on the live server: the Design tab showed no clock while it built its pages and the wait was not in the processing time; it showed a blurred cover where the PDF would have the AI picture; and a change on another tab did not reach it until the browser page was reloaded.

- **One version of the edition.** The edition page works out a signature of everything outside the Design tab that changes its pages (status, the article list, foreword, cover choice and style, adverts, how extra images are used). When it differs from the one the pages were built from, the tab builds them again as soon as it is on screen and nothing is being edited. Its own changes are not in the signature: it shows those as they are made.
- **The AI cover is painted for the Design tab too.** A build never waits for it: the pages come at once with the blurred stand-in and say so, and painting runs as a background job (`cover:<id>`), started once by the tab. A failure is shown with "Try again" and is not retried by itself. The picture is the one the PDF uses; a PDF run and this job that want the same picture at the same moment share one painting.
- **The wait is counted.** A clock runs while the pages are built. The page carries the server's steps; once the pages are there the tab reports the whole wait, and a wait of two seconds or more is recorded as "Pages built for the Design tab" with the browser's share as a step of its own.
- **"The PDF is up to date" is only said when it is.** While a PDF is made the edition is marked as being printed (`pdf_stale = 2`); any change in that time marks it as changed, and the finished run then leaves it out of date. Before, a photo moved during the half minute a PDF takes was reported as included.
- **A session that has ended** shows on the Design tab at once, in place of two minutes of "Building the pages".
- **The cover's framing belongs to its picture:** another cover photo, another style or a newly painted picture starts it afresh; a new headline alone keeps it.

Tested: the server side on a scratch edition without an OpenAI key (nothing charged); in a browser, the clock, the recorded wait (on a slowed-down browser), the rebuild after a foreword saved on its tab, and the signed-out message; against a production build with an invalid key, that painting starts once, fails plainly and is not repeated. Not tested: a successful painting started from the Design tab (it would be a paid request; the same code paints for the PDF).

**Following background work (added the same day).** On a local test the page went on showing "The AI is painting the cover" after the painting had finished; the server log showed the page had never asked for the result. It could not be reproduced (development and production builds, a quick and a slow painting, changing tabs meanwhile, arriving from the dashboard). The page now follows a job with plain requests to `/jobs/<id>`, each with a time limit of 15 seconds, in place of server actions: actions of one page run one after the other and can be held up by another action or by the router, a plain request cannot. Starting a job no longer runs inside a React transition.
