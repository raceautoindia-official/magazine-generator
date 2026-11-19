# Magazine Generator: requirements decided so far

Date: 2026-11-12
Follows: [01-existing-system-analysis.md](01-existing-system-analysis.md)

## 1. Decisions (from the product owner's answers)

| # | Topic | Decision |
|---|---|---|
| 1 | Role of the tool | Generates the complete magazine; an editing step is available before finishing, but optional |
| 2 | Design | Close to the current editions; small deviations are acceptable |
| 3 | Output | PDF only, as today (the site shows the uploaded PDF in its flipbook) |
| 4 | Editions | The five current verticals: Cars, Bikes, Commercial Vehicle, Farm Equipment, Construction |
| 5 | Category mapping | Posts that are not specific to one vertical (for example general Tech) go into more than one edition. Exact mapping still open, see Q1 |
| 6 | Article selection | Automatic rules, with optional editor review |
| 7 | Period | One calendar month of posts per edition |
| 8 | Section label | Post market is not India: "International". Label for India posts still open, see Q4 |
| 9 | Photos | Only the images stored with the post |
| 10 | Text | Post text used unchanged |
| 11 | Foreword, cover, cover line, adverts | Generated. Method still open, see Q6 to Q8 |
| 12 | Brand logos | Not added by the generator from a library. From now on the logo is uploaded with the article and fetched from there. Convention still open, see Q5 |
| 13 | Architecture | Separate app, not inside the existing Next.js app |
| 14 | Data access | Whatever is most efficient. Database is on the same VPS and the same database user will be used |
| 15 | Publishing | Generator offers a download; the person uploads it through the existing admin panel as today |
| 16 | Users and hosting | One user (the person who makes the magazine by hand today). Hosted on a subdomain of the main site, on the same VPS |
| 17 | Stack and budget | Next.js and MySQL; other choices open; running cost as low as possible |
| 18 | Design assets | No source files supplied; extract fonts, colours and logo from the existing magazine PDFs where possible |
| 19 | Schedule | Each edition covers the previous month and is due by the last day of the current month |

## 2. Working assumptions (will stand unless corrected)

- Data access: direct read-only MySQL queries against `race_news` (`posts`, `post_images`, `tags`, `categories`, `market`). Faster and simpler than going through the main app's HTTP APIs on the same machine.
- PDF production: pages built as HTML/CSS and printed with headless Chromium (Puppeteer). No per-use cost; text stays real text in the PDF.
- The generator never writes to the main site's tables. Its own data (drafts, edition settings, edits) is kept separately.
- Editing step covers: add, remove and reorder articles; change which stored image is used where; edit the foreword and cover line; regenerate; download.
- Page size and footer style are copied from the current editions.

## 3. Consequences worth knowing

- **Editions get shorter, or carry more articles.** Today an article runs 4 to 8 pages because the designer adds photos. With only the stored image (usually one per post), an article of about 300 words fits on 2 pages. Eleven articles would give roughly 26 to 30 pages instead of 82.
- **Vertical cannot always be read from the category.** A post filed under "Tech > New Energy Technology" about an electric SUV has nothing in the database saying "Cars". See Q1 and Q2.

## 4. Open questions (round 2)

All answered on 2026-11-12. The answers and the resulting plan are in [03-implementation-plan.md](03-implementation-plan.md), section 2.

1. Category to edition mapping: confirm or correct the proposed table.

| Post category | Edition |
|---|---|
| Vehicles > Passenger Vehicle; New Launches > Passenger Vehicles | Cars |
| Vehicles > Two Wheeler, Three Wheeler; New Launches > Two Wheeler, Three Wheeler | Bikes |
| Vehicles > Truck, Bus and Coach, Trailer, Logistics and Fleet, Application Builders | Commercial Vehicle |
| Farm ME (all) | Farm Equipment |
| CMEQ (all) | Construction |
| Tech, Auto Comp, Business, Vehicles > Industry | Not vertical-specific: see Q2 |
| Defence, Insights, Events, Race Analytics, Classifieds, Videos, RSS News | Excluded |

2. Non-specific posts (Tech, Auto Comp, Business): into which editions exactly, and how is a vertical-specific one recognised?
3. Selection rules: how many articles per edition, and ranked by what?
4. Section label for India-market posts.
5. Logo convention: how the generator tells the logo apart from article photos.
6. Cover photo source.
7. Foreword: AI-written or template text.
8. Adverts: what "generated" means here.
9. Thin months: what to do when a vertical has very few posts.
10. Edition naming: month of the posts or month of publication.
11. Login for the generator.
12. Permission to download existing magazine PDFs for asset extraction.
13. VPS details: operating system and free memory.
