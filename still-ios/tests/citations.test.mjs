import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citationSpans,
  filteredReading,
  visibleIndex,
  referenceRange,
} from "../dist/citations.js";
import { buildTimingPlan, minimumWordTime } from "../dist/engine.js";
const positives = [
  "(Canivez, Watkins, & Dombrowski, 2015; Dombrowski, Canivez, Watkins, & Beaujean, 2015)",
  "(Canivez, Watkins, & Dombrowski, 2016; Chen, Zhang, Raiford, Zhu, & Weiss, 2015)",
  "(Keith & Witta, 1997, p. 89)",
  "(Carroll, 1993; Horn & Blankson, 2005)",
  "(Wechsler, 2014, p. 23)",
  "(Kaufman, Flanagan, Alfonso, & Mascolo, 2006, p. 293)",
  "(Keith, Fine, Taub, Reynolds, & Kranzler, 2006)",
  "(see Carroll, 1993)",
  "(e.g., Carroll, 1993)",
  "(cf. Carroll, 1993)",
  "(García, 2020)",
  "(O’Connor, 2019)",
  "(Smith-Jones, 2018)",
  "(van Gogh, 2010)",
  "(Smith, 2020a, 2020b)",
  "(Smith et al., 2020)",
  "(Smith and Jones, 2020)",
  "(Smith, Jones, and Brown, 2020)",
  "(Smith, 2020, pp. 12–14)",
  "(Smith,\n2020)",
  "(Smith, 2020;\nJones, 2021)",
  "[1]",
  "[12–14]",
  "[2, 5, 8]",
  "[1-3, 7]",
  ...[
    "Carroll",
    "Wechsler",
    "Reynolds",
    "Keith",
    "Dombrowski",
    "Canivez",
    "Chen",
    "Watkins",
    "Johnson",
    "Kaufman",
    "Murray",
    "Schneider",
    "McGrew",
    "Horn",
    "Spearman",
    "Thurstone",
    "Meredith",
    "Salthouse",
    "Tobin",
    "Woodcock",
  ].flatMap((name) => [
    `(${name}, 2003)`,
    `(${name} et al., 2015)`,
    `(${name} & Smith, 2016)`,
    `(${name}, 2017, p. 89)`,
  ]),
  "Smith (2020) found a difference.",
  "Smith and Jones (2020) found a difference.",
  "Reynolds et al. (2013) found a difference.",
];
const negatives = [
  "(p < .05)",
  "(n = 240)",
  "(95% CI)",
  "(WISC-V)",
  "(g)",
  "(2017)",
  "[0.2, 0.8]",
  "[0]",
  "[2020]",
  "(WISC-V; Wechsler, 2014)",
  "(WISC-IV; Wechsler, 2003)",
  "(as discussed in 2020)",
  "(born 2014)",
  "(in 2016)",
  "(from 2014 to 2016)",
  "(version 2020)",
  "(Copyright 2020)",
  "(Experiment 2014)",
  "(range 12–14)",
  "(Figure 2)",
  "(Table 4)",
  "(Equation 3)",
  "(see Appendix A)",
  "(2000 participants)",
  "array [12]",
  "matrix [12]",
  "vector [12]",
  "index [12]",
  "interval [12–14]",
  "range [12–14]",
  "value [12]",
  "x[12]",
  ...[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "Spring",
    "Summer",
    "Autumn",
    "Winter",
    "Study",
    "Report",
    "Edition",
    "Copyright",
    "Intelligence",
    "Publication",
    "Version",
  ].map((w) => `${w} (2020)`),
  "(Smith, 2020; useful explanation)",
  "(including Smith, 2020)",
  "(see results from 2014)",
  "(data collected in 2014)",
  "ages [12–14]",
  "x = [1, 2]",
  "(t = 2.02)",
  "(F(1, 20) = 4.0)",
];
test("labelled citation fixtures: author-year, numbered, narrative and substantive distractors", () => {
  const missed = positives.filter((s) => citationSpans(s).length !== 1),
    incorrect = negatives.filter((s) => citationSpans(s).length);
  assert.deepEqual(missed, []);
  assert.deepEqual(incorrect, []);
  console.log(
    `Citation fixtures: ${positives.length} positive, ${negatives.length} negative; no false removals.`,
  );
});
test("filtering preserves source anchors, punctuation, paragraph order and exact unfiltered text tokens", () => {
  const text =
    "The effect persisted (Smith, 2020). More text [12–14].\n\nSmith (2020) found (n = 240) cases.";
  const full = filteredReading(text),
    r = filteredReading(text, { skipCitations: true });
  assert.equal(
    r.paragraphs.join("\n\n"),
    "The effect persisted. More text.\n\nSmith found (n = 240) cases.",
  );
  assert.equal(r.tokens[2].sourceIndex, 2);
  assert.equal(r.tokens[2].sourceEnd, 4);
  assert.equal(r.tokens[3].sourceIndex, 5);
  assert.equal(visibleIndex(r.tokens, 5), 3);
  assert.equal(
    full.tokens.map((t) => t.text).join(" "),
    text.replace(/\s+/g, " "),
  );
  const plan = buildTimingPlan(r.tokens, { base: 300 });
  assert.ok(plan.every((ms) => ms >= minimumWordTime(200) - 1e-8));
  assert.ok(
    Math.abs(plan.reduce((a, b) => a + b, 0) - r.tokens.length * 200) < 1e-6,
  );
});
test("reference range ends before appendix, and overrides do not delete original text", () => {
  const text =
    "Body.\n\nReferences\n\nSmith (2020).\n\nAppendix A\n\nAdditional results.";
  assert.deepEqual(referenceRange(text), { start: 2, end: 3 });
  const r = filteredReading(text, { skipReferences: true });
  assert.equal(
    r.paragraphs.join("\n\n"),
    "Body.\n\nAppendix A\n\nAdditional results.",
  );
  assert.equal(r.original.paragraphs.length, 5);
  assert.equal(
    filteredReading(text, {
      skipReferences: true,
      referenceRange: { start: 1, end: 5 },
    }).tokens.length,
    0,
  );
});
test("citation-only passages have no tokens and a source selection after the last visible word finishes", () => {
  assert.equal(
    filteredReading("(Smith, 2020)", { skipCitations: true }).tokens.length,
    0,
  );
  const r = filteredReading("Body. (Smith, 2020)", { skipCitations: true });
  assert.equal(visibleIndex(r.tokens, 2), 1);
});

test("closing quotes attach to the preceding word after a citation is skipped", () => {
  const r = filteredReading("He said “yes (Smith, 2020).”", {
    skipCitations: true,
  });
  assert.deepEqual(
    r.tokens.map((t) => t.text),
    ["He", "said", "“yes.”"],
  );
  assert.equal(
    filteredReading("(Smith, 2020).", { skipCitations: true }).tokens.length,
    0,
  );
});

test("legacy PDF digit-one parentheses, page-range encoding and see-also groups are recognized", () => {
  const citations = [
    "1Cowlishaw & Dunbar, 1991; Ellis, 1995)",
    "1Krackle, 1978)",
    "1see also Maybury-Lewis, 1965, pp. 215±240, 1967, pp. 175±178)",
    "1see also Arvelo de JimeÂnez, 1971, pp. 239±243; Clastres, 1998; Goldman, 1979; Huxley, 1966, pp. 66±73; LeÂvi-Strauss, 1944)",
    "1Cowlishaw &\n\nDunbar, 1991; Ellis, 1995)",
    "(see also Maybury-Lewis, 1965, pp. 215–240, 1967, pp. 175–178)",
    "Huxley 11966) found a difference.",
  ];
  for (const s of citations) assert.equal(citationSpans(s).length, 1, s);
  for (const s of [
    "11) in males",
    "12) in females",
    "1e.g., grooming, submissive displays, yielding space, etc.)",
    "1n = 240)",
    "1p < .05)",
    "1from 1965 to 1967)",
    "1WISC-V; Wechsler, 2014)",
  ])
    assert.equal(citationSpans(s).length, 0, s);
  const r = filteredReading(
    "Evidence suggests fitness 1Cowlishaw & Dunbar, 1991; Ellis, 1995). These styles remain.",
    { skipCitations: true },
  );
  assert.equal(
    r.tokens.map((t) => t.text).join(" "),
    "Evidence suggests fitness. These styles remain.",
  );
  assert.equal(r.tokens[3].sourceIndex, 9);
});

test("ordinary years before a broken citation do not swallow the citation match", () => {
  const text = "In 1966 this happened. Evidence 1Smith, 2020) follows.";
  assert.equal(citationSpans(text).length, 1);
  assert.equal(
    filteredReading(text, { skipCitations: true })
      .tokens.map((t) => t.text)
      .join(" "),
    "In 1966 this happened. Evidence follows.",
  );
});
