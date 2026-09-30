# Data inventory and privacy draft basis

| Data | Purpose | Storage/transfer | Retention/deletion |
|---|---|---|---|
| Imported text, original PDFs, EPUB-extracted text | Reading and original-page navigation | Native Application Support vault; no intentional upload | Until permanent delete/erase; trash retains data |
| Notes and highlights | User annotations | Same vault | Deleted with reading or erase |
| Position, WPM, lookup timestamps and rewind adjustments | Resume and adaptive timing | Vault preferences/reading records | Reset adjustments or reading deletion/erase as applicable |
| Appearance | Presentation preferences | Vault preferences | Erase all clears it |
| Temporary selected file/extraction state | Import/render | WebView memory and OS file-picker resources | Released on close/process exit; verify actual provider behavior |
| Exported JSON | User-controlled portability | Protected temporary app file, then chosen share destination | Temporary file removed on completion; external copy belongs to recipient |
| OS device backup | Recovery | Under Apple's/device owner's backup settings | App cannot revoke previous backups |
| Network metadata from deliberate external links | Third-party help/license website access | System browser to chosen website | Governed by that service |
| Publisher support submissions | Not implemented yet | No support backend/contact selected | Must decide and disclose before launch |

No app account, analytics SDK, advertising ID, location, contacts, microphone or camera feature is implemented. No public “Data Not Collected” attestation has been submitted. Current manifests declare no tracking/data collection and no required-reason API categories; confirm actual archive/framework API use before keeping these declarations. Do not add canned reason codes without matching API use.

Scope distinction: the existing private Sites website has its own hosting/access environment; it is not embedded by the native app. Public support/privacy hosting and any server logging require separate inventory before launch. Policy draft source: `../still-ios/scripts/legal-pages.mjs`.
