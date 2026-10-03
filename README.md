# Circle-Hand → Vinted: local inventory MVP

A local Node.js and Playwright tool for reading your Circle-Hand consignment inventory, saving original photos and listing details, and preparing manual Vinted listings.

## Setup

Requires Node.js 20+ and a Linux desktop for the photo-folder button.

```bash
npm ci
npx playwright install chromium
cp circlehand.config.example.json circlehand.config.json
```

Edit `circlehand.config.json` and set `dashboardUrl` to your Circle-Hand dashboard URL, including `?perPage=100&page=1`. This local config is excluded from Git. Then run:

```bash
npm run sync
```

Alternatively, set `CIRCLEHAND_URL` to the full dashboard URL; it overrides the local config.

Chromium opens visibly. Sign in manually, wait for your inventory dashboard, then press Enter in the terminal. Future runs reuse the local `.chromium-profile/` directory. No credentials belong in the source code.

If you use system Chromium:

```bash
export CHROMIUM_PATH="$(command -v chromium)"
npm run sync
```

On supported Debian/Ubuntu systems only, `npx playwright install --with-deps chromium` can install required OS libraries. On other distributions, use the browser-only command above or system Chromium.

## Inventory app

```bash
npm run app
```

Open **http://localhost:3000** on the same computer.

1. Use NOT LISTED (the default) and search by title, brand, barcode, ID, or description.
2. Open an item and check its Circle-Hand stock status.
3. Click OPEN PHOTO FOLDER and select the numbered photos in Vinted's upload dialog.
4. If a file manager is unavailable, COPY FOLDER PATH and paste it into your upload dialog's location field (often Ctrl+L).
5. Copy title, description, and other fields individually, or use COPY ALL.
6. Publish manually in Vinted and click MARK LISTED ON VINTED locally.

MARK NOT LISTED reverses the local mark. No Vinted automation is included.

## Sync behavior

`npm run sync` scans every dashboard page for new items. It skips existing item detail pages when the recorded photos are present and there are no unresolved photo errors. New and incomplete items are processed. Skipped items retain their saved listing information.

To check all detail pages for changed descriptions or newly added photos:

```bash
npm run sync -- --force
```

Unchanged downloaded photos are reused even with `--force`. Photo order follows Circle-Hand. Sync preserves Vinted marks and existing item folders. Removed source items and old unreferenced image files are retained locally.

The crawler reads item forms without submitting them. It waits for photo URLs to settle, retries temporary image-download failures, and makes scrolling optional so a replaced/unstable uploader cannot abort an item. Missing and incomplete galleries are flagged rather than silently discarding previously saved photos.

```bash
npm run login                 # Sign in or renew the profile only
npm run sync -- --limit=3     # Scan dashboards; consider the first three items
HEADLESS=1 npm run sync        # Requires a previously authenticated profile
```

`inventory/sync-report.json` records the run. `inventory/photo-issues.json` lists unresolved photo problems. One failed item does not stop later items; a dashboard/pagination failure stops the run.

If a stopped/crashed run leaves `inventory/.sync.lock`, remove the lock only after confirming no sync is running.

## Files and data

```text
inventory/
  <stable-circlehand-id>-<short-title>/
    01.jpg
    02.jpg
    item.json
    item.txt
```

PNG, WebP, GIF, and AVIF files retain their extensions. JSON stores photo URL mappings and local listing status; text files provide a copy/paste fallback. Fields absent from Circle-Hand are not invented. Detail price is copyable; dashboard price is preserved separately because the portal may show a different value.

Inventory, photos, browser sessions, the local portal config, logs, personal test exports, and test screenshots are excluded from Git. A clone starts with an empty inventory; sync creates local data.

The app binds to `127.0.0.1`. Optional `PORT` and `INVENTORY_DIR` environment variables change its port or data directory. Run commands from the project root.

## Tests

```bash
npm test
npm run test:ui
node test/photo-browser.js
```

Unit tests cover photo failures, skipped items, status preservation, file ordering, delayed galleries, and detached uploader errors. Browser tests need installed Chromium and create synthetic fixtures; they do not require your inventory or Circle-Hand login. The UI test starts its own server on port 3000, so stop a running app first.

The original adapter was grounded in the authenticated portal DOM and checked against 284 dashboard IDs and three live product details. Live photo downloads and local UI behavior were tested during development. Portal markup can change; inspect the error reports when a later sync has failures.
