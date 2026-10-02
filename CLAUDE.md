# Still

A calm reading app that shows one word at a time at a pace that adapts to the reader. Design goal: make reading faster and easier for people whose attention is pulled in many directions (short daily goals, visible progress, a clear next step), while staying calm.

## Layout

- `still/dist/` is the web app: plain ES modules, no build step. `app.js` is the UI glue; the logic lives in small modules (`engine.js` timing, `habits.js` daily goal and streak, `checkins.js`, `pdf-*.js`, `text-repair.js`, …).
- `still-ios/` is the Capacitor iPhone app. It shares `dist/` and `tests/` with `still/`.
- `AUDIT.md` records every finding, what changed and why. Add new findings there.

## Rules

- Edit shared files only in `still/dist` and `still/tests`. Then run `npm run sync` from the repository root, which copies them to `still-ios/` and regenerates `offline-assets.js`. Never edit shared files in `still-ios/dist` directly.
- `native-runtime.js` and `offline-assets.js` are per-platform and are not synced.
- Format touched files with Prettier.
- Everything stays on the device: no accounts, servers or analytics.

## Commands

- `npm start` (in `still/` or root): serve the web app at http://127.0.0.1:4173.
- `npm test` (root): check the shared copies match, then run the unit tests.
- `python3 tests/ui/run.py` (in `still/`): browser checks. Needs `pip install playwright` matching the installed Chromium (in Claude Code cloud sessions: `pip install playwright==1.56.0`).
- iOS unit tests: `cd still-ios && npm ci --ignore-scripts && npm test`.

## Hosting

`netlify.toml` publishes `still/dist` as a static site.
