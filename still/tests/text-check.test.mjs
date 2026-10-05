import { test } from "node:test";
import assert from "node:assert/strict";
import { checkText, rejoinLines, wrappedLines } from "../dist/text-check.js";

const wrapped = [
  "4 May 1771",
  "How happy I am to be away! My dear friend, what a thing is",
  "the heart of Man! To leave you, whom I love so, from whom I",
  "was inseparable, and to be happy! I know that you will for-",
  "give me. Were not my other attachments hand-picked by Fate",
  "to beset a heart such as mine with fears? Poor Leonore!",
  "",
  "And yet I was innocent. Was it my fault that, while I was",
  "taking pleasure and amusement in the wilful charms of her",
  "",
  "sister, a passion was growing in that poor heart? And yet I",
  "promise I shall improve, and will not keep on chewing over.",
  "10 May",
  "A wonderful serenity has taken possession of my entire soul,",
  "like these sweet mornings of spring which I enjoy with all",
  "my heart. I am alone, and feel the charm of existence here.",
].join("\n");

test("printed line breaks are found and rejoined into paragraphs", () => {
  assert.ok(wrappedLines(wrapped));
  assert.deepEqual(rejoinLines(wrapped).split("\n\n"), [
    "4 May 1771",
    "How happy I am to be away! My dear friend, what a thing is the heart of Man! To leave you, whom I love so, from whom I was inseparable, and to be happy! I know that you will forgive me. Were not my other attachments hand-picked by Fate to beset a heart such as mine with fears? Poor Leonore!",
    "And yet I was innocent. Was it my fault that, while I was taking pleasure and amusement in the wilful charms of her sister, a passion was growing in that poor heart? And yet I promise I shall improve, and will not keep on chewing over.",
    "10 May",
    "A wonderful serenity has taken possession of my entire soul, like these sweet mornings of spring which I enjoy with all my heart. I am alone, and feel the charm of existence here.",
  ]);
  assert.ok(checkText(wrapped).some((f) => f.id === "wrapped"));
  assert.ok(!checkText(rejoinLines(wrapped)).some((f) => f.id === "wrapped"));
});

test("ordinary paragraphs raise nothing", () => {
  const text =
    "The morning was quiet.\n\nShe walked to the river and sat for a while, watching the light.\n\nThen she went home.";
  assert.deepEqual(checkText(text), []);
});

test("headers, page numbers, odd characters, split words and note numbers", () => {
  const page = (n) =>
    `THE SORROWS OF YOUNG WERTHER\n\nThe ɹrst exam- ple of a garden${n} and more words here.\n\n${n}`;
  const text = Array.from({ length: 6 }, (_, i) => page(i + 1)).join("\n\n");
  const ids = checkText(text).map((f) => f.id);
  assert.deepEqual(ids, ["odd", "pages", "headers", "split", "notes"]);
  const headers = checkText(text).find((f) => f.id === "headers");
  assert.ok(!headers.fix(text).includes("WERTHER"));
  const pages = checkText(text).find((f) => f.id === "pages");
  assert.ok(!/^\d+$/m.test(pages.fix(text)));
});

test("dated letters are not mistaken for page headers", () => {
  const text = Array.from(
    { length: 8 },
    (_, i) => `${i + 1} May\n\n${"Another letter arrived with news".slice(0, 12 + i * 2)}.`,
  ).join("\n\n");
  assert.ok(!checkText(text).some((f) => f.id === "headers"));
});

test("Markdown symbols are flagged and removed, keeping the words", () => {
  const text = [
    "## Reading notes ##",
    "",
    "The **main** point is _attention_, see [the paper](https://example.com/p) and `RSVP`.",
    "",
    "- [x] read chapter 1",
    "* skim chapter 2",
    "",
    "> A quote with an escaped \\*star\\*.",
    "",
    "---",
    "",
    "| Pace | Words |",
    "|------|-------|",
    "| 260 | 1200 |",
    "",
    "```",
    "let x = 1;",
    "```",
    "",
    "![A chart](chart.png) and <https://example.com> ~~old~~ new.",
    "",
    "[ref]: https://example.com",
  ].join("\n");
  const finding = checkText(text).find((f) => f.id === "markdown");
  assert.ok(finding && finding.ranges.length);
  assert.equal(
    finding.fix(text),
    [
      "Reading notes",
      "The main point is attention, see the paper and RSVP.",
      "read chapter 1\nskim chapter 2",
      "A quote with an escaped *star*.",
      "Pace, Words",
      "260, 1200",
      "let x = 1;",
      "A chart and https://example.com old new.",
    ].join("\n\n"),
  );
  assert.ok(!checkText(finding.fix(text)).some((f) => f.id === "markdown"));
});

test("plain text with dashes, asterisks and underscores is not taken for Markdown", () => {
  const text = [
    "She paused - then went on. 2 * 3 is six, and file_name_here stays.",
    "",
    "Shopping:",
    "- eggs",
    "- milk",
    "- bread",
    "",
    "A footnote marker* is fine too.",
  ].join("\n");
  assert.ok(!checkText(text).some((f) => f.id === "markdown"));
});
