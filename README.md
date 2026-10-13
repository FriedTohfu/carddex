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
| 📷 **Scan button** (red, bottom right) | Point the camera at a card, line it up with the frame and tap the shutter. The app compares the photo with every card and shows the closest matches. Tap **Add**. You can also use **Photo** to scan a picture from your gallery (drag and pinch to frame the card), or **Search** to find it by name. Use the language buttons at the top to narrow the search, e.g. **JP** only. |
| **Collection** | Your stats and estimated value, and every set you've started with a progress bar (e.g. 87/198). Tap a set to see owned cards (in colour) and missing ones (greyed out). **My cards** shows everything you own, sortable. |
| ⚡ **Quick add** (inside a set) | Tap cards to add them instantly, which is great for entering a whole booster box. |
| **Search** | Search any card by name (`pikachu`) or number (`25/102`). Filter by language, set and owned/missing, and sort by newest, oldest, name or number. |
| **Pokédex** | Every Pokémon, with names in English, Japanese and Chinese. Pokémon you own cards of are in colour. Tap one to see all its cards, filtered by language and set. Filter by generation. |
| **Wishlists** | Make as many lists as you like. Rename them, change their icon, sort, duplicate, share as text, or remove cards you now own. On any set: **⋯ → Add missing cards to a wishlist**. |
| **Binders** | Make binders with 4, 9 or 12 pockets per page and pick a colour. Fill them card by card, or **Fill from a set** to lay out a whole set in order. Swipe between pages, **Move/swap** cards, see all pages at once (grid button), and mark cards you still **Need**. You can change the pocket size later and the cards reflow. |
| **Card page** (tap any card) | Big image (tap to zoom) and counts for Normal, Reverse holo, Holo and 1st Edition. Also condition, notes, rarity, illustrator, market price (when online), and buttons to add to a wishlist or binder. Swipe left or right for the next card. |
| ＋ **Add a card yourself** | For cards the database doesn't have, such as some Simplified Chinese exclusives. Use **＋** on the Search tab, **Add it yourself** when a search finds nothing, **Not listed? Add it as a new card** in the scanner, or a set's **⋯ → Add a missing card**. Take a photo, type the name and number, and pick a set (or make a new one). It counts in your collection, wishlists, binders and set progress, the scanner learns to recognise it, and it's included in backups. |
| **Settings** | Languages, updating card data, offline cards, scan data, counting secret rares in set progress, light/dark theme, and **Backup/Restore**. |

### ⚠️ Back up your collection

Your collection lives only on your phone. Uninstalling the app or clearing its data deletes it. Use **Settings → Backup → Back up** every so often and save the file to Google Drive or email it to yourself. **Restore** brings it back.

## Good to know

- **Scanning is "snap and confirm".** Lay the card flat in good light and fill the frame. If the top match is wrong, the correct card is usually in the strip of other matches underneath.
- **How scanning works without downloading every image:** your GitHub repository has a second job, **Build scan data**. It downloads every card image once, works out a small "fingerprint" for each card, and saves them in the `data` folder (about 2 MB per language). The app downloads that file the first time you scan, and checks weekly for new sets. The job runs automatically once a month. The first run takes roughly 30–90 minutes, and you can start it any time from **Actions → Build scan data → Run workflow**.
- **Card data** comes from [TCGdex](https://tcgdex.dev), a free community database. It's missing some cards, especially Simplified Chinese exclusives. Add those yourself (see above). Traditional Chinese is off by default; turn it on in Settings → Card languages if you ever want it.
- **Pictures** you've looked at are remembered on the phone (up to about 100 MB, oldest forgotten first), so they show instantly the next time. The very first view of a picture depends on your connection.
- **Pokédex data and sprites** come from [PokéAPI](https://pokeapi.co).
- This is a fan-made personal app. It's not affiliated with Nintendo, The Pokémon Company or Game Freak.

## For tinkerers

- The app is plain HTML, CSS and JavaScript in `www/` (no build step), wrapped as an Android app with [Capacitor](https://capacitorjs.com).
- To preview on a computer, run `npx http-server www` and open it in Chrome's phone view.
- `build/android-setup.sh` adds the camera permission, icon, splash screen, version number and signing key during the GitHub build.
- `build/make_scan_data.py` builds the scanner's fingerprint files. It runs the app's own `www/js/fp.js` in Chromium so the numbers match exactly.
