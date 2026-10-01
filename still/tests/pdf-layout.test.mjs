import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutPage, composePdf, sourceLocation } from "../dist/pdf-layout.js";
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
      text: "order and unknown-",
      x: 40,
      y: 674,
      right: 200,
      top: 684,
      height: 10,
    },
    { text: "suffix.", x: 40, y: 661, right: 200, top: 671, height: 10 },
  ];
  const pages = [{ number: 1, width: 612, height: 792, lines }];
  assert.equal(
    await markLineJoins(pages, async (w) =>
      ["continuity", "higher-order"].includes(w.toLowerCase()),
    ),
    2,
  );
  const r = composePdf(pages);
  assert.equal(
    r.text,
    "Test continuity with higher-order and unknown- suffix.",
  );
  assert.equal(parseText(r.text).tokens.length, 7);
  assert.equal(r.locations.at(-1).end, 6);
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
