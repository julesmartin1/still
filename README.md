# Still

A calm reading app that shows one word at a time, at an average pace that adapts to the reader. It has paragraph review, local-only storage, optional citation filtering for papers, and ungraded comprehension check-ins. It also has chapters from a PDF's table of contents, hold-to-see-the-sentence, a short "find my pace" warm-up, and import checks that repair common book-PDF faults. To make short, regular reading easy, it shows the time left, offers a daily goal with a streak, fades the page back while you read, keeps the screen on while words play, and lets you tap the word to play or pause, or either side of it to jump 15 words. A repeated word ("that that") starts with a blank moment so the second one is seen. Settings › Show switches between one word and a whole sentence at a time, with the word being read (or due, reading silently) underlined. Each word's time comes from one model: how long it takes to say, how common it is (word-frequency lists in `still/dist/frequency/`) and the pauses at commas and full stops; see `wordWeight` in `still/dist/engine.js`.

| Folder | What it is |
|---|---|
| `still/` | The web app. `still/dist/` is the source (plain ES modules, no build step). |
| `still-ios/` | The iPhone/iPad app (Capacitor). Shares the reader code with `still/`. |
| `app-store-release/` | Release records from the original handoff (status, threat model, drafts). |
| `scripts/sync-shared.mjs` | Keeps the shared code identical between the two apps. |
| `AUDIT.md` | Test and audit findings, what was fixed, and the reasoning behind recent design changes. |
| `START-HERE.md` | The original cofounder handoff notes (with an update section). |

## Run the web app

Needs Node.js 20 or newer. Nothing to install.

```sh
cd still
npm start          # http://127.0.0.1:4173
npm test           # unit tests
```

## Waitlist, feedback and visits (web only)

The website's waitlist and feedback forms post to **Netlify Forms** (Netlify dashboard → Forms; form detection must be turned on there). A cookie-free **visit counter** lives in `netlify/functions/visit.mjs`: the app sends one anonymous ping per tab, and opening `/api/visit` shows daily visits and first-time visitors for the last 30 days. None of this runs in the iOS app.

The web app itself is published to **GitHub Pages** by `.github/workflows/pages.yml` on every push to `main` (at `https://julesmartin1.github.io/still/`). Those three server features (forms, visit counter and the natural read-aloud voice in `netlify/functions/speak.mjs`) still run on the Netlify site `still123.netlify.app`, which the Pages copy calls across origins (`SERVER_SITE` in `still/dist/natural-voice.js`). Netlify only rebuilds when `netlify/` or `netlify.toml` change, so it uses few credits. If the Netlify site is paused, the Pages app still works: read aloud falls back to device voices, visits aren't counted, and the waitlist says it couldn't send.

## Shared code: edit once, sync

Every file in `still/dist/` and `still/tests/` is shared with `still-ios/`, except `native-runtime.js` (browser storage on the web, the native vault on iOS) and the generated `offline-assets.js`. Edit shared files in `still/`, then from the repository root:

```sh
npm run sync       # copy shared files to still-ios/ and refresh offline asset lists
npm test           # fails if the two copies differ, then runs the web tests
```

Never edit a shared file inside `still-ios/dist/` directly; the next sync overwrites it.

## Tests

- **Unit tests** (`npm test` in `still/` or `still-ios/`): reading engine, word splitting, citations, PDF layout and contents, text repair and checks, backups, check-ins, pace finder, daily goal and streak, PDF compatibility shims.
- **Browser tests** (`still/tests/ui/run.py`): keyboard, dialogs, storage, bookshelf, check-ins, welcome and daily goal, layout. One-time setup: `pip install playwright && python -m playwright install chromium`. Then run `python3 tests/ui/run.py` from `still/` (pass a name fragment to run a subset).

## iOS

See `still-ios/README.md`. The native project has still never been compiled; it needs a Mac with full Xcode. Run `npm run sync` at the root before `npm run sync` inside `still-ios/`.

## Working together

Use a branch per piece of work and open a pull request to `main`. Say in the PR whether it touches the shared reader, the web-only runtime, or the iOS-only runtime.
