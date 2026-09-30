# OWASP MASVS applicability — development review

This is a family-level starting matrix, not an OWASP certification or a completed MASTG assessment. Expand to specific current controls/test IDs during native security verification.

| Family | Applies | Implemented work | Required evidence still missing |
|---|---|---|---|
| STORAGE | Yes | Protected vault, atomic operations, nonpersistent web cache, explicit export/delete | Device filesystem/backup/lock tests and leak inspection |
| CRYPTO | OS protection applies; no custom crypto | Uses platform file protection; no embedded keys/custom algorithm | Signed build configuration and lock-state tests |
| AUTH | No app accounts currently | No auth backend or password store | Reassess before any accounts/sync/purchases |
| NETWORK | Yes, even with local-first design | Bundled assets, CSP, no remote fonts, deliberate external links only | Native traffic capture and negative external-navigation tests |
| PLATFORM | Yes | Native Files path, minimal plugin, main-frame/origin checks, no requested sensitive permissions | Actual bridge/file-provider/export/scene testing and entitlement inspection |
| CODE | Yes | Pinned dependencies, parsing bounds, malformed-file tests, safe text rendering | Sustained fuzzing, device resource tests, iOS build/archive analysis |
| RESILIENCE | Risk-based | No client secrets; no claim to resist compromised OS | Assess tamper/debug/repackaging impact; no gratuitous anti-accessibility controls |
| PRIVACY | Yes | Data inventory, no tracking SDK, drafts and deletion controls | Final identity/policies, archive manifests and traffic evidence |

References: https://mas.owasp.org/MASVS/ and https://mas.owasp.org/MASTG/ . Review current controls when executing the native assessment.
