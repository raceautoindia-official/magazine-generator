# Magazine Generator: analysis of the existing Race Auto India system

Date: 2026-11-12
Status: discovery only. Nothing has been built and nothing on the live site was changed.

## 1. Summary

- The magazine on raceautoindia.com is a **manually designed PDF**. An admin uploads a cover image and a PDF; the site only stores and displays it in a flipbook. There is no generation logic anywhere in the repository.
- The magazine content **is the website news**. An article in the Cars September 2026 edition has the same headline and the same opening text as a website post (post id 5658, published 2026-08-29). Only this one article was compared.
- Both the magazine and the news data can be read today: the magazine through the public flipbook and its PDF, the news through the site's JSON APIs or the MySQL database.
- So the generator's job is: pick posts for an edition, lay them out in the existing magazine style, produce a PDF and a cover, and (optionally) publish it into the existing `newsletter` table and S3 bucket.
- Two security problems were found in the repository along the way (section 7). They need attention regardless of this project.

## 2. What was checked, and how

| Source | Method | Result |
|---|---|---|
| Git repository | Shallow clone, read the magazine, post, category and auth code | Readable. The repository is public (no login needed to clone). |
| Live site, magazine pages | Opened `/magazine` and the Cars September 2026 edition in Chrome, paged through the first 15 pages | Readable without logging in |
| Live site, JSON APIs | Called read-only GET endpoints from the browser | Magazine list, categories, posts by month and single posts all return data without logging in |
| Login with the supplied test account | **Not done** | I do not enter passwords on a live production site. It was not needed: everything above was readable without it. Subscriber-only extras (YouTube previews, related articles) were therefore not seen. |

## 3. The existing application

- Next.js 14 (App Router), React 18, TypeScript and JavaScript mixed, Bootstrap.
- MySQL database `race_news`, accessed with `mysql2` from `lib/db.ts`.
- Files (images, PDFs) on AWS S3, paths like `uploads/images/YYYYMM/...` and `uploads/newsletter/YYYYMM/...`.
- Auth: JWT in an `authToken` cookie; roles admin, moderator, ad team, user. `middleware.ts` guards the `/admin` pages only.
- Libraries already in the project that matter here: `puppeteer` and `pdf-lib` (used by `app/api/generate-pdf/route.js` to print "Flash report" web pages to an A3 PDF and merge them), `react-pdf` and `react-pageflip` (the flipbook), `sharp` (image resizing), `openai` (admin image generation, speech features).

## 4. How the magazine works today

### Storage and upload

- Table `newsletter`: `id, title, title_slug, image_url, pdf_url, category, keywords, created_date, modified_date, created_by, modified_by, magazine_views`.
- Magazine categories, as served by `/api/magazine/category`:

| id | Category |
|---|---|
| 2 | Commercial Vehicles |
| 3 | Cars and Bikes |
| 5 | Farming Equip |
| 6 | C and M Equip |

- Upload: admin page `app/admin/magazine/create` posts a form (title, slug, category, keywords, cover image, PDF) to `app/api/admin/magazine/route.js`, which puts both files on S3 and inserts one row.
- `newsletter_ad` (single row): title, description, edition name and thumbnail used to promote the current edition on the site.

### Reading

- `/magazine` lists editions; `/magazine/[title_slug]` renders the PDF in a flipbook (`FlipBook_v2.jsx` for desktop, `flipkv3.jsx` for mobile).
- The flipbook reads the text of the current page and calls `/api/search-youtube` to show related YouTube videos. That panel, and related articles, are for subscribers; others see an "Unlock Now" box. The pages themselves were visible without login.

### Volume and cadence (from `/api/magazine/sorted/0`)

- 104 editions listed; latest ids run to 137.
- Recent pattern is one edition per vertical per month, for example "Cars - September 2026 Edition", "Bikes - September 2026 Edition", "Commercial Vehicle - August 2026 Edition", plus Farm Equipment and Construction editions.
- The most recent upload is dated 2026-09-09. No October or November 2026 editions were listed.

### Layout of a current edition (Cars, September 2026, 82 pages)

| Pages | Content |
|---|---|
| 1 | Cover: full-bleed photo, logo, "RACE AUTO INDIA", "E-MAGAZINE", subtitle ("Car News & Insights"), month and year |
| 2 | Publisher panel (address, phone, email, social icons, disclaimer, copyright) and a house advert with QR code |
| 3 | Foreword with the director's photo and signature block |
| 4-5 | Contents: photo collage, page numbers and headlines (11 articles) |
| 6 onward | Articles, roughly 4 to 8 pages each |

Article pattern seen on pages 6 to 15:

1. Opening spread: one photo across both pages, headline overlaid, brand logo (Mahindra, Hyundai) in a corner.
2. Following pages: body text in one or two narrow columns on white, beside a large photo; sometimes a full photo spread with no text.
3. Footer on every page: page number in a dark box, "RACE AUTO INDIA", a section label in red ("INTERNATIONAL NEWS"), month and year.

Notes: pages are landscape-ish spreads designed as pairs. The text is real text, not an image (the flipbook extracts it).

## 5. The news data available to a generator

### Tables

- `posts`: `id, title, title_slug, summary, content (HTML), keywords, category_id, image_big, image_default, image_mid, image_small, image_description, market, is_slider, is_featured, is_recommended, is_breaking, is_scheduled, status, pageviews, user_id, created_at, updated_at`, plus unused legacy columns.
- `post_images`: extra images per post. `tags`: `post_id, tag, tag_slug`.
- `categories`: two levels (`parent_id`). `market`: India, US Market, AUS-NZ Market, ASIA Market, Europe.

Main categories: Vehicles, Tech, Auto Comp, Business, Farm ME, CMEQ, Insights, Defence, New Launches, Events, Race Analytics, Classifieds, Videos, RSS News. Sub-categories include Two Wheeler, Three Wheeler, Passenger Vehicle, Truck, Bus and Coach, New Energy Technology, Policy & Regulations, Agri Engines, Construction Equipment, Mining Vehicles and about 45 others.

### Read endpoints that work without login

| Endpoint | Returns |
|---|---|
| `/api/admin/admin-post?createAt=YYYY-MM-DD&mainCategory=&subCategory=&market=&page=` | Published posts for that month with category, author, flags; 10 per page plus total |
| `/api/post/single-post/[slug]` | Full post: HTML content, summary, images, tags, main and sub category |
| `/api/post/main-category?main=&page=` | Posts in a main category |
| `/api/search/[words]?page=1` | Posts matching title or content |
| `/api/category/main-category`, `/sub-category`, `/market` | Taxonomy |
| `/api/magazine`, `/api/magazine/sorted/0`, `/api/magazine/[slug]`, `/api/magazine/category` | Editions, including `pdf_url` |

Published posts per month, as returned by the first endpoint: August 2026: 91, September 2026: 52, October 2026: 8.

### One post examined (id 5658, "Mahindra Expands Battery-as-a-Service Across Electric SUV Portfolio")

- About 310 words, HTML limited to `p, span, strong, a`.
- Category Tech > New Energy Technology; three tags; published 2026-08-29; used in the September edition.
- **One image stored for the post, but the magazine article uses several photos and a brand logo.** The extra pictures are added by the designer and do not exist in the news database.

## 6. Gaps between the data and the current magazine

| Magazine needs | Available in the news data? |
|---|---|
| Headline, body text | Yes |
| Which edition an article belongs to (Cars, Bikes, CV, Farm, Construction) | Partly. Post categories do not map one-to-one to the five magazine verticals; a mapping has to be defined |
| Section label ("INTERNATIONAL NEWS") | Partly. Could come from `market` or category, rule unknown |
| 3 to 6 large photos per article | No. Usually one image per post, largest stored size is the original upload |
| Brand logos | No |
| Cover photo and cover line | No |
| Foreword text | No, written per edition |
| Adverts | No, placed by hand |
| Article selection and order | No. Flags `is_featured`, `is_recommended`, `pageviews` exist but nothing marks "in the magazine" |

## 7. Security findings in the repository

1. **Database passwords are committed in `lib/db.ts`** (the production `deploy` user, a `root` password and an AWS RDS root password in comments), and the GitHub repository is public. Anyone can read them. Rotate these passwords, move them to environment variables, and consider making the repository private. Deleting the lines is not enough because they remain in git history.
2. **`/api/admin/*` routes are not protected.** `middleware.ts` only covers `/admin` pages, so admin APIs (including the magazine upload and post creation) answer without a login. Only GET requests were made during this analysis.
3. **`/api/search/[title]` builds SQL by string concatenation**, which allows SQL injection.

The generator should not copy these patterns, and item 2 matters directly if the generator publishes through the existing upload API.

## 8. Feasible approaches (for discussion, not decided)

| Option | How | Trade-off |
|---|---|---|
| A. HTML templates printed to PDF | Build magazine pages as HTML/CSS, render with Puppeteer (already used in the project) | Closest to the existing skills and stack; real text in the PDF; layout quality depends on the templates |
| B. Editor-assisted | Option A plus a screen where an editor picks posts, reorders, swaps photos, writes the foreword, then generates | More work, but covers the missing photos and selection gaps |
| C. Design-tool export | Push content into InDesign or Canva templates | Best visual quality, external dependency, harder to automate |

Where it lives is also open: a new section inside the existing admin panel, or a separate app that reads the same database or APIs.

## 9. Open questions

**Goal and scope**

1. Should the generator replace the designer-made PDF entirely, or produce a first draft that a designer or editor finishes?
2. Must the output look like the current editions (section 4), or is a new design acceptable?
3. Is the output PDF only, or also a web/HTML edition?

**Editions and selection**

4. Which editions are needed: the five current verticals (Cars, Bikes, Commercial Vehicle, Farm Equipment, Construction), fewer, or others?
5. Which post categories feed each edition? For example, does "Tech > New Energy Technology" go to Cars, CV or both?
6. Who chooses the articles: fully automatic rules (date range, category, most viewed, featured), an editor picking from a list, or automatic with editor review?
7. What period does an edition cover (the September edition used a post from 29 August), and how many articles or pages should it have?
8. What does the "INTERNATIONAL NEWS" footer label depend on?

**Content**

9. Photos: the database has one image per post but the magazine uses several. Should the generator use only what is stored, let an editor upload more, or use AI-generated images?
10. Text: use the post text as it is, or should AI shorten, rewrite or summarise it to fit the layout?
11. Foreword, cover photo, cover line and adverts: entered by a person each time, or generated?
12. Brand logos on article openers: keep them? If yes, is there a logo library?

**Technical**

13. Should this be built inside the existing Next.js app (admin panel) or as a separate app? The folder name suggests separate.
14. How may the generator read the news: direct database access, the existing APIs, or a new protected API?
15. Should a finished edition be published automatically to the site (S3 plus a `newsletter` row), or downloaded and uploaded by hand as today?
16. Who will use it (roles, how many people), and where will it be hosted?
17. Preferred stack, and is there a budget for paid services (AI APIs, image services)?
18. Are the original design files of the current magazine (InDesign, Canva, fonts, logo files) available? They would make matching the look much faster.
19. Deadline, and which edition should be the first one generated?
