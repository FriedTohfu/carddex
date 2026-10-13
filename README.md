# CardDex: Pokémon card tracker

CardDex is a personal Android app for tracking your Pokémon cards in **English, Japanese and Chinese**. It works offline once you've downloaded the card data.

This folder is the app's source code. The guide below turns it into an **APK** you can install on your Android phone. You don't need to install anything on your computer. GitHub builds the app for you, for free.

---

## Part 1: Make a GitHub account and a place for the app (5 minutes)

1. On a computer, go to **https://github.com** and click **Sign up**. Make a free account and confirm your email.
2. Once logged in, click the **+** in the top-right corner, then **New repository**.
3. Fill it in:
   - **Repository name:** `carddex`
   - Choose **Public**. This is simplest, because you can then download the app on your phone without logging in. The code has no personal information in it.
   - Leave the other options as they are.
4. Click **Create repository**.

## Part 2: Upload the app's files (5 minutes)

1. Unzip `carddex.zip` on your computer. You'll get a folder called `carddex`.
2. On your new repository page, click the link **uploading an existing file**. You'll also find it under **Add file → Upload files**.
3. Open the `carddex` folder on your computer and **select everything inside it**. Drag it all onto the GitHub upload page. That means the `www` and `build` folders plus `package.json`, `capacitor.config.json` and `README.md`. The `.github` folder too, if you can see it.
4. Wait until every file is listed, then click the green **Commit changes** button at the bottom.

### Part 2b: Make sure the "build instructions" file is there

Computers often hide folders whose names start with a dot, so the `.github` folder may not have been uploaded. Check it like this:

1. On your repository page, look for a folder called **.github** in the file list.
2. **If you see it, skip to Part 3.**
3. If it's missing:
   - Click **Add file → Create new file**.
   - In the name box, type exactly: `.github/workflows/build-apk.yml`. GitHub turns each `/` into a folder as you type.
   - Open the file `build/github-workflow.yml` in your repository in a new tab. Click the **copy** button (two overlapping squares) at the top right of the file.
   - Paste it into the big empty box of the new file.
   - Click **Commit changes…**, then **Commit changes** again.

## Part 3: Let GitHub build the app (about 5–8 minutes)

1. Click the **Actions** tab at the top of your repository.
2. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
3. You should see **Build Android app** running, with a yellow dot. If nothing is running, click **Build Android app** on the left, then **Run workflow → Run workflow**.
4. Wait for the dot to turn into a **green tick ✅**. This takes about 5–8 minutes.
   - A **red ❌** means something went wrong. Click it, then the failed step, and copy the red error text. Send it to Claude and it can tell you what to fix.

## Part 4: Install it on your phone

1. On your **Android phone**, open the browser and go to:
   `https://github.com/YOUR-USERNAME/carddex/releases/latest`
   Replace `YOUR-USERNAME` with your GitHub username. It's a good idea to bookmark this page.
2. Tap **CardDex.apk** to download it.
3. Open the downloaded file. Android will ask for permission to install apps from your browser. Tap **Settings**, turn on **Allow from this source**, then go back.
4. Tap **Install**. If Google Play Protect warns about an unknown app, tap **More details → Install anyway**. It warns about any app that isn't from the Play Store.
5. Open **CardDex** 🎉

### Updating later

Whenever you upload changed files, GitHub builds a new version automatically. Download the newest APK from the same link and install it over the old one. **Your collection stays**, because every version is signed with the same key, which lives in `build/debug.keystore`. Don't delete that file.

> **iPhone?** iPhone apps can only be built on a Mac with a paid Apple developer account, so this guide is Android only.

---

## First time you open the app

1. Connect to the internet.
2. A spinning Poké Ball shows while the app loads. Then the **Get started** screen appears. Choose your languages and tap **Download card data**. This fetches the card list (a few MB), the Pokédex and the scan data.
3. That's it. **Card pictures load from the internet**, so nothing big downloads.

**Want cards to show without internet?** Save them for offline:
- Cards in your collection are saved automatically. They're small, about 20 KB each. You can turn this off in Settings → Offline cards.
- Any set, wishlist or binder: **⋯ menu → Save … for offline**.
- A single card: open it and tap **📥 Save for offline**.

Your collection, wishlists, binders, search, Pokédex and scanning all still work offline. Only pictures you haven't saved need internet.

## What's in the app

| Where | What it does |
|---|---|
| 📷 **Scan button** (red, bottom right) | Opens your phone's camera app straight away (or tap **Upload photo** to use a picture from your gallery). After the photo, the card is centred in a frame automatically; drag or pinch to adjust, then tap **Find card**. Tap **Add** on the match. Language buttons at the top narrow the search (e.g. **JP** only). |
| **Collection** | Your stats and estimated value, and every set you've started with a progress bar (e.g. 87/198). Use the **series** buttons (e.g. XY, Black & White) to narrow things down. Tap a set to see owned cards (in colour) and missing ones (greyed out). **My cards** shows everything you own, grouped by series, set, language or Pokémon (collapsible), and sortable. |
| ⚡ **Quick add** (inside a set) | Tap cards to add them instantly, which is great for entering a whole booster box. |
| **Search** | Search any card by name (`pikachu`) or number (`25/102`). Filter by language, set and owned/missing, and sort by newest, oldest, name or number. |
| **Pokédex** | Every Pokémon, with names in English, Japanese and Chinese. Pokémon you own cards of show your most recently added card of them (you can switch back to sprites in Settings). Tap one to see all its cards, filtered by language and set. Filter by generation. |
| **Wishlists** | Make as many lists as you like. Rename them, change their icon, sort, duplicate, share as text, or remove cards you now own. On any set: **⋯ → Add missing cards to a wishlist**. |
| **Binders** | Make binders with 4, 9 or 12 pockets per page and pick a colour. Fill them card by card, or **Fill from a set** to lay out a whole set in order. Swipe between pages, **Move/swap** cards, see all pages at once (grid button), and mark cards you still **Need**. You can change the pocket size later and the cards reflow. |
| **Card page** (tap any card) | Big image (tap to zoom) and counts for Normal, Reverse holo, Holo and 1st Edition. Also condition, notes, rarity, illustrator, market price (when online), and buttons to add to a wishlist or binder. Swipe left or right for the next card. |
| ＋ **Add a card yourself** | For cards the database doesn't have, such as some Simplified Chinese exclusives. Use **＋** on the Search tab, **Add it yourself** when a search finds nothing, **Not listed? Add it as a new card** in the scanner, or a set's **⋯ → Add a missing card**. Take a photo, type the name and number, and pick a set (or make a new one). It counts in your collection, wishlists, binders and set progress, the scanner learns to recognise it, and it's included in backups. |
| 💲 **Prices** (on a card's page) | Tap **Check sold prices** for recent sold prices from eBay (on the eBay site for your currency, e.g. eBay Australia) and, for Japanese cards, Mercari Japan. Graded slabs, bundles and odd outliers are filtered out. Each source has an **Open ↗** link to see the actual sales. Your collection's estimated value uses these prices. |
| **Settings** | Languages, card data, offline cards, scan data, **currency**, Pokédex options (keep the search bar showing while scrolling down, show your latest card), secret rares in set progress, theme, and **Backup/Restore**. |

### ⚠️ Back up your collection

Your collection lives only on your phone. Uninstalling the app or clearing its data deletes it. Use **Settings → Backup → Back up** every so often and save the file to Google Drive or email it to yourself. **Restore** brings it back.

## Good to know

- **Scanning finds the card's edges by itself**, so it doesn't need perfect framing. Just get the card roughly inside the frame. It straightens the card, shortlists likely matches, then double-checks them against their pictures. Foil versions (e.g. ★ vs ★★) and reprints in other products often look identical in a photo, so they're shown under **Other versions** for you to pick the right one.
- **How scanning works without downloading every image:** your GitHub repository has a second job, **Build scan data**. It downloads every card image once, works out a small "fingerprint" for each card, and saves them in the `data` folder (about 2 MB per language). The app downloads that file the first time you scan, and checks weekly for new sets. The job runs automatically once a month. The first run takes roughly 30–90 minutes, and you can start it any time from **Actions → Build scan data → Run workflow**.
- **Card data:** English and Japanese come from [TCGdex](https://tcgdex.dev). **Simplified Chinese** comes from [PTCG-CHS-Datasets](https://github.com/duanxr/PTCG-CHS-Datasets), which has the official Chinese card list with pictures, including Chinese exclusives. Its licence allows personal, non-commercial use only. The app downloads it directly from that project (the card list is about 25 MB, the first time only), and nothing from it is copied into this repository except scan fingerprints. Small previews of Chinese pictures are resized by the free [images.weserv.nl](https://images.weserv.nl) service so they load faster. Anything still missing can be added yourself (see above). Traditional Chinese is off by default.
- **Prices:** eBay and Mercari don't provide free public access to sold data, so the app reads their public search results when you tap **Check sold prices**. If either site changes its pages, that source will show "Couldn't read results", and the **Open ↗** link still takes you to the real sold listings. Exchange rates come from open.er-api.com (updated daily).
- **Pictures** you've looked at are remembered on the phone (up to about 100 MB, oldest forgotten first), so they show instantly the next time. The very first view of a picture depends on your connection.
- **Pokédex data and sprites** come from [PokéAPI](https://pokeapi.co).
- This is a fan-made personal app. It's not affiliated with Nintendo, The Pokémon Company or Game Freak.

## For tinkerers

- The app is plain HTML, CSS and JavaScript in `www/` (no build step), wrapped as an Android app with [Capacitor](https://capacitorjs.com).
- To preview on a computer, run `npx http-server www` and open it in Chrome's phone view.
- `build/android-setup.sh` adds the camera permission, icon, splash screen, version number and signing key during the GitHub build.
- `build/make_scan_data.py` builds the scanner's fingerprint files. It runs the app's own `www/js/fp.js` in Chromium so the numbers match exactly.
