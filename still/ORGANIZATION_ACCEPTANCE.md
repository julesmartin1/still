# Reading organization: acceptance results

Implemented and checked September 23, 2026.

| Feature | Evidence |
| --- | --- |
| Document type | Book inferred from chapter headings; academic type inferred for the research paper; manual override persisted. Existing citation-enabled readings migrate to Academic paper. |
| Cleaner reader | Main screen has Reading settings and section navigation. Books show no citation controls. Other keeps citation options collapsed; academic settings expose them. Phone layout checked at 390×844. |
| Better titles | Extractor returns the supplied paper's complete article title instead of the journal name or filename. Metadata and first-page fallback tests pass. Titles stay editable. |
| Duplicate PDFs | Same file detected, including older library PDFs without fingerprints. Reopen returned a saved copy at word 3 and 333 WPM. Separate-copy route proceeds without replacing the original. |
| Chapters and sections | Book headings detected; navigation returned to Chapter One. A renamed Chapter Two survived reload. Heading labels and original-paragraph anchors are editable. |
| Starting point | Import preview selected Chapter Two and opened at its exact first token. Earlier chapters remained navigable. |
| Per-reading pace | Switching between entries restored independent 340 and 333 WPM settings. Pace/profile are included in backups. Older entries have no historical per-book pace to recover, so they adopt the current setting on first opening. |
| Backup and restore | Actual browser download decoded successfully: 12 readings, 4 PDFs, about 6.5 MB. Restoring it through the UI produced separate copies and retained originals. A restored PDF rendered the correct source line; its position, pace and headings survived. Invalid-file validation and serialization round-trip tests pass. |

44 automated tests pass, including the existing citation, playback, timing and PDF regression checks. No console errors observed during browser QA.

Title/type/heading detection remains a suggestion, not a guaranteed understanding of every document. Files with unusual layouts may need manual correction. Backups are device-local downloads, limited to 250 MB; no accounts or cloud synchronization were added. Books here are PDFs or pasted text; this change does not add EPUB or Kindle integration.
