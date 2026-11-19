# Magazine generator: user guide

For the people who make the monthly e-magazines. The last part, "Running the server", is for whoever looks after the server.

## What the app does

It turns one month of news posts from raceautoindia.com into five A4 PDF magazines: Cars, Bikes, Commercial Vehicle, Farm Equipment and Construction. Posts published in one month make the edition of the next month (March posts make the April edition).

The app never changes the website. Everything you edit here stays in the magazine.

## Signing in

Use your raceautoindia.com admin account. A session lasts 12 hours. If it ends while you have unsaved changes, the page stays as it is and tells you: sign in again in another tab, come back, and press the button again.

## Making a magazine, step by step

### 1. Generate a draft (Dashboard)

1. Choose the month of the posts.
2. Tick the editions to make. The table shows how many articles each would get.
3. Press **Generate**. It runs in the background and opens the draft when it is ready. You can leave the page; nothing is lost.

Generating again for the same month makes another draft and keeps the earlier one.

### 2. Check the articles (Articles tab)

- The list is the printed order: India first, then International, each by type.
- Move an article by dragging its handle, with the arrows, or by typing a position.
- **✕** leaves an article out. **+ Include** brings one in from the list below.
- "Send to" moves or copies a post to another edition of the same month.
- Press **Save changes**. Nothing here is saved until you do.

### 3. Add adverts (Articles tab, violet box)

- Tick the adverts for this edition and press **Add … and place them**.
- The app suggests adverts that match this edition's articles and says why.
- Each advert then appears under the article it is printed with. Drag it onto another article to move it.
- Upload and manage adverts on the **Adverts** page. Switch an advert to **Disabled** there to keep it out of every edition.

| Size | Where it is printed |
|---|---|
| Double page | In the middle of the magazine |
| Full page | The right-hand page that ends its article |
| Half page | The lower half of its article's first text page |
| Quarter page | The same lower half, beside another quarter or the article's photo |

Ask advertisers to keep the two bottom corners of their artwork clear (about 25 × 20 mm): the page number is printed there.

### 4. Foreword (Foreword tab)

Write it yourself or press the button to have Claude write one from the edition's articles. About 250 words fills the page comfortably; 350 is the most.

### 5. Cover (Cover and photos tab)

- Pick the article whose photo goes on the cover, and the headline under it.
- Choose how the photo fills the page. "Stretched with AI" is the default and is a paid request each time a new picture is painted.
- Below, decide how each post's extra images are used: logo, photo, or not at all.

### 6. Look through the pages (Design the pages tab)

This shows the magazine as it will print, two pages at a time. Turn pages with the arrows or the arrow keys.

- **Click a photo** to move it inside its frame, zoom it, or change the picture. Changes save by themselves.
- **Click a headline or paragraph** to edit the article's text. A change is kept only if the article still takes the same pages; otherwise the app says what is wrong.
- The list at the top shows every change, each with a Reset.

### 7. Create the PDF

Press **Create the PDF** in the bar at the top. It takes about half a minute and runs in the background. The **Read and download** tab then shows the magazine and the download buttons.

If the page says "things to check", read them: they name anything that did not fit or could not be loaded.

### 8. Finish

Press **Mark as finished** once the PDF is right. The edition is locked and a second copy of its PDF is kept. **Reopen** unlocks it if something must change.

Publishing is done by hand: download the PDF and the cover and upload them to the website.

## Settings

The Settings page holds the rules: how many articles an edition has, the order of sections and types, the words that sort posts into editions and types. Changes apply to drafts generated afterwards; existing drafts keep what they have.

## When something goes wrong

| What you see | What to do |
|---|---|
| "You have been signed out" | Sign in again in another tab, come back and press the button again. Your changes are still on the page. |
| A PDF or generate run "did not finish" because the server was restarted | Press the button again. |
| "A PDF is being created for this edition right now" | Wait for it to finish, then try again. |
| A text change is "Not kept" | Shorten or lengthen the text as the message says, or press Cancel. |
| A photo will not move | Read the line under the zoom control: it says which way the picture has room. Zoom in to move it further. |
| The pages on the Design tab do not appear | Press **Reload**. If it still fails, create the PDF: its message says what is wrong. |
| An advert is not offered for an edition | It is already in that edition, or it is disabled on the Adverts page. |

## Running the server

### One process only

The app must run as a single process (the PM2 file in `deploy/` does this). Background work lives in that process. If the server restarts while a PDF is being created, the run is marked as not finished and has to be started again; nothing else is lost.

### Updating

```
git pull
npm ci
npm run migrate
npm run build
pm2 restart magazine-generator
```

`npm run migrate` applies any new files in `db/migrations`; it is safe to run every time.

### Backups

`npm run backup` writes to `BACKUP_DIR` (default `./backups`; set it in `.env` to a folder on another disk):

- `db/<date-time>.sql.gz`: every table of the generator. The newest 14 are kept (`BACKUP_KEEP`).
- `files/`: the PDFs, covers, uploaded pictures, adverts and the kept copies of finished editions. Files are only added or updated there, never removed.

Run it every night, for example at 2 am with cron:

```
0 2 * * * cd /var/www/magazine-generator && /usr/bin/npm run backup >> /var/log/magazine-backup.log 2>&1
```

A backup on the same server does not survive the loss of the server. Copy the backup folder somewhere else as well.

### Restoring

1. Database: `npm run restore -- backups/db/<file>.sql.gz --yes`. This replaces the generator's tables with the backup; everything changed since is lost.
2. Files: copy `backups/files/*` back into the data folder.

To look at a backup without touching the live data, load it into another database:

```
APP_DB_NAME=magazine_restore_test npm run restore -- backups/db/<file>.sql.gz --yes
```

### What is not backed up

`data/cache` (the posts' pictures as fetched from the website). It is filled again when a PDF is created.
