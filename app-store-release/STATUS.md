# Still App Store release status — 2026-09-23

**State: IMPLEMENTED DEVELOPMENT CANDIDATE, NOT SUBMISSION READY.** The release loop ran through native source preparation, shared-logic/browser checks, native storage-core tests and the initial release dossier. It is now blocked at actual iOS verification and unresolved publisher/release facts. No app was submitted, approved or released. No background automation is running.

Native source: `../still-ios/`.
Source checkpoint: `171db4ef2f9402b4718f8edb90eb746c8e159df8` (clean local Git commit).
Existing website: unchanged, still private; starting web revision bd515492a4849b670a8205fd2feb89d11d07b665.
Evidence source hash/file inventory: `evidence/source-receipt.json`.

## Implemented in this pass
- iPhone/iPad Capacitor 8.5.2 project with all reader/dictionary/PDF assets bundled; provisional iOS 18+ target; no remote site dependency.
- Swift native vault using a serialized queue, protected files and atomic manifest commits; original PDFs/notes/settings; small periodic progress checkpoints; corruption/missing-manifest protection; native export sheet code.
- WebKit Files import integration through existing file inputs plus plain-text import; website-backup migration path.
- Native main-frame/origin bridge guard, navigation restrictions, nonpersistent WebView cache, CSP, background pause/flush and privacy cover, Dynamic Type scaling hook.
- Remote-font removal, EPUB CRC/header/path/complexity hardening, backup-field limits, PDF resource bounds/timeout, permanent deletion/erase flows.
- Pinned dependencies and resolved Swift package; zero npm audit findings after a tested build-tool override; separate vendor hashes and licenses.
- Bundled draft privacy/help pages, notices, original app icon/launch art, threat model, data inventory, legal review brief, proposed store packet and operations plan.
- Release guard that correctly reports NOT SUBMISSION READY rather than treating missing facts as passed.

## Verified, with scope
- 56 JavaScript tests pass, including native-adapter tests with a simulated bridge.
- Swift Foundation storage core compiles/runs on macOS; interrupted commits preserve prior state; deletion and corrupt/missing-manifest safeguards pass.
- Swift syntax parsing, plist/Xcode-project structural validation, bundle generation and Capacitor sync pass.
- Swift Package Manager resolves Capacitor 8.5.2 at upstream revision 0b6882e9a3288342aacf36348e5a94e4f1dd7b13, including binary artifacts.
- Browser preview checks pass: synthetic PDF import/render, EPUB chapter import, notes/position through reload, deletion, erase-all and bundled privacy navigation. These are not native iOS tests.

## Blockers
1. **Xcode / iOS SDK and runtime:** Xcode absent from /Applications and Spotlight lookup; selected Command Line Tools cannot run xcodebuild. Owner was asked to install/open Xcode. No full iOS compilation, simulator test or signed archive exists. Syntax parsing is not typechecking/linking.
2. **Devices / beta:** real iPhone/iPad verification, native file providers/export, lock-state storage, bridge/network negative tests, accessibility, memory/battery and TestFlight cohort evidence remain required. No device coverage is fabricated.
3. **Owner/business facts:** publisher identity, public support/contact and policy hosting, countries, age audience, pricing, final bundle ID and developer team remain undecided/unverified.
4. **Release review:** archive privacy/API declarations, final license completeness, rights/name clearance, applicable legal decisions and security review/sign-off require real evidence. Drafts are not legal clearance.

## Exact next execution batch
After Xcode is installed and first-run setup completed, use a task-local DEVELOPER_DIR if needed; do not change global settings unnecessarily. In `../still-ios`, run `npm ci`, `npm run sync`, then the simulator xcodebuild command in README. Fix actual compiler/runtime failures before polishing. Verify trusted bridge and native vault initialization first, then import/export, lifecycle and device safety matrix. Record receipts against the source revision. Continue unblocked work when another gate is blocked. Do not edit the existing website merely to complete the native app.

Owner choices can follow separately; do not invent them or request them repeatedly while still undecided. No payment, agreement acceptance, account changes, public exposure or legal attestation has been performed.
