# Threat model — development candidate

Assets: private reading text, original files, notes, progress, exported backups, executable app assets and signing credentials. Actors: malformed/malicious imported documents, unintended export recipients, users of an unlocked/shared device, compromised dependencies and accidental storage failures. Rooted/jailbroken OS protection and absolute secrecy on an unlocked phone are not promised.

Boundaries and controls:
- Files → parsers: user-selected bytes; 50 MB imports, expanded ZIP limits, integrity/header/path checks, XML depth/node/text limits, no imported markup injection, PDF eval disabled, PDF render budget and extraction timeout. Mutation tests cover selected cases; sustained fuzzing/device memory testing remains open.
- Web renderer → native: trusted bundled main frame only; explicit script-message origin/frame proxy; no frames by CSP; native origin recheck; a limited storage/export interface; opaque generated disk filenames; serialized transactions.
- Renderer → network: no remote fonts, bundled dictionary, CSP same-origin connections and native navigation whitelist. Only selected HTTPS links open externally. Confirm on actual device network capture before asserting no outbound requests.
- Vault → disk: iOS complete file protection requested; corruption fails closed; atomic manifest switches; cleanup obsolete objects. macOS tests verify transaction mechanics, not iOS encryption/lock-state behavior.
- App → export recipient: explicit share action; readable, unencrypted JSON with clear user notice; temporary export cleanup. Device backup and recipient retention are outside app control.
- App → background snapshot: neutral scene cover and pause/flush request; needs device testing for interrupts and race timing.
- Build → release: exact dependencies, integrity lockfile, runtime/vendor inventory, release checklist that currently fails, no remote code updates or secrets in source.

No backend/accounts currently exist, so server authentication, password storage and tenant authorization are not applicable. Reassess these boundaries before adding any cloud service, telemetry, purchases or account system. A clean scan does not cover business logic or native runtime vulnerabilities.
