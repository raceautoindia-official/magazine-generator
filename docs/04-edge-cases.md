# Edge cases across the application

Written 13 November 2026, after phases 1 to 5 and before phase 6.

This is a list of situations the application does not handle well yet, found by reading all of the source code and by checking the real site data (the local copy of `race_news`, posts of 2026). It is the work list for phase 6. Cases fixed since it was written carry a note in bold in their row, and section 17 lists them.

## How to read it

Each case has an identifier, what the situation is, what the application does today, and what I propose. Severity means:

| Severity | Meaning |
|---|---|
| High | Wrong or missing content can end up in a magazine without anyone being told, or work or money is lost |
| Medium | Confusing, wasteful, or blocks a task, but someone would notice |
| Low | Rare, cosmetic, or only matters later |

"Seen in the data" means the situation exists in real 2026 posts. "Not in the data" means the code path is weak but no 2026 post triggers it.

## Summary

| Area | High | Medium | Low |
|---|---|---|---|
| 1. Which posts are collected | 1 | 4 | 5 |
| 2. Sorting posts into editions and types | 0 | 4 | 5 |
| 3. Generating editions | 1 | 4 | 3 |
| 4. Reviewing a draft | 2 | 6 | 5 |
| 5. Foreword | 1 | 2 | 1 |
| 6. Cover | 0 | 4 | 4 |
| 7. Photos and logos | 0 | 5 | 6 |
| 8. Article text and page layout | 2 | 4 | 5 |
| 9. Creating and downloading the PDF | 1 | 5 | 3 |
| 10. Finished editions | 1 | 2 | 1 |
| 11. Settings | 0 | 4 | 3 |
| 12. Sign-in and sessions | 0 | 3 | 4 |
| 13. Server, database and costs | 1 | 6 | 5 |
| Total | 10 | 53 | 50 |

The ten High cases are listed together in section 14, with the order I would fix them in. Section 15 lists what was checked and found to be fine. Section 16 lists the questions only you can answer.

## 1. Which posts are collected

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| POST-01 | High | A post is still marked "scheduled" long after its date. Seen in the data: 13 posts from February to May 2026, for example "Bajaj Launches Chetak C25 EV Scooter" and "Escorts Kubota Launches New Digitrac Tractors" | They are never offered to any edition, and nothing says so | Show a count of such posts on the dashboard with their headlines. Whether to include them depends on question Q1 **Fixed 13 Nov: a scheduled post whose date has passed now counts as published (answer to Q1). April 2026 went from 130 to 140 posts.** |
| POST-02 | Low | A very long post, such as a report or white paper. Corrected 13 November: the post first listed here ("India Vehicle Scrappage Policy Outlook", 176,000 characters) has only 621 words; its size comes from a picture embedded in the text, which the magazine drops. The longest 2026 post is 957 words, so this is not in the data | Before the fix it would have been included like any other post and filled many pages | **Fixed 13 Nov.** Settings has a maximum word count (default 2,500). Longer posts are offered in the "not included" list with a note and only go in when included by hand |
| POST-03 | Medium | A post is in a category no edition uses (Events, Insights, Defence, Videos, Policy when not matched, and so on) | It is counted as "unused" on the dashboard and cannot be added to an edition at all | Add "add a post by hand" on the edition page: search the month's posts by headline and include any of them |
| POST-04 | Medium | A post is shorter than the minimum word count (80) | It is not offered and does not appear in the "not included" list either, so it cannot be included by hand | Offer it in the "not included" list, marked "short" |
| POST-05 | Medium | The month is decided by the post's creation date. A post written in one month and published or heavily updated in the next stays with the first month. Seen in the data: 5 posts of 2026 were updated in a later month | The post goes to the earlier edition, or is missed if that edition was already made | Show, on the dashboard, posts of the previous month created or changed after that month's editions were generated **Decided 13 Nov (Q2): the month of publication. The site stores one date per post, which for a scheduled post is its scheduled date, so the rule already follows publication. No change.** |
| POST-06 | Medium | An edition is generated for the current month, which is not over | Allowed with no warning; the edition silently misses the rest of the month | Warn before generating for a month that has not ended |
| POST-07 | Low | The server's clock zone differs from the zone the site stores dates in | A post created in the first hours of a month could be put in the neighbouring month. Not in the data: no 2026 post was created in the first six hours of a month | Record the zone the site uses and compare months in that zone |
| POST-08 | Low | The same story is posted twice | Both are included. Not in the data: no duplicate headlines within a month in 2026 | Warn when two included posts have nearly the same headline |
| POST-09 | Low | A month has no posts at all for an edition | An empty draft is created with a warning; it shows in the list until deleted | Refuse to create an edition with no posts and say why |
| POST-10 | Low | A post has no market set | It would be printed under International. Not in the data: every 2026 post has a market | Warn on such posts and let the reviewer pick the section |

## 2. Sorting posts into editions and types

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| SORT-01 | Medium | An edition keyword is also an ordinary word or part of a name: "van" in "Van Der Mierden", "cv", "coach", "edition", "bus" in a company name | The post is placed by that word and Claude is not asked, because Claude only places posts that matched no word | Let Claude confirm every shared-category placement, not only the unmatched ones (same reasoning as for types) |
| SORT-02 | Medium | Claude placed a shared post, or said it fits no edition, and Settings change afterwards (new edition, new keywords) | The stored answer is reused for ever. Type answers are re-asked when the type list changes; placement answers are not | Tie stored placements to the list of editions, as is done for types |
| SORT-03 | Medium | Claude's answer leaves out a post, or names an edition or type that does not exist | That post is asked about again at every Generate, at a small cost each time, and nothing reports it | After two tries, store "no answer" and show the post with a note |
| SORT-04 | Medium | The text of a post contains instructions aimed at an AI (for example in a pasted press release) | The text is sent to Claude as it is; it could push a type, a placement or the foreword off course | Mark article text clearly as quoted material in every request, and keep the human review of the foreword |
| SORT-05 | Low | Generating a single edition | Claude still reads every eligible post of the month, for all five editions. The answers are reused later, so nothing is wasted over the month | Keep, but say so on the dashboard |
| SORT-06 | Low | A type is removed in Settings while drafts still use it | The draft shows "(removed)" and cannot be saved until another type is chosen | Keep; add a count of affected drafts when saving Settings |
| SORT-07 | Low | The same post is in two editions and its type is changed by hand in one | The other edition keeps the old type | Keep; this is by design |
| SORT-08 | Low | A category belongs to two editions in Settings | The post goes to both, as "category" | Warn when saving Settings |
| SORT-09 | Low | The recommended count cuts posts: more specific posts than 20 | The most-read ones are kept, so a launch can lose its place to a popular "other" article | Prefer the type order when cutting, then readership |

## 3. Generating editions

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| GEN-01 | High | Generate takes longer than the web server waits (300 seconds), for example when Claude is slow and retries | The browser shows an error, but the work continues on the server and the drafts are saved. Pressing Generate again creates them a second time and pays Claude again for unanswered posts | Run generation as a background job with a progress line, and refuse a second run for the same month and edition while one is running |
| GEN-02 | Medium | Generate is pressed for an edition and month that already has a draft, or a finished edition | A second draft is created with no warning. "Move to another edition" then uses the newest one, which may not be the one meant | Ask "a draft already exists: open it, replace it, or make another?" **Decided 13 Nov (Q6): keep both drafts. Still open: say that a draft already exists.** |
| GEN-03 | Medium | Several editions are ticked and one fails part-way | The earlier ones are saved, the page shows a general error and does not say which were made | Report per edition: made, or failed and why |
| GEN-04 | Medium | Two people press Generate at the same moment, or the button is pressed in two tabs | Two sets of drafts | Covered by the lock in GEN-01 |
| GEN-05 | Medium | Claude is unavailable or the key is wrong | Generation still works with keyword types and general placement, and the edition carries a warning. The dashboard preview gives no hint beforehand | Show the state of the AI keys on the dashboard and Settings pages |
| GEN-06 | Low | The dashboard preview is opened before Claude has read the month | Counts and types in the preview differ from what Generate then saves | Already explained in the page text; keep |
| GEN-07 | Low | The edition list on the dashboard | Shows the newest 100 editions only; older ones are reachable only by address | Add a month filter and paging |
| GEN-08 | Low | A future month | Refused | Fine as it is |

## 4. Reviewing a draft

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| REV-01 | High | The article list has unsaved changes and "Create the PDF", "Use this cover" or "Mark as finished" is pressed | The PDF is made from the last saved state. The page then says the PDF is up to date, so the edition can be finished without the changes | Block these buttons while there are unsaved changes, with the message "save or undo your changes first" **Fixed 13 Nov: Create the PDF, both cover buttons and Mark as finished are disabled while the list has unsaved changes, with a message.** |
| REV-02 | High | The browser tab is closed, reloaded or the session expires (after 12 hours) with unsaved changes | All unsaved changes are lost without a question. After expiry, pressing Save sends the person to the login page and the changes are gone | Ask before leaving the page with unsaved changes; keep the unsaved state in the browser so it survives a sign-in **Partly fixed 13 Nov: the browser now asks before the page is closed or reloaded with unsaved changes. Changes are still lost if the session expires before Save.** |
| REV-03 | Medium | Two people edit the same draft | If only the order differs, the last save wins silently. If one of them moved a post away, the other gets "changed somewhere else" and must reload, losing their changes | Show who last saved and when; on conflict, offer to reapply the changes **Decided 13 Nov (Q7): one person per edition is the normal case, so this stays as it is.** |
| REV-04 | Medium | A post is deleted on the main site after the draft was generated | It stays in the list in red, still counts as included, and is silently left out of the PDF | Count it as not included, and add a warning naming it |
| REV-05 | Medium | A post's headline or text is changed on the main site after generation | The edition page and the next PDF show the new text with no notice. The foreword may now disagree with the article | Remember each post's last-changed time at generation and flag posts changed since |
| REV-06 | Medium | "Move to" another edition when that edition has several drafts, or only a finished one | It goes to the newest draft; with only a finished edition the message says there is no draft, which is misleading | Let the reviewer choose the target draft; say "that edition is finished" when it is |
| REV-07 | Medium | A post moved away by mistake | It is gone from this draft; the only way back is to copy it from the other edition | Keep moved posts in the "not included" list, marked "moved to Bikes" |
| REV-08 | Medium | More posts are included than the maximum (30) | Only a warning. The contents pages hold up to 40 articles; above that, entries are cut off at the bottom of the page | Refuse to save above 40, or add a third contents page |
| REV-09 | Low | Reordering 20 to 30 articles | Up, Down and First buttons only | Add drag and drop, or a "move to position" box |
| REV-10 | Low | An article's section is changed by hand | The printed label changes; the post is not moved near the other articles of that section | Offer "put in standard order" right after the change |
| REV-11 | Low | A draft is deleted | Its PDF, cover image and page file stay on the disk | Delete the edition's folder with the draft |
| REV-12 | Low | A draft is deleted while its PDF is being created | The files are written to a folder nobody refers to | Covered by REV-11 plus a check after the render |
| REV-13 | Low | Extra-image previews on the review page | Loaded straight from the site's public storage; if that address changes they show as broken | Serve previews through the application |

## 5. Foreword

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| FORE-01 | High | A long foreword. Up to 6,000 characters (about 1,000 words) can be saved, but the page holds roughly 350 words | The text is shrunk to 8 pt and whatever still does not fit is cut off at the bottom, with no warning | Report "the foreword does not fit" as a PDF warning; limit by words, shown live next to the box **Partly fixed 13 Nov: a foreword that does not fit is now reported as a PDF warning. A live word limit next to the box is still open.** |
| FORE-02 | Medium | Articles are added, removed or reordered after the foreword was written | The foreword stays as it was and may describe articles that are no longer in the edition | Flag the foreword as "written before the last change to the articles" |
| FORE-03 | Medium | Claude writes a figure or name that is not in the articles | Nothing checks it; the page only reminds the person to read it | After writing, list the numbers and company names in the foreword that do not appear in any article |
| FORE-04 | Low | "Write again with Claude" replaces a foreword that was edited by hand | The hand-edited text is overwritten at once | Ask before replacing text that was changed by hand |

## 6. Cover

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| COV-01 | Medium | No included article has a usable photo | The cover is a plain dark page with the titles. The agreed requirement was an AI-generated image in this case; that is not built. Not in the data: every 2026 post has a photo | Generate a cover image with OpenAI when no photo is usable, on request |
| COV-02 | Medium | "Extend the photo with AI" is pressed again, or after going back to the automatic cover | Every press is a new paid request, even when an extended version of that photo already exists | Reuse the existing extended image; add a separate "generate a new version" button |
| COV-03 | Medium | The AI extension plus the reprint takes longer than the web server waits | The browser shows an error although OpenAI was charged and the result was saved | Run it as a background job (see GEN-01) |
| COV-04 | Medium | The automatic crop is poorly placed | There is no way to move it; the only choices are another photo or the AI extension | Add a simple "move the crop left or right, up or down" control |
| COV-05 | Low | The cover is already a full-page crop | The AI extension button is still offered, which pays for nothing useful | Hide it in that case |
| COV-06 | Low | A very long cover headline (up to 255 characters, or a 105-character article headline) | It wraps over several lines and climbs up over the photo | Shrink the text to at most three lines |
| COV-07 | Low | The article whose photo was picked for the cover is later left out | The cover silently goes back to the automatic choice | Say so in a warning |
| COV-08 | Low | The same photo is the cover of two editions, and one of them is AI-extended | Both share the one extended image; replacing it in one changes the other at its next PDF | Keep one extended image per edition |

## 7. Photos and logos

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| IMG-01 | Medium | The site's image storage is slow or briefly down while a PDF is created | Each photo waits up to 30 seconds, then the article is printed without a photo. The PDF gets a warning per photo, but is otherwise "created" | Stop and say "photos could not be loaded, try again" when more than a few fail |
| IMG-02 | Medium | Claude judged a photo wrongly (subject position, logo or photo, fit for a cover) | The answer is stored for ever. Logo or photo can be overruled; the subject position cannot | Add "look at this photo again" and a manual focus point |
| IMG-03 | Medium | An image is replaced on the site under the same file name | The old copy on the generator's disk is used for ever | Check the stored file's date or size before reuse |
| IMG-04 | Medium | A logo that is white or very light on a transparent background | It is placed on a white plate and becomes invisible. Logo handling has never run on a real logo: 35 posts of 2026 have extra images, none tested as logos | Choose a dark plate for light logos; test with real logos |
| IMG-05 | Medium | Stored photos carry the site's watermark in the bottom-left corner | It is printed in the magazine, enlarged on spreads | Ask whether originals without watermark exist (question Q4) **Decided 13 Nov (Q4): no originals without the watermark exist, so it stays in the magazine.** **Changed 13 Nov: the mark is now removed from the cover photo (see the plan, section 19). Photos inside the magazine still carry it.** |
| IMG-06 | Low | A small photo (under 1,200 pixels wide) | Printed across two pages and looks soft; a warning is added | Use the one-page layout for small photos |
| IMG-07 | Low | A portrait-shaped photo | A wide slice is cut out of it for the spread, which can lose most of the subject | Use the one-page layout for portrait photos |
| IMG-08 | Low | A photo on a plain white studio background | White edges up to 12% are trimmed as if they were a border | Skip trimming when all four edges are white |
| IMG-09 | Low | A post has several extra photos or several logos | Only the first photo and the first logo are used | Let the reviewer choose |
| IMG-10 | Low | Unusual image formats. Seen in the data: 2 `.jfif`, 1 `.avif`, 1 `.webp` in 2026 | Expected to work, but not tested on the server's image library | Test these four files on the server |
| IMG-11 | Low | The photo cache | Grows without limit: about 0.5 MB per photo, so roughly 0.5 GB per year | Remove cached files not used for six months |

## 8. Article text and page layout

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| TXT-01 | High | A single paragraph is longer than a whole page (for example an article pasted as one block) | The rest of that paragraph is cut off at the bottom of the page, with no warning | Split such a paragraph at sentence ends; add a warning whenever any text is cut **Fixed 13 Nov: such a paragraph is split at a sentence end and continues on the next page. One that cannot be split (it contains bold or italic text, or is one sentence) is reported by TXT-02.** |
| TXT-02 | High | Text is cut anywhere on a page | The layout script does not report it; the PDF is marked as created | Measure every text box after layout and list any overflow as a PDF warning **Fixed 13 Nov: after layout, an article, the foreword or the contents pages that still overflow are listed as PDF warnings on the edition.** |
| TXT-03 | Medium | Bulleted or numbered lists in an article. Seen in the data: 12 posts of 2026 | Each item becomes an ordinary paragraph; the bullets and numbers are lost | Keep lists as lists |
| TXT-04 | Medium | Sub-headings written as heading tags | They become ordinary paragraphs. Not in the data: no 2026 post uses heading tags; bold one-line paragraphs are already treated as sub-headings | Treat heading tags as sub-headings |
| TXT-05 | Medium | A very long article (over about 2,000 words). Seen in the data: 2 posts besides POST-02 | It runs over several text pages; this path has only been tested once | Test with these two posts; add a page limit per article **Fixed 13 Nov: testing this found a crash for any article needing three or more text pages; fixed and tested with 2,600 and 3,500-word articles.** |
| TXT-06 | Medium | Characters outside Latin script: Hindi, Tamil, Chinese, emoji | The magazine font does not contain them, so they depend on fonts installed on the server and may print as empty boxes. Not in the data: no 2026 post has any | Install fallback fonts on the server and add a warning for such text |
| TXT-07 | Low | Tables in an article | Cells are run together into paragraphs. Not in the data | Print simple tables as tables |
| TXT-08 | Low | Pictures inside the article text. Seen in the data: 1 post | Dropped | Keep; say so in the user guide |
| TXT-09 | Low | Links in the text. Seen in the data: 732 posts | The words stay, the address is dropped | Keep; this suits print |
| TXT-10 | Low | An article with no text (emptied on the site after generation) | Printed as a photo spread with an empty text column, with a warning | Leave it out and warn |
| TXT-11 | Low | Fewer than four articles | The second contents page is nearly empty | Use one contents page for small editions |

## 9. Creating and downloading the PDF

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| PDF-01 | High | Creating the PDF fails part-way (disk full, browser crash, server restart) | The new file is written over the old one as it goes, so a broken half-file is left. If the old PDF was up to date, the page still says so and the edition can be finished with a broken file | Write to a temporary file and swap it in only on success **Fixed 13 Nov: the PDF and cover are written to temporary files and swapped in only when complete.** |
| PDF-02 | Medium | Someone downloads the PDF while it is being created again | They can receive a half-written file | Covered by PDF-01 **Fixed 13 Nov with PDF-01.** |
| PDF-03 | Medium | Two people create PDFs at once | The second waits for the first; with a long first run the second can pass the web server's 300-second wait and show an error although it will finish | Background job with a progress line (see GEN-01) |
| PDF-04 | Medium | The server is short of memory. The headless browser needs several hundred megabytes while it runs, on the machine that also serves the main site | Not measured | Measure on the server; limit to one run at a time (already so) and set a memory cap |
| PDF-05 | Medium | The stored file locations are full paths on the disk | Moving the application or its data folder, or restoring a backup elsewhere, makes every existing PDF "not found" | Store locations relative to the data folder |
| PDF-06 | Medium | The message when PDF creation fails | "The server log has the details", whatever the cause | Say what failed: no articles, photos unreachable, browser missing, disk full |
| PDF-07 | Low | The downloaded file name | `magazine-23.pdf`, which says nothing about edition or month | Name it for example `race-auto-india-cars-2026-09.pdf` |
| PDF-08 | Low | Settings that affect pages are changed (section labels, advert headline) | Existing PDFs are not marked out of date | Mark drafts' PDFs out of date when such settings change |
| PDF-09 | Low | A browser without a built-in PDF viewer (some phones) | The preview frame is blank; the download links still work | Show the cover image and the links instead |

## 10. Finished editions

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| FIN-01 | High | The PDF of a finished edition is lost from the disk (no backup exists yet) | The edition is locked and its file cannot be served; it must be reopened and recreated, and by then the posts may have changed | Backups (phase 6), and keep a copy of each article's text when an edition is finished |
| FIN-02 | Medium | A finished edition's article list on screen | Read live from the site, so it can show headlines that differ from the frozen PDF | Show the saved copy for finished editions |
| FIN-03 | Medium | Who finished or reopened an edition, and when | Not recorded; only the creator is | Record the person and time of each status change |
| FIN-04 | Low | A finished edition is reopened and finished again without changes | Allowed | Fine as it is |

## 11. Settings

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| SET-01 | Medium | Most rules are edited as raw text (JSON) | A wrong category number or a misspelt key is accepted if the shape is valid; the effect shows only at the next Generate | Check category and market numbers against the site when saving; add forms for keywords and types |
| SET-02 | Medium | An edition's key is renamed or an edition is removed | Existing editions of it show the raw key as their name, lose their page colours and advert photo, and cannot be a "move to" target | Refuse to rename or remove a key that editions use |
| SET-03 | Medium | A bad save | Every save is kept as a version, but there is no screen to see or restore an earlier one | Add a version list with "restore" |
| SET-04 | Medium | The AI model names are free text | A mistyped or retired model makes every AI step fail quietly into its fallback, with only a warning on the edition | Test the model name when saving |
| SET-05 | Low | Two people save Settings at once | The last save wins | Warn when the settings changed since the page was opened |
| SET-06 | Low | A type's description is edited | All posts are read again by Claude at the next Generate, for every month generated afterwards | Say so next to the field |
| SET-07 | Low | The India market number is wrong | Everything is printed as International | Show the market's name next to the number |

## 12. Sign-in and sessions

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| AUTH-01 | Medium | Someone types a wrong password five times for another person's email | That person is locked out for 15 minutes, and this can be repeated | Limit by network address as well, and lengthen the wait gradually instead of a hard lock |
| AUTH-02 | Medium | The session ends (12 hours) while a long action is pending or a form is half filled | The next action goes to the login page; see REV-02 for the lost changes | Warn shortly before expiry; return to the same page after sign-in |
| AUTH-03 | Medium | Sign-out | Removes the cookie from this browser only; a copied session stays valid until it expires. Disabling the account on the main site does stop it at the next request | Keep a session list on the server so sign-out ends it everywhere |
| AUTH-04 | Low | The application restarts | Failed-attempt counts are forgotten | Acceptable for a handful of users |
| AUTH-05 | Low | A signed-in person opens the login page | The login form is shown again | Send them to the dashboard |
| AUTH-06 | Low | A file link is opened without a session | The person lands on the login page instead of getting a clear "sign in first" for the file | Fine as it is |
| AUTH-07 | Low | The site is reached over plain HTTP in production | The session cookie is not accepted and sign-in loops | Force HTTPS in the web server (already in the deployment notes) |

## 13. Server, database and costs

| ID | Severity | Situation | Today | Proposed |
|---|---|---|---|---|
| OPS-01 | High | There are no backups of the generator's database or of the PDFs | A disk failure loses every edition | Phase 6: nightly database dump and copy of the editions folder |
| OPS-02 | Medium | A migration file with several changes fails half-way | The first changes stay, the file is not recorded as applied, and running it again fails on the part already done | One change per file from now on; make the existing ones safe to repeat |
| OPS-03 | Medium | The main database is unreachable | Every page shows the general error screen | Say "the site database cannot be reached" on that screen |
| OPS-04 | Medium | The database user cannot create a new database on the server | The migration stops with an instruction to use the site's own database instead | Decide before deployment (question Q5) **Decided 13 Nov (Q5): a separate database, as on the local machine. The database user needs the right to create it.** |
| OPS-05 | Medium | The production build | Never run; only the development server has been used | Phase 6: build and run the built application before deployment |
| OPS-06 | Medium | AI costs | No total is shown anywhere. Each foreword rewrite, each new photo and each cover extension is a paid request | Keep a count of requests per month and show it in Settings |
| OPS-07 | Medium | The disk fills up | PDF creation fails with the general message | Check free space before a render; show it in Settings |
| OPS-08 | Low | Error screens inside the application | One general screen for everything | Add specific screens for "edition not found" and "no access" |
| OPS-09 | Low | The application is run as more than one process | The PDF queue and the login limiter assume one process | Already fixed to one in the process file; keep |
| OPS-10 | Low | Times shown ("Generated 2026-11-13 11:59") | In the database server's zone, unlabelled | Label the zone |
| OPS-11 | Low | Old drafts | Never cleaned up | Offer "delete drafts older than three months" |
| OPS-12 | Low | The Chromium browser's system libraries on the server | Not installed yet; PDF creation will fail until they are | Listed in the deployment steps |

## 14. The High cases, in the order I would fix them

1. **REV-01** unsaved changes left out of the PDF and of a finished edition.
2. **TXT-02 and TXT-01** text cut off on a page without a warning, and **FORE-01** the same for the foreword. One measuring step after layout covers all three.
3. **PDF-01** a failed PDF run leaves a broken file that still looks valid.
4. **REV-02** unsaved changes lost on leaving the page or on session expiry.
5. **POST-02** a maximum length in Settings (now Low: the post that prompted it turned out to be of normal length).
6. **GEN-01** long requests cut by the web server, causing duplicates and double payment. Background jobs also solve COV-03 and PDF-03.
7. **POST-01** the 13 posts stuck as "scheduled", once question Q1 is answered.
8. **OPS-01 and FIN-01** backups, and a saved copy of the text of finished editions.

## 15. Checked and found to be fine

- Every 2026 post has a market, a category and a main photo.
- Every stored image path in the database has the form the generator accepts; none is rejected.
- No 2026 headline contains HTML codes, so headlines are not double-escaped. The longest headline is 105 characters and takes three lines on an opening page.
- No 2026 post uses tables, heading tags, quotes or embedded frames. No 2026 post contains non-Latin script.
- The contents pages hold 20, 26, 30 and 40 articles without cutting any entry (measured on a real edition's pages); the picture area shrinks to make room.
- Article spreads always start on a left-hand page: five front pages, an even number of pages per article, one back page.
- A December edition is labelled January of the next year, and the copyright year follows.
- The main site's database is only ever read: any statement that is not a single SELECT is refused before it is sent.
- PDF and cover files are served only from the edition's own folder and only to a signed-in person whose account is still active and still has the magazine permission.
- While a PDF is being printed, the page cannot load anything from the internet.
- A post's HTML is reduced to plain paragraphs with bold, italic, superscript and subscript only; scripts, styles, links and attributes are removed.
- Without an AI key, or when an AI request fails, every step falls back: keyword types, general placement, centred crops, automatic foreword.
- Finished PDFs are 3 to 6 MB each.

## 16. Questions for the owner

Answered on 13 November 2026:

| ID | Answer | Effect |
|---|---|---|
| Q1 | A scheduled post whose scheduled date has passed is published | POST-01 fixed |
| Q2 | A post belongs to the month it was published | POST-05: no change needed |
| Q3 | Whatever suits the magazine layout | Maximum set to 2,500 words, editable in Settings (POST-02) |
| Q4 | No originals without the watermark | IMG-05 stays |
| Q5 | A separate database, as locally | OPS-04 |
| Q6 | Keep both drafts | GEN-02 |
| Q7 | Most likely only one person per edition | REV-03 stays |

The questions as asked:

| ID | Question | Why it matters |
|---|---|---|
| Q1 | Are the 13 posts still marked "scheduled" (February to May 2026) visible on the website? | If they are, the generator's rule for "published" is wrong and it is missing posts every month. If not, they are simply stuck and the editors may want to release them |
| Q2 | Should a post belong to the month it was created, or the month it was published or last updated? | Decides POST-05 |
| Q3 | Should the long policy report (POST-02) ever be in a magazine, and what is the longest article you want printed? | Sets the maximum length |
| Q4 | Do the original photos exist without the website watermark? | Decides IMG-05 |
| Q5 | On the server, may the database user create a separate `magazine_generator` database, or should the generator's tables live inside `race_news`? | Needed for deployment |
| Q6 | When an edition already has a draft, should Generate replace it, or keep both? | Decides GEN-02 |
| Q7 | Is more than one person going to work on the same edition at the same time? | Decides how much of REV-03 is worth building |

## 17. Fixed on 13 November 2026

Done after the answers above and tested (real posts for the data rules, synthetic 2,600 and 3,500-word articles for the layout, and the browser test for the review page):

- POST-01, POST-02, REV-01, TXT-01, TXT-02, TXT-05, PDF-01, PDF-02: fixed.
- REV-02, FORE-01: partly fixed; what remains is noted in their rows.

High cases still open: GEN-01 (long requests cut by the web server), OPS-01 and FIN-01 (backups, and a saved copy of finished editions), the rest of REV-02 (session expiry) and of FORE-01 (live word limit). These belong to phase 6.

## 18. Usability: where the screens made the person do the thinking (13 November 2026)

The owner pointed out that "edge cases" also means difficulties in using the screens: the PDF could not be read like a magazine, a chosen cover photo did not show until much later, and reordering was clumsy. The screens were gone through from the point of view of someone making a magazine, and rebuilt. Status is "Done" when it was built and checked in the browser test.

### Edition page

| ID | Difficulty | Now | Status |
|---|---|---|---|
| UX-01 | The page was one long scroll: foreword, an 80%-height PDF frame, the cover, extra images, and only then the article list, which is where the work starts | Four tabs: Articles, Foreword, Cover and photos, Read and download. Every tab stays loaded, so switching loses nothing. The open tab is kept in the address | Done |
| UX-02 | Nothing said what to do next; the person had to know the order of steps | A bar at the top always states the next step in one sentence (save your changes, create the PDF, PDF out of date, ready to finish) and holds the three main buttons. It stays in view while scrolling | Done |
| UX-03 | The PDF was shown one page under another in the browser's PDF frame, so a two-page spread could not be seen as a spread | A magazine reader: the cover alone, then two facing pages at a time. Turn pages with the side arrows, by clicking a page, or with the arrow keys; a slider and a "Go to" list of the articles jump through it; it can fill the whole screen | Done |
| UX-04 | Choosing a cover photo was a drop-down of headlines; the photo could not be seen before waiting a minute for the PDF | A grid of the articles' photos. Clicking one shows it large at once, marked "Not on the cover yet", and "Put this on the cover" applies it. The photo currently on the cover is labelled | Done |
| UX-05 | After the cover was changed, the cover picture on the page could stay the old one | The picture is reloaded after every change, and the page names the article the photo comes from. Checked by comparing the cover file before and after | Done |
| UX-06 | The cover could only be chosen after the first PDF existed | The chooser works before the first PDF too | Done |
| UX-07 | Reordering: text buttons "Up", "Down", "First" in a cramped table | Drag an article by its handle; arrow buttons with a tooltip that says what each does; or type a position number and press Enter. A blue line shows where a dragged article will land | Done |
| UX-08 | Articles were rows of text; it was hard to recognise them | Each article shows its photo, and the list shows the section label (NATIONAL NEWS, INTERNATIONAL NEWS) where a section starts | Done |
| UX-09 | "Save changes" was at the top of a long list and easy to miss | A bar that stays at the bottom of the screen whenever there are unsaved changes, with Save and Undo | Done |
| UX-10 | Warnings and background notes were mixed in one list | Warnings are shown as "things to check"; notes about how the edition was put together are folded away | Done |
| UX-11 | The foreword box gave no idea how much text fits | A live word count that says "a good length", "will be printed smaller" or "too long, the end would be cut off"; Save is only active when something changed; writing again with Claude asks before replacing the text | Done |
| UX-12 | Buttons gave no reason when they were unavailable | Every disabled button says why on hover | Done |
| UX-13 | Downloaded files were called magazine-23.pdf | Named for the edition and month, for example race-auto-india-cars-2026-09.pdf | Done |
| UX-14 | Deleting a draft left its files behind | The draft's PDF, cover and page pictures are deleted with it | Done |

### Dashboard

| ID | Difficulty | Now | Status |
|---|---|---|---|
| UX-15 | A month box and a separate "Show" button | Choosing a month shows it at once; arrows step to the month before and after | Done |
| UX-16 | The table used internal terms ("By category", "By words or Claude", "Would include") | Plain columns: Articles, India / International, "Enough for a magazine?" with a coloured answer, and "Already made" with links to the month's drafts. The breakdown is a tooltip | Done |
| UX-17 | Generate could be pressed with nothing ticked, and gave no idea of the wait | Disabled until an edition is ticked; the button says what it will do ("Generate 2 editions for September 2026"); a line explains the wait. An edition with no posts cannot be ticked | Done |
| UX-18 | Generating an edition that already existed gave no warning | A question first: make another draft as well? The existing one is kept (owner's decision Q6) | Done |
| UX-19 | The current, unfinished month could be generated with no warning | A notice that the month is not over | Done |
| UX-20 | Editions were a plain table | Cards with the cover picture, status and what needs attention; the chosen month's editions first | Done |

### Settings

| ID | Difficulty | Now | Status |
|---|---|---|---|
| UX-21 | Almost everything was edited as raw text | Forms for each edition (name, cover line, report advert, keywords) and each article type (name, meaning, headline words). The raw text is still there under "Advanced" for category numbers and AI models | Done |
| UX-22 | Order lists had "Up" and "Down" text buttons | Arrow buttons with tooltips, including "to the top" | Done |
| UX-23 | It was easy to leave without saving | A bar at the bottom shows "changes not saved", Save and Undo; the browser asks before leaving | Done |

### Still open

| ID | Difficulty | Proposed |
|---|---|---|
| UX-24 | Drag and drop does not work on touch screens (tablets, phones); the arrows and the position box do | Add touch dragging if the app is used on tablets |
| UX-25 | Long actions (Generate, Create the PDF) show a sentence, not real progress | Progress steps, with the background jobs of GEN-01 |
| UX-26 | The cover crop cannot be moved by hand (COV-04) | A "move the photo" control on the cover tab |
| UX-27 | There is no way to add a post the selection did not offer (POST-03) | A search box on the Articles tab |
| UX-28 | Category numbers in Settings are still numbers | Pick categories by name from the site's list |
| UX-29 | The screens are built for a desktop browser; on a phone the article rows are cramped | Decide whether phones matter |

## 19. Adverts (added 16 November 2026)

| ID | Case | What happens | Status |
|---|---|---|---|
| AD-01 | Picture is not the shape of the booked size | Shown before upload; cropped or bordered as chosen, with what is lost stated | Handled |
| AD-02 | Picture too small to print sharply | Warned before and after upload, not refused | Handled |
| AD-03 | File is not a picture, or over 30 MB | Refused with what to do instead | Handled |
| AD-04 | No Claude key, or Claude fails at upload | Advert is stored without a description; a note says to write one or ask again | Handled |
| AD-05 | Advert relates to no article | Placed near the middle with an article that has no advert; the reason says so | Handled |
| AD-06 | Closest article is about a competitor | Still chosen; amber warning on the row | Handled |
| AD-07 | The advert's article is left out, moved to another edition or deleted | Advert placed again on save and before a PDF; reason says why | Handled |
| AD-08 | Edition has no articles | Advert cannot be added; one already there is kept without a place and not printed | Handled |
| AD-09 | Advert moved onto an article that is included but not saved yet | Refused: save the article list first | Handled |
| AD-10 | Same advert added twice to an edition | Refused | Handled |
| AD-11 | Advert used in an edition is deleted from the library | Not possible; it can only be retired, which keeps existing placements | Handled |
| AD-12 | Advert's picture missing on the server at PDF time | Skipped with a warning on the edition | Handled |
| AD-13 | Shape of a placed advert changed in the library | Drafts that print it are marked "PDF out of date" | Handled |
| AD-14 | Two unrelated adverts | Spread over different articles near the middle | Handled |
| AD-15 | Several full pages on one article | Printed one after another; the run ends on a right-hand page | Handled |
| AD-16 | Finished edition | Adverts are listed with their reasons and cannot be changed until it is reopened | Handled |
| AD-17 | Draft deleted | Its placements go with it; the adverts stay in the library | Handled |
| AD-18 | Advert files are not in any backup | Same as OPS-01: `data/adverts` must be included in the backup of `data/` | Open (Phase 6) |
| AD-19 | Upload through the web server in production | nginx must allow 32 MB request bodies; `deploy/nginx.conf.example` sets `client_max_body_size 32m` | Handled in the example; check on the server |
| AD-20 | Many adverts in one edition | Each added advert is one more page or two; no limit is enforced and no warning is given | Open |
| AD-21 | Half or quarter page on a short article | The article takes the long layout (four pages) so it has a text page for the advert | Handled |
| AD-22 | More small adverts than an article's text page holds | Automatic placement uses the next related article with room; by hand it is refused with the reason | Handled |
| AD-23 | A single quarter page | The article's photo fills the other quarter; a headline panel when the picture is a logo or graphic | Handled |
| AD-24 | Half page on a very short article (about 150 words) | White space between the text and the footer | Open (cosmetic) |
| AD-25 | The page number covers part of an advert | The number is printed in the outer bottom corner of every page; advertisers are asked to keep both bottom corners clear (about 25 × 20 mm) | Accepted by the owner |
| AD-26 | A few lines of text spill on to a page of their own | Text set at the largest size that fits its pages; a paragraph may continue overleaf; the article's picture fills a last page left more than a third empty | Handled |
| AD-27 | An advert is disabled while an edition already prints it | That edition keeps it; the library row says so and links to the edition. It is only left out of new choices | Handled |

## 20. Design tab (added 18 November 2026)

| ID | Case | What happens | Status |
|---|---|---|---|
| DES-01 | Text change would add or remove pages, or cut text off | Refused with the reason; nothing is saved | Handled |
| DES-02 | The post changes on the website after its text was edited here | The edition keeps the edited version; the changes list and the editor say so; Reset takes the website's version | Handled |
| DES-03 | Text edited back to exactly the original | Stored as "not changed"; the article follows the website again | Handled |
| DES-04 | Picture dragged or zoomed out past its edge | Stops at the edge; a frame is never partly empty | Handled |
| DES-05 | A picture chosen for a frame is later missing (upload deleted, post image removed) | The automatic picture is used, with a note on the edition | Handled |
| DES-06 | Article list has unsaved changes | Editing on the Design tab waits until they are saved | Handled |
| DES-07 | Finished edition | Pages are shown, nothing can be changed | Handled |
| DES-08 | AI cover not painted yet | The Design tab shows the whole photo on its blurred copy; the cover is painted when the PDF is created | Handled |
| DES-09 | Article with edits is left out of the edition, then included again | Its edits are kept | Handled |
| DES-10 | Article with edits is moved to another edition | Its text edit goes with the row that is deleted; picture changes stay behind unused | Accepted |
| DES-11 | Pasted text with fonts, colours, links | Comes in as plain text; the server keeps only bold, italic, superscript, subscript | Handled |
| DES-12 | Two people edit the same edition at once | The last save wins, per frame or per article | Open (Phase 6) |
| DES-13 | Uploaded pictures and edits are not in any backup | Same as OPS-01: `data/editions/<id>/uploads` and the three new tables | Open (Phase 6) |
| DES-14 | Very large edition | The tab loads every picture of the magazine at once | Open |

## 21. Closed by Phase 6 (19 November 2026)

| ID | What was done |
|---|---|
| GEN-01, COV-03, PDF-03 | Generating, creating the PDF and cover changes run as background jobs; a second press joins the first; a reload picks the run up |
| OPS-01, AD-18, DES-13 | `npm run backup` and `npm run restore`; verified by restoring into a scratch database |
| FIN-01 | A finished edition keeps a second copy of its PDF, cover and page file, served when the working file is lost |
| REV-02 | An ended session no longer loses unsaved articles, foreword, article text or settings: the page stays and says to sign in again |
| OPS (new) | The production build is checked: it builds without warnings and serves every route |

Still open after Phase 6: DES-12 (two people editing one edition at once), DES-14 (a very large edition on the Design tab), AD-20 (no limit on adverts per edition), AD-24 (white space above a half page on a very short article), COV-01 (no AI-generated cover when no article has a usable photo), and copying backups off the server.
