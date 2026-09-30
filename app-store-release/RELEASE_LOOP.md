# Still: Apple App Store release loop

Created 2026-09-23. Target confirmed by owner: Apple App Store first, iPhone and iPad. Publisher, support email, countries and pricing are undecided. This is the execution prompt and release contract, not a certification or statement that the app is ready.

## Mission
Turn the existing Still reader into a maintainable, tested iOS/iPadOS application that is ready for App Store submission. Execute implementation, verification and repair, not just recommendations. Preserve the approved reading experience. Work through all independently actionable items; isolate genuine external blockers instead of stopping the whole project. Continue until the release gates below have evidence, or the only remaining work requires unavailable accounts, hardware, owner decisions or professional review.

Project: `/Users/mattiasnelson/Documents/Codex/2026-09-22/hi-there-what-can-i-help/outputs/still`.
Release dossier: `/Users/mattiasnelson/Documents/Codex/2026-09-22/hi-there-what-can-i-help/outputs/app-store-release`.
Existing private website: https://still-reading-mn.mattiasnelson11.chatgpt.site/

Read applicable AGENTS.md, skills, current source, README, PROGRESS, acceptance files and this dossier before working. Source and reproducible results take precedence over historical progress claims. Respect the Sites source-opening/publishing workflow if changing the hosted site. Native development is not itself a Sites deployment. Preserve the existing website audience and user data. Do not overwrite another contributor's changes.

## Product constraints
- Preserve fixed-point word display, approved average-WPM formula and short-word floor, gentle rewind learning, paragraph review and definitions. Do not add quizzes, comprehension scoring, automatic speed increases or claims that comprehension is measured.
- Preserve normal reading, sentence rewind, PDF original-page navigation, EPUB spine order/TOC, source-anchored citation controls, bookmarks/notes, bookshelf management, appearance and export/restore.
- Citation/reference controls stay appropriate to document type and never destroy source text.
- Use a local-first architecture. No accounts, analytics, ads, cloud document upload, AI services or subscriptions by default. Pricing undecided does not authorize a paid model or a free commercial launch.
- Imports are user-selected, legally obtained files. No DRM circumvention, Kindle/library access promises or redistribution of imported books.
- Preserve English dictionary limitations and extraction limitations honestly. No unsupported reading-speed, accessibility-treatment or medical claims.

## How each iteration runs
1. Read `STATUS.md`, the acceptance ledger and last successful evidence. Identify the highest-priority unblocked gate. Use one concrete work batch with an explicit expected result.
2. Inspect the actual implementation and write reproducible failure steps or a test for a material defect. Do not treat a checklist, dependency scan or browser prototype as proof of native behavior.
3. Implement the smallest complete fix or feature, including failure states, migration and privacy implications. Prefer maintained platform APIs and reviewed libraries to novel security primitives.
4. Run relevant automated tests, then the relevant real simulator/device flow. Record command, date, platform/device/OS, result, artifact path and source revision. Redact logs. Use owned synthetic/public-domain test files; never commit the owner's papers or books.
5. Review the changed trust boundaries and update data-flow, licensing, store disclosures and support text when behavior changes. Retest the specific repair and affected regressions. Do not repeat unrelated checks without cause.
6. Update the ledger with NOT STARTED / IN PROGRESS / PASS / FAIL / BLOCKED / NOT APPLICABLE. Every PASS requires evidence; every BLOCKED requires owner, reason and exact next action; every NOT APPLICABLE requires a reason. Unknown is not pass.
7. Reprioritize and continue. Give brief meaningful updates, including what changed and what remains unverified. Do not generate endless feature suggestions or hide failures behind a score.
8. If the same approach fails twice, investigate and choose a different approach. If an external blocker persists, work on independent gates. If all remaining work is externally blocked, end with the exact handoff package and blockers; do not claim completion or busy-loop.

This prompt authorizes iterative work in the active task. It does not create a background scheduler. Do not schedule recurring work or create other tasks unless requested.

## Gate 0 — baseline and release architecture
- Inventory files, build tools, native projects, dependency versions, bundled vendor code, licenses and network endpoints. Check full Xcode installation separately from `xcode-select`; record SDK/simulator/device availability. Do not pretend simulator/device tests ran without those tools.
- Run the existing automated suite; baseline all user-facing workflows. Record existing defects separately from newly introduced ones.
- Choose and document an iOS architecture based on offline file access, sandboxing, persistence, accessibility, packaging and maintainability. Reuse deterministic reading logic where practical. A bundled web UI is acceptable only with secure native integration and complete app functionality; do not ship a remote URL wrapper or an app dependent on the private Sites login.
- Package runtime assets locally and make first launch usable offline. Decide native storage/migrations and how users bring existing bookshelf backups into the app. Do not silently assume Safari storage transfers into the app sandbox.
- Commit a reproducible native project/build configuration, version/build numbers, dependency locks and developer setup instructions. Keep signing credentials out of source and logs. Temporary bundle identifiers are visibly provisional and must be resolved before distribution.

## Gate 1 — functional native application
- Implement native Files import for PDF/EPUB/text and native export/share of backups. Use security-scoped file access correctly; release handles; recover from revoked access and partial iCloud downloads. Share-extension support is optional unless needed for the chosen product flow; do not make scope grow without need.
- Implement durable native-compatible bookshelf/progress and transactional migrations. A crash, force quit, app update or failed import cannot silently wipe existing readings. Avoid depending solely on purgeable web storage for irreplaceable user documents.
- Separate temporary extraction/rendering caches from original files. Test storage exhaustion, corrupted databases, duplicate imports and failed restore. Explain recovery and preserve the old state on failure.
- Make archive, trash, restore, permanent deletion and erase-all behavior explicit. Permanent deletion must actually remove relevant originals, notes, indexes and cached content. Explain exports and OS backups the app cannot revoke. Testing destructive flows uses disposable test data; never purge user data without required confirmation.
- Ensure backgrounding, interruptions and screen locking pause playback and save position. No catch-up flashing on return. Handle orientation, safe areas, iPad resizing, light/dark appearance and large text.
- VoiceOver and keyboard users must navigate library, import, settings and normal text meaningfully. Do not announce rapidly changing words as a barrage. Offer normal text as an accessible reading path. Verify focus, labels, contrast, touch targets, reduced motion and layout at large accessibility text sizes.

## Gate 2 — security review with evidence
Create `THREAT_MODEL.md`, `SECURITY_FINDINGS.md`, dependency/SBOM inventory and a current OWASP MASVS/MASTG applicability matrix.

Trust boundaries include imported PDFs/ZIP/XML/JSON, file providers, native/web bridges, persistent data, exported backups, external links, cached assets, signing/build pipelines, support submissions and any optional backend.

Required checks:
- Treat all document text, filenames, metadata, notes and backup fields as untrusted. No execution of document JavaScript or imported HTML. Audit injection sinks rather than flagging every constant innerHTML assignment as exploitable.
- Fuzz hostile/corrupt/truncated PDF, EPUB and backup fixtures. Bound compressed and expanded sizes, entry counts, nesting, processing time, render dimensions and memory. Validate ZIP paths, local/central header consistency, offsets, collisions and decompression behavior; reject unsupported encryption and dangerous XML entities. Cancellation must stop expensive work. Keep parsing isolated/off the UI thread where possible.
- Audit PDF.js and all transitive/bundled dependencies against current advisories; a no-dependency package.json is not a clean bill of health. Pin provenance and hashes; update and retest affected extraction behavior. Use native parsers where that improves the security model without losing needed behavior.
- For a WKWebView-based implementation: bundle executable assets, restrict navigation and new windows, deny arbitrary file/network access, validate every bridge message and origin/frame, expose only necessary native methods, and apply a tested CSP. Never allow a document to call the bridge or update executable app code remotely outside applicable store rules.
- Capture native network traffic for launch, import, reading, lookup, background/resume, backup and support. Remove unsolicited external requests, including hosted fonts. Bundle licensed fonts or use system fonts. External help links should open deliberately in the system browser. Record all remaining endpoints and purposes.
- Verify iOS sandbox/data-protection and lock-state behavior. Decide OS-backup inclusion deliberately. Use Keychain for secrets if any exist. Do not invent custom encryption or advertise encryption beyond verified behavior. Document plaintext backup exports or implement a reviewed authenticated-encryption format if required by the threat model.
- Verify no document text, filenames, notes, keys or identifiers leak in crash logs, diagnostics, pasteboard, URLs, screenshots used for marketing, or support attachments. Review app-switcher previews according to the chosen privacy model.
- No unjustified permissions, ATS exceptions, tracking identifiers or entitlements. Inspect the release archive, not just source configuration. Scan repository/history and artifacts for secrets.
- Review update/rollback and dependency incident response. No unresolved exploitable critical/high findings at release. Triage every medium/low finding with impact and mitigation; owner acceptance is explicit where material. Obtain a suitably scoped independent security review when feasible; otherwise state that it was not performed and do not claim an independent audit.

## Gate 3 — privacy, rights and legal readiness
Create a data inventory from observed behavior: data categories, purpose, local/transmitted status, recipient, retention, deletion, device backups, diagnostics and optional support disclosures. Distinguish the bundled app from its public support website and hosting logs.

- Draft a privacy policy, support page, terms/license approach and in-app third-party notices. Disclose actual behavior, not aspirational claims. Public policy/support URLs must work without a private Sites account and be reachable inside the app. Do not make the current private website public without explicit authorization.
- Match App Store privacy answers and any PrivacyInfo.xcprivacy declarations to the final binary, frameworks, required-reason API use and real data flow. Do not automatically declare “Data Not Collected” because the app has no account.
- Inventory PDF.js, WordNet, fonts, icons, native libraries and transitive notices; retain required copyright/license/attribution text and fulfill distribution conditions. Verify rights for samples, screenshots, app name and branding. Use original or verified licensed/public-domain samples.
- Verify owner publisher identity, contact details, intended countries, age audience, business/pricing model and rights to release the code/assets. Do not invent a legal entity, postal address, support mailbox, trademark clearance or professional approval.
- Build a jurisdiction/applicability table using current primary regulator sources once countries and business facts are known. Evaluate applicable privacy/consumer/accessibility/children rules, EU trader/contact requirements where relevant, export classification and tax/banking needs for the chosen model. Do not assert that every law applies, or that “local only” exempts everything.
- If monetization is selected, implement applicable StoreKit purchase/restore/refund/subscription disclosure behavior and test it in sandbox. Do not add payment infrastructure before that decision. Regional store rules must be checked at the time of implementation/submission.
- Explain document ownership and import limitations without claiming affiliation with Kindle, publishers or libraries. Do not confuse private local imports with a public content-sharing platform; assess moderation obligations only for capabilities actually shipped.
- Produce a concise unresolved-legal-questions brief for qualified counsel, scoped to actual countries and product practices. Label drafts until facts are resolved. Professional review or publisher legal sign-off is a separate evidence item; the agent cannot certify legal compliance.

## Gate 4 — native reliability and beta acceptance
Test on a minimum supported iOS version and the current submission-supported version, with at least one real iPhone and one real iPad if claiming both. Simulators supplement device testing; record gaps honestly.

Acceptance scenarios:
1. Cold launch and first import in airplane mode; bundled dictionary and help/error states work.
2. Valid PDF, two-column academic PDF, malformed/oversized/scanned/password-protected PDF; original-page render and exact restart.
3. EPUB 2/3 TOC, non-filename spine order, nested sections, multilingual Unicode, long words, malformed XML/ZIP and unsupported DRM.
4. Paste/import/read/review/rewind/switch modes; exact source position preserved across filters, notes, chapters and relaunch.
5. Short-word floor and paragraph time-budget regressions pass; device timer delays never shorten the next word to catch up.
6. Search/archive/trash/restore/permanent-delete, independent reading pace and positions, notes edit/return and appearance persistence.
7. Export/restore round trip including originals, mappings, notes and settings; corrupt and oversized backups leave the library unchanged; migration from the website backup format works.
8. Forced termination during import/save/restore, low storage, revoked file-provider permission, interruptions, background/foreground and app upgrade.
9. VoiceOver, dynamic type, keyboard, contrast, safe areas and both orientations on supported sizes.
10. Long reading session and large allowed files: no crashes, hang or runaway memory; measure startup/import/paging responsiveness and battery/CPU impact. Set explicit performance budgets from baseline/device measurements and enforce them.

Run a TestFlight beta with an owner-approved cohort and concrete issue collection. Do not contact testers without authorization. Resolve reproducible crashes, data loss, security/privacy defects and failures of core workflows before release. Capture beta duration, devices and results; do not fabricate users or coverage.

## Gate 5 — App Store package and submission
Recheck live Apple requirements immediately before submission; do not freeze SDK/privacy/review rules at the date this prompt was written.

Prepare:
- Verified developer membership/team, final bundle ID, App Store Connect record, signing configuration, capabilities and provisioning.
- Release archive and distribution validation using current accepted Xcode/SDK; version/build IDs and a reproducible source revision; no debug menus, test secrets or sample personal data.
- Store name/subtitle/description/keywords/category and truthful age-rating questionnaire; truthful Accessibility Nutrition Labels if supplied.
- Correct device screenshots from the actual final app, icon assets, public support/privacy URLs, copyright and contact details.
- Privacy answers, required manifests/signatures, encryption/export answers supported by evidence, content-rights declarations and territory/trader/commercial forms as applicable.
- Review notes explaining local import, a rights-cleared sample, adaptive pacing, optional citation filtering and any non-obvious functionality; demo access only if a login actually exists.
- Chosen pricing/availability/release strategy and, if needed, purchase products and review assets. Submission readiness and public release are distinct states.

Do all reversible preparation before requesting any final action that requires owner authority. Never accept legally binding developer agreements, supply tax/banking/legal attestations, buy membership, grant new security-sensitive access or make the app publicly available on guessed facts. Use the tool's required confirmation/hand-off rules. Do not invent unnecessary confirmations for normal implementation, tests or already-authorized actions.

If authorized and equipped to submit, submit the validated build and track the actual review status. Address rejections through specific repairs and a new verified build. Never mark “approved” until App Store Connect says approved, or “live” until availability is verified. If no submission access is available, finish the complete handoff dossier and mark submission BLOCKED.

## Gate 6 — launch and operation
Prepare support ownership, a tested contact route, incident/security-report handling, privacy request handling where relevant, dependency monitoring/update cadence, release notes, rollback/recovery strategy, backup compatibility and an accessibility issue route. Avoid adding analytics merely to satisfy a monitoring checklist; use privacy-preserving diagnostics only after deliberate review. Schedule recurring monitoring only when specifically requested.

Define success states precisely:
- IMPLEMENTED: source/build changes exist; may still lack native verification.
- VERIFIED CANDIDATE: native tests and security gates pass for a named revision, with disclosed limitations.
- SUBMISSION READY: all mandatory gates pass; no missing identity, policy, rights, commercial, signing or submission evidence.
- SUBMITTED / APPROVED / LIVE: separately confirmed store states.
Do not substitute one state for another. No “100% secure,” “legally airtight,” or guaranteed store approval claims.

## Required handoff files
Maintain `STATUS.md`, `ACCEPTANCE.csv` (gate, status, evidence, revision, owner, next action), `THREAT_MODEL.md`, `SECURITY_FINDINGS.md`, `DATA_INVENTORY.md`, `LICENSES.md`, `TEST_REPORT.md`, `STORE_SUBMISSION.md`, `OPERATIONS.md`, and clearly labeled legal/policy drafts or finalized copies. Include source/build paths and a small exact owner-action list. A completed checklist without artifacts is not a finished app.

## Primary references
Consult current versions; record verification dates in evidence.
- Apple review guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple submission: https://developer.apple.com/app-store/submitting/
- Apple privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Apple third-party SDK requirements: https://developer.apple.com/support/third-party-SDK-requirements/
- Apple privacy manifests: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- OWASP MASVS: https://mas.owasp.org/MASVS/
- OWASP MASTG: https://mas.owasp.org/MASTG/
Primary Apple and OWASP references were checked while preparing this loop on 2026-09-23. Region-specific legal analysis remains pending the owner's countries/business decisions.

## Execution checkpoint after first run
Native work now lives in sibling `outputs/still-ios`, with its own Git repository. Read STATUS.md before continuing. The website is unchanged. Continue from the recorded native source checkpoint; do not recreate the scaffold or treat completed host/browser tests as iOS runtime evidence. The next gate is a real Xcode build and native verification.
