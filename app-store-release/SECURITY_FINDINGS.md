# Security findings — 2026-09-23

Status is a development review, not certification or an independent penetration test.

| ID | Finding | Action/evidence | Remaining status |
|---|---|---|---|
| S01 | Google Fonts request in web baseline | Removed from native source; system font fallbacks; static test | Native traffic capture pending |
| S02 | Browser-only persistence insufficient for native durable documents | Protected native vault; atomic restore/delete; failure injection and reopen tests | iOS lock/device tests pending |
| S03 | EPUB ZIP lacked CRC and matching-header validation | Added CRC/header/directory/path checks; corrupt/truncated mutation tests | Extended fuzzing and device resource testing pending |
| S04 | Imported XML complexity and backup metadata unbounded in some fields | XML size/depth/node limits; IDs/lookups/location limits; tests | Native peak memory testing pending |
| S05 | Build tool uuid advisory GHSA-w5hq-g745-h8pq | Overrode xcode transitive uuid to 11.1.1; generation/sync/parsing tests; npm audit 0 findings | Recheck advisories before release |
| S06 | Native bridge is a privileged boundary | Main-frame/origin proxy, method validation, navigation restrictions, CSP | Native integration/negative tests blocked by Xcode |
| S07 | Missing/corrupt vault manifest could otherwise look empty | Fail closed, retain objects; macOS Foundation test | Recovery UI/repair support procedure needs device evaluation |
| S08 | Backups contain private plaintext | In-app disclosure, explicit native share, temporary-file cleanup | No password encryption; publisher must accept intended threat model |
| S09 | Full native build and archive not verified | Syntax parsing and plist validation only | RELEASE BLOCKER: Xcode, simulators/devices, signing |
| S10 | Legal/publisher/privacy declarations incomplete | Draft pages and release guard | RELEASE BLOCKER: owner facts and reviewed final documents |

PDF.js 6.3.289 is newer than the 4.2.67 fix for the published CVE-2024-4367 advisory; isEvalSupported is explicitly false. This addresses that versioned advisory, not every possible PDF vulnerability. Source: https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq . npm scans do not include the vendored PDF engine or dictionary; their hashes are recorded separately.

No app-store-ready security pass is claimed. Open items include simulator/device bridge validation, instrumented malicious-file testing, native network inspection, archive inspection and a scoped independent review. Do not mark these as waived merely because no exploitable bug has yet been reproduced.
