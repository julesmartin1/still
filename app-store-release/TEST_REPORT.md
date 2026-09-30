# Verification report — 2026-09-23

Environment: macOS host with Command Line Tools and Node 24.16.0. Full Xcode was not found in /Applications or Spotlight and `xcodebuild -version` fails because only Command Line Tools are selected. No simulator/physical iOS execution, signed archive or TestFlight test has run.

Evidence:
- Web baseline: 49 tests passed before native changes.
- Native project's shared JavaScript: 56 tests pass, including prior pacing/citation/PDF/backup regressions, ZIP integrity failures and native-adapter tests using a simulated bridge. See evidence/javascript-tests.txt. The simulated bridge is explicitly not native integration evidence.
- Foundation vault compiled/executed on macOS: atomic commit, interruption before manifest write, reopen, orphan cleanup, key rejection, deletion and corrupt/missing-manifest retention checks. See evidence/native-storage-tests.txt. iOS file-protection branches are not exercised by these tests.
- Swift files pass syntax parsing; Info.plist, PrivacyInfo.xcprivacy and Xcode project pass plutil. This does not typecheck against UIKit/WebKit/Capacitor or build an iOS binary.
- npm audit and production-only audit report zero known findings after a tested build-time uuid override. Bundled PDF.js/WordNet are separately inventoried; npm audit is not a full security review.
- Browser preview at 127.0.0.1:4174: boot, synthetic PDF import and original-page render under CSP; synthetic EPUB spine/TOC import; permanent deletion dialog and removal from trash; normal-mode position and notes workflow through reload. No console errors observed in checked flows. This verifies the shared UI only.
- Bundle build and Capacitor iOS sync succeed. Swift package resolution/build status is tracked in STATUS; no iOS build should be inferred from sync.
- Release guard intentionally fails on unset real-world facts and outstanding native/legal/security/beta evidence.

Open native matrix: iOS minimum/current versions on iPhone/iPad; first launch in airplane mode; actual Files/iCloud provider and native share sheet; bridge negative tests; device lock/background interrupts; data-protection inspection; memory/battery/large inputs; VoiceOver/Dynamic Type; upgrade/restore/erase behavior; real beta and privacy archive report. No screenshots from a browser are represented as store screenshots.

Additional shared-UI verification: bundled draft privacy page opens and returns to the reader; erase-all removes the synthetic PDF/EPUB/note test library and leaves only a fresh bundled sample. Swift package resolution succeeded and is pinned in Package.resolved. Source checkpoint: 171db4ef2f9402b4718f8edb90eb746c8e159df8.
