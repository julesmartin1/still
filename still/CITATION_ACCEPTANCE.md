# Citation controls: delivery evidence

September 23, 2026.

Implemented: independent per-reading citation/reference-list switches; reversible source text; original paragraph review; source-word position preservation; visible-token timing and progress; punctuation handling; empty-filtered-reading recovery; reference range preview/correction; appendix boundary detection.

37 automated checks pass. The citation fixture set has 108 positive examples and 63 substantive distractors, all passing (100% precision/recall within this deliberately bounded fixture set). Examples cover author-year, multiple sources, narrative citations, bracketed numbers, Unicode surnames, page locators, dates, statistics, acronyms, mathematical intervals, mixed parentheses and closing punctuation. Some cases are systematic format variants; these are not an independently sampled benchmark of arbitrary papers.

Browser verification: toggles preserve the source word even when visible punctuation changes; original citations remain readable in review; settings and position survive reload and bookshelf switching; entirely hidden readings disable playback and can be restored. The supplied paper imports with 261 dictionary-supported line-break repairs and 141 candidate citation spans. Both filters leave 14,147 visible words and skip 3,140. These counts are observations, not separately adjudicated citation-accuracy measurements. Source highlighting was visually checked at the repaired first-page abstract. Phone controls were checked at 390×844. No browser errors were observed.

The regional layout fix removes the demonstrated abstract/Article-history interleaving and assembles displaced font fragments in their baseline. Automated character conservation confirms no non-whitespace characters were dropped or duplicated across any of the 17 pages before optional word repairs. This is not a manual reading-order certification of every table, equation or caption.

Remaining limits: mixed explanatory parentheses stay intact; superscript citation detection and unusual reference styles remain unsupported. Numbered brackets can be ambiguous in mathematical prose, so original review and the off switch remain essential. Unknown line-break spellings are preserved. General table/footnote region exclusion, semantic paragraph reconstruction, and library backup remain subsequent work. Existing imports need re-importing for new layout and word repairs; citation switches work on existing text.
