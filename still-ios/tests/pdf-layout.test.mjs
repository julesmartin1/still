import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutPage,
  composePdf,
  sourceLocation,
  contentsLine,
  splitLongDialogue,
} from "../dist/pdf-layout.js";
import { parseText } from "../dist/engine.js";
const item = (str, x, y, width = 180) => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
});
test("two columns read down the left then down the right despite interleaved source order", () => {
  const items = [];
  for (let i = 0; i < 8; i++)
    items.push(
      item("Left " + i, 40, 700 - i * 13),
      item("Right " + i, 320, 700 - i * 13),
    );
  const p = layoutPage(items);
  assert.equal(p.columns, 2);
  assert.deepEqual(
    p.lines.map((l) => l.text),
    [
      ...Array.from({ length: 8 }, (_, i) => "Left " + i),
      ...Array.from({ length: 8 }, (_, i) => "Right " + i),
    ],
  );
});
test("spanning headings split columns into top-to-bottom sections without losing items", () => {
  const items = [item("Full heading", 40, 750, 470)];
  for (let i = 0; i < 8; i++)
    items.push(
      item("Left " + i, 40, 700 - i * 13),
      item("Right " + i, 320, 700 - i * 13),
    );
  items.push(
    item("Another heading", 40, 570, 470),
    item("Bottom left", 40, 540),
    item("Bottom right", 320, 540),
  );
  const p = layoutPage(items);
  assert.equal(p.lines.length, 20);
  assert.equal(p.lines[0].text, "Full heading");
  assert.deepEqual(
    p.lines.slice(-3).map((l) => l.text),
    ["Another heading", "Bottom left", "Bottom right"],
  );
});
test("single-column prose is not split and explicit one-column override works", () => {
  const items = Array.from({ length: 8 }, (_, i) =>
    item("A full line " + i, 40, 700 - i * 13, 470),
  );
  assert.equal(layoutPage(items).columns, 1);
  assert.equal(layoutPage(items, { mode: "single" }).lines.length, 8);
});
test("page ranges and repeated margins keep token-to-source positions correct", () => {
  const pages = Array.from({ length: 4 }, (_, i) => ({
    number: i + 1,
    ...layoutPage([
      item("Journal " + (i + 1), 40, 770),
      item("Page " + (i + 1) + " body.", 40, 700),
    ]),
  }));
  const r = composePdf(pages, { from: 2, to: 3, removeMargins: true });
  assert.equal(r.removed, 2);
  assert.equal(r.text, "Page 2 body.\n\nPage 3 body.");
  assert.equal(parseText(r.text).tokens.length, 6);
  assert.equal(sourceLocation(r.locations, 0).page, 2);
  assert.equal(sourceLocation(r.locations, 5).page, 3);
  assert.equal(sourceLocation(r.locations, 6), null);
});

test("full-width front matter does not hide two-column body text", () => {
  const items = Array.from({ length: 30 }, (_, i) =>
    item("Full width " + i, 40, 1200 - i * 13, 480),
  );
  for (let i = 0; i < 8; i++)
    items.push(
      item("Left " + i, 40, 700 - i * 13),
      item("Right " + i, 320, 700 - i * 13),
    );
  const p = layoutPage(items);
  assert.equal(p.columns, 2);
  assert.equal(p.lines.length, 46);
  assert.deepEqual(
    p.lines.slice(-8).map((l) => l.text),
    Array.from({ length: 8 }, (_, i) => "Right " + i),
  );
});

test("narrow article sidebar stays separate from abstract and font fragments stay in the same line", () => {
  const items = [];
  for (let i = 0; i < 8; i++) {
    items.push(item("Metadata " + i, 40, 700 - i * 12, 100));
    items.push(
      item("Abstract " + i, 210, 700 - i * 12, 130),
      item(" continued", 340, 700 - i * 12, 150),
    );
  }
  items.push(item("Introduction", 40, 570, 470));
  for (let i = 0; i < 8; i++)
    items.push(
      item("Body left " + i, 40, 540 - i * 13, 180),
      item("Body right " + i, 320, 540 - i * 13, 180),
    );
  const p = layoutPage(items);
  const abstract = p.lines.filter((l) => l.text.startsWith("Abstract"));
  assert.equal(abstract.length, 8);
  assert.ok(abstract.every((l) => l.text.endsWith("continued")));
  assert.deepEqual(
    p.lines.slice(0, 8).map((l) => l.text),
    Array.from({ length: 8 }, (_, i) => "Metadata " + i),
  );
  assert.equal(p.lines[8].text, "Abstract 0 continued");
});
test("verified line-break repair retains compounds, ambiguous spelling and source mapping", async () => {
  const { markLineJoins } = await import("../dist/pdf-layout.js");
  const lines = [
    { text: "Test conti-", x: 40, y: 700, right: 200, top: 710, height: 10 },
    {
      text: "nuity with higher-",
      x: 40,
      y: 687,
      right: 200,
      top: 697,
      height: 10,
    },
    {
      text: "order and state-",
      x: 40,
      y: 674,
      right: 200,
      top: 684,
      height: 10,
    },
    { text: "of play.", x: 40, y: 661, right: 200, top: 671, height: 10 },
  ];
  const pages = [{ number: 1, width: 612, height: 792, lines }];
  assert.equal(
    await markLineJoins(pages, async (w) =>
      ["continuity", "higher-order"].includes(w.toLowerCase()),
    ),
    2,
  );
  const r = composePdf(pages);
  assert.equal(r.text, "Test continuity with higher-order and state- of play.");
  assert.equal(parseText(r.text).tokens.length, 8);
  assert.equal(r.locations.at(-1).end, 7);
  assert.equal(r.locations[1].start, 1);
  assert.equal(sourceLocation(r.locations, 1).focusIndex, 1);
});
test("book paragraphs are found by first-line indent and short last lines", () => {
  const line = (text, x, y, right) => ({
    text,
    x,
    y,
    right,
    top: y + 10,
    height: 10,
  });
  const page = {
    number: 1,
    width: 400,
    height: 600,
    lines: [
      line("The first paragraph runs across", 40, 500, 360),
      line("the whole line and then ends.", 40, 487, 250),
      line("A second one starts indented and", 55, 474, 360),
      line("keeps going to the margin. It", 40, 461, 360),
      line("ends here.", 40, 448, 120),
      line("No indent but the line above was short.", 40, 435, 340),
      line("“A quoted line”, he said, “that", 40, 422, 360),
      line("wraps” is still the same paragraph.", 40, 409, 360),
    ],
  };
  const paragraphs = composePdf([page]).text.split("\n\n");
  assert.deepEqual(paragraphs, [
    "The first paragraph runs across the whole line and then ends.",
    "A second one starts indented and keeps going to the margin. It ends here.",
    "No indent but the line above was short. “A quoted line”, he said, “that wraps” is still the same paragraph.",
  ]);
});
test("table-of-contents entries land on the line they point at", async () => {
  const { outlineSections } = await import("../dist/pdf-layout.js");
  const { readOutline } = await import("../dist/pdf-import.js");
  const ref = { num: 7 };
  const doc = {
    getOutline: async () => [
      {
        title: "Part One",
        dest: [0, { name: "Fit" }],
        items: [
          { title: "  Chapter   1 ", dest: "c1", items: [] },
          {
            title: "Chapter 2",
            dest: [ref, { name: "XYZ" }, 0, 300, null],
            items: [],
          },
        ],
      },
      { title: "Broken", dest: null, items: [] },
    ],
    getDestination: async () => [0, { name: "XYZ" }, 0, 500, null],
    getPageIndex: async (r) => (r === ref ? 1 : 0),
  };
  const outline = await readOutline(doc);
  assert.deepEqual(
    outline.map((o) => [o.title, o.page, o.top, o.depth]),
    [
      ["Part One", 1, null, 0],
      ["Chapter 1", 1, 500, 1],
      ["Chapter 2", 2, 300, 1],
    ],
  );
  const text =
    "Part One\n\nChapter 1\n\nSome words here.\n\nChapter 2\n\nMore words.";
  const loc = (page, top, start, end) => ({
    page,
    rect: [0, top - 10, 100, top],
    start,
    end,
  });
  const locations = [
    loc(1, 600, 0, 1),
    loc(1, 490, 2, 3),
    loc(1, 470, 4, 6),
    loc(2, 600, 7, 7),
    loc(2, 290, 7, 8),
    loc(2, 270, 9, 10),
  ];
  // The second page's first line (top 600) is above Chapter 2's link point.
  locations[3] = loc(2, 600, 7, 6);
  assert.deepEqual(outlineSections(outline, { text, locations }), [
    { title: "Part One", paragraph: 1 },
    { title: "Chapter 1", paragraph: 2 },
    { title: "Chapter 2", paragraph: 4 },
  ]);
});

test("contents lines with dot leaders are recognised and skipped", () => {
  assert.ok(contentsLine("Chapter 1....................................5"));
  assert.ok(contentsLine("Preface . . . . . . . . . xi"));
  assert.ok(
    contentsLine("Letter 1..........3 Letter 2..........6 Letter 3.......9"),
  );
  assert.ok(!contentsLine("He waited.... 5 minutes passed."));
  assert.ok(!contentsLine("And then.... nothing."));
  const lines = [
    "Contents",
    "Chapter 1.............5",
    "It was a fine day.",
  ].map((text, i) => ({
    text,
    x: 40,
    y: 700 - i * 30,
    right: 250,
    top: 710 - i * 30,
    height: 10,
  }));
  const out = composePdf([{ number: 1, width: 612, height: 792, lines }]);
  assert.equal(out.contents, 1);
  assert.equal(out.text, "Contents\n\nIt was a fine day.");
});

test("a chapter printed as one block is split where the speaker changes", () => {
  const filler = Array.from({ length: 420 }, () => "word").join(" ");
  const block = `${filler}. "She did, indeed, Louisa." "Not at all," he replied.`;
  const out = splitLongDialogue(block);
  assert.ok(out.endsWith('Louisa."\n\n"Not at all," he replied.'), out);
  assert.equal(out.split("\n\n").length, 2);
  assert.equal(parseText(out).tokens.length, parseText(block).tokens.length);
  const short = '"Yes." "No."';
  assert.equal(splitLongDialogue(short), short);
});

test("letter-spaced headings are read as words", () => {
  const p = layoutPage([
    item("V", 100, 700, 9.8),
    item(" ", 109.9, 700, 5),
    item("i n c e n t e", 113.5, 700, 56.4),
    item(" ", 169.9, 700, 14.7),
    item("B L A S C O", 180.6, 700, 74),
    item("A normal line of text follows here.", 40, 680, 300),
  ]);
  assert.deepEqual(
    p.lines.map((l) => l.text),
    ["Vincente BLASCO", "A normal line of text follows here."],
  );
});

test("a Project Gutenberg PDF starts at the book and stops before the licence", () => {
  const lines = [
    "The Project Gutenberg EBook of Walden",
    "Title: Walden",
    "*** START OF THIS PROJECT GUTENBERG EBOOK",
    "WALDEN ***",
    "Produced by a kind volunteer and the",
    "Online Distributed Proofreading Team.",
    "Walden",
    "When I wrote the following pages I lived alone.",
    "End of the Project Gutenberg EBook of Walden",
    "Section 1. General Terms of Use.",
  ];
  const pages = [0, 1].map((n) => ({
    number: n + 1,
    ...layoutPage(
      lines
        .slice(n * 5, n * 5 + 5)
        .map((text, i) => item(text, 40, 700 - i * 30, 300)),
    ),
  }));
  const r = composePdf(pages);
  assert.equal(
    r.text,
    "Walden\n\nWhen I wrote the following pages I lived alone.",
  );
  assert.equal(r.gutenberg, true);
  assert.equal(r.gutenbergTitle, "Walden");
  assert.equal(sourceLocation(r.locations, 0).page, 2);
  assert.equal(composePdf(pages, { from: 2, to: 2 }).text, r.text);
});
