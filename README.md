# Race Auto India Magazine Generator

Builds the monthly Race Auto India e-magazines (Cars, Bikes, Commercial Vehicle, Farm Equipment, Construction) from the news posts in the main site's database. Background, decisions and the build plan are in [docs/](docs/).

## Status

All six phases are built (see [docs/03-implementation-plan.md](docs/03-implementation-plan.md), section 9):

1. Foundation: project, database access, login, settings store, deployment files.
2. Selection engine: the dashboard previews each edition for a month, Generate saves a draft per ticked edition, and the edition page lists the chosen posts in page order with the reason each is there.
3. Templates and PDF: the edition page creates the A4 PDF and a cover image, shows the PDF, and offers both for download.
4. Generated front matter: Claude writes the foreword, places shared posts that keywords miss, and finds the subject of each photo for crops and the cover; OpenAI can extend the cover photo to a full page on request.

5. Review: an edition's page has four tabs (Articles, Foreword, Cover and photos, Read and download) under a bar that says what to do next. The finished pages are read in a magazine reader, two facing pages at a time. On a draft you can reorder articles, include or leave out posts, change section and type, move or copy a post to another edition's draft of the same month, pick the cover photo and its headline, overrule how an extra image is used (logo, second photo, not used), and mark the edition finished. A finished edition is locked until it is reopened.

Adverts are built as well: an advert library, a description of each advert by Claude, and double, full, half and quarter page adverts printed with the article they relate to, each with the reason for its place (sections 24 and 25 of the plan).

A Design tab shows the finished pages before the PDF is made and lets pictures be moved, zoomed and changed in their frames and article text be edited, for that edition only (section 33 of the plan).

Phase 6 (hardening) is done as well: long work runs in the background, `npm run backup` and `npm run restore`, a kept copy of finished editions, a checked production build and a user guide in [docs/05-user-guide.md](docs/05-user-guide.md). What is still open is listed at the end of [docs/04-edge-cases.md](docs/04-edge-cases.md).

The AI steps need `ANTHROPIC_API_KEY` and, for the cover extension only, `OPENAI_API_KEY` in the environment file. Without them the app still works: crops come from the centre and the foreword is an automatic summary. The code is in [src/lib/ai/](src/lib/ai/).

## How it fits with the main site

- Reads `race_news` (posts, categories, tags, images, users) with SELECT statements only. `newsQuery` in [src/lib/db.ts](src/lib/db.ts) refuses anything else.
- Keeps its own tables, all prefixed `mg_`, in a separate database (`magazine_generator` by default).
- Login uses the main site's accounts: the email and password are checked against `users`, and the role must have the `newsletter` permission in `roles_permissions`.

## Setup

Requires Node 22 and MySQL 8.

```bash
npm install
cp .env.example .env.local     # then fill in the database user, password and SESSION_SECRET
npm run migrate                # creates the generator database and its mg_ tables
npm run dev                    # http://localhost:3000
```

If the database user is not allowed to create a database, set `APP_DB_NAME=race_news` in the environment file and run `npm run migrate` again; the `mg_` tables are then created inside `race_news`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` then `npm start` | Production build and server |
| `npm run migrate` | Apply new files in `db/migrations/` |
| `npm run typecheck`, `npm run lint` | Checks |

## Deployment (same VPS as the main site)

1. Copy the project to the server, create `.env` from `.env.example`, run `npm ci`, `npm run migrate`, `npm run build`.
2. Start it with PM2: `pm2 start deploy/ecosystem.config.cjs` (listens on 127.0.0.1:4310, one process).
3. Chromium needs a few system libraries on Ubuntu. If creating a PDF fails with a missing library error, install them:
   `sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64`
   (on Ubuntu 22.04 the last one is `libasound2`).
4. Point the subdomain's DNS at the server, install [deploy/nginx.conf.example](deploy/nginx.conf.example) as the Nginx site, and run certbot for HTTPS.

Keep it to one process: the login attempt limiter is held in memory.

## How posts are chosen

The rules are in [src/lib/selection.ts](src/lib/selection.ts), a module with no database access.

- A post whose category belongs to an edition goes to that edition only.
- A post in a shared category (Tech, Auto Comp, Business) goes to every edition whose words appear in its headline, tags, keywords or summary. A headline match counts most; a single word in the summary alone is not enough.
- A shared post that matches no edition is a general post. It is offered to every edition and included only to bring an edition up to the minimum.
- Section comes from the market (India is national, everything else international). Type is one of the article types listed in Settings (vehicle launches, flag-offs, plant launches, components and accessories launches, interviews, tie-ups, partnerships, new purchases, joint ventures, mergers and acquisitions, financials, managerial changes, and "other news" for the rest). At Generate, Claude reads the full text of every post that can appear in an edition and names its type; the answer is stored per post and reused. Without an Anthropic key, or if a request fails, the headline's words decide, and a headline that matches nothing takes the type of its category. The printed order of types and sections is edited with Up and Down on the Settings page.
- Up to the recommended count is included, preferring posts placed by category, then by words, then the most read. The rest are stored with the draft as available.
- Page order is section, then type, then category posts before word-matched posts, then most read.

Nothing runs on a schedule. Generating again for the same month and edition makes a new draft and keeps the earlier one.

## How the PDF is made

- [src/lib/magazine/render.ts](src/lib/magazine/render.ts) collects the edition's posts and photos, writes one HTML document and prints it with headless Chromium (Puppeteer). Files go to `data/editions/<id>/`: `magazine.html`, `magazine.pdf`, `cover.jpeg`.
- [src/lib/magazine/html.ts](src/lib/magazine/html.ts) holds the page templates. Every page is a fixed 210 x 297 mm box. A script inside the document fits the text, picks each article's layout and numbers the pages, so the contents pages and footers always agree with the real page numbers.
- Page order: cover, publisher page, foreword, two contents pages, articles from page 6, back cover. Every article takes an even number of pages so each photo spread opens on a left-hand page: two pages when the text fits a column beside the photo, four when it is longer.
- [src/lib/magazine/images.ts](src/lib/magazine/images.ts) fetches each post's stored photo from the site's bucket once and caches it under `data/cache/`. White bands on a photo's edges are trimmed, and the dark gradient under headlines is drawn into the picture so the PDF contains no transparency.
- [src/lib/magazine/sanitize.ts](src/lib/magazine/sanitize.ts) reduces a post's stored HTML to paragraphs with bold and italic only. The wording is never changed.
- Fixed artwork (logos, director photo, QR code, report advert photos, back cover) and the Roboto fonts are in [assets/](assets/).

## Settings

Rules live in the database as versioned JSON and are edited on the Settings page. Defaults are in [src/lib/settings-schema.ts](src/lib/settings-schema.ts): article counts (minimum 10, recommended 20, maximum 30), category to edition mapping, keyword lists, article order, section labels, AI model. Every save creates a new version; an edition keeps the version it was generated with.
