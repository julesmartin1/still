# Operating the released app — ownership pending

Publisher/support owner and public contact are release blockers. Do not launch with a dead or private-only support URL.

Support process: ask for app/OS version and concise reproduction first. Never request whole books, notes or backups by default. If an example is necessary, ask for a minimal redacted excerpt or rights-cleared sample; disclose destination and retention. Establish mailbox access and deletion/retention policies before publication.

Incident process: triage data loss, privacy leaks, code execution and crashes first; preserve redacted evidence; identify affected versions/dependencies; restrict distribution if warranted; prepare a verified patch and accurate owner/user communications. Regulatory/contractual notice obligations depend on incident and jurisdiction; escalate to publisher/counsel. No automatic publication of private details.

Maintenance: review upstream Capacitor/PDF.js advisories before every release and assign a regular owner review cadence. Automated schedules have not been created. Keep lockfiles, vendor hashes, license notices, supported-OS matrix and privacy declarations current. Do not add tracking merely to monitor usage.

Release procedure: preserve the previous source tag/archive; verify backups and migrations before update; use a controlled release strategy selected by the owner; monitor approved beta/support feedback and platform crash information consistent with disclosures. A mobile rollback usually requires a new reviewed build; never promise instant rollback of installed data or store distribution.

Data recovery: never silently reset corrupt libraries. Advise keeping the app installed, unlocking and retrying. Restore a known backup as copies. Manual vault-repair tooling is not implemented; do not tell users to delete/reinstall as a default fix. Test a recovery path on device before launch.

Acceptance: named support/incident owner; public contact tested; privacy/rights intake defined where applicable; beta cohort approval; dependency cadence assigned; backup/update recovery demonstrated. All remain open until evidence exists.
