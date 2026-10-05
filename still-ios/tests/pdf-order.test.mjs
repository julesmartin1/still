import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutPage, composePdf, markLineJoins } from "../dist/pdf-layout.js";

const item = (str, x, y, width = 180) => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
});

// Two columns whose paragraph gaps line up. The old layout cut the page at
// every full-width gap and read left/right piece by piece.
function alignedGapColumns() {
  const items = [];
  let y = 740;
  for (let block = 0; block < 3; block++) {
    for (let line = 0; line < 4; line++) {
      items.push(
        item(`L${block}.${line}`, 40, y),
        item(`R${block}.${line}`, 320, y),
      );
      y -= 13;
    }
    y -= 30; // paragraph gap in both columns at the same height
  }
  return items;
}

test("columns are read whole even when paragraph gaps line up", () => {
  const page = layoutPage(alignedGapColumns());
  assert.equal(page.columns, 2);
  const order = page.lines.map((l) => l.text);
  const lastLeft = order.findLastIndex((t) => t.startsWith("L"));
  const firstRight = order.findIndex((t) => t.startsWith("R"));
  assert.ok(lastLeft < firstRight, order.join(" "));
});

test("a sentence continuing into the next column stays one paragraph", () => {
  const items = [];
  for (let i = 0; i < 6; i++)
    items.push(
      item(
        i === 5 ? "the study found that" : `Left line ${i}.`,
        40,
        700 - i * 13,
      ),
      item(
        i === 0 ? "participants read faster." : `Right line ${i}.`,
        320,
        700 - i * 13,
      ),
    );
  const page = { number: 1, ...layoutPage(items) };
  const { text } = composePdf([page]);
  assert.match(text, /the study found that participants read faster\./);
});

test("a capitalised line after a finished sentence still starts a new paragraph", () => {
  const items = [];
  for (let i = 0; i < 6; i++)
    items.push(
      item(`Left line ${i}.`, 40, 700 - i * 13),
      item(`Right line ${i}.`, 320, 700 - i * 13),
    );
  const { text } = composePdf([{ number: 1, ...layoutPage(items) }]);
  assert.match(text, /Left line 5\.\n\nRight line 0\./);
});

test("bare page numbers are removed from two-page PDFs", () => {
  const pages = [1, 2].map((n) => ({
    number: n,
    ...layoutPage([
      item(`Body text on page ${n}.`, 40, 700),
      item(String(n), 300, 30, 10),
    ]),
  }));
  const r = composePdf(pages, { removeMargins: true });
  assert.equal(r.removed, 2);
  assert.doesNotMatch(r.text, /(^|\s)[12](\s|$)/);
});

// The cases below are modelled on real two-column papers (ACL, OSDI, JSS),
// using the coordinates PDF.js reported for them. Letter-size pages.
const sized = (str, x, y, width, size) => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});
// Two columns of numbered lines; `left` and `right` replace given lines.
function columns(rows, { left = {}, right = {}, top = 700 } = {}) {
  const items = [];
  for (let i = 0; i < rows; i++) {
    items.push(sized(left[i] ?? `Left ${i}.`, 72, top - i * 13, 218, 10));
    items.push(sized(right[i] ?? `Right ${i}.`, 313, top - i * 13, 218, 10));
  }
  return items;
}

test("a page number centred under two columns comes after both", () => {
  const items = columns(12, {
    left: { 11: "and the sentence carries" },
    right: { 0: "on into the next column." },
  });
  items.push(sized("696", 288, 57, 16, 10));
  const page = layoutPage(items);
  assert.equal(page.lines.at(-1).text, "696");
  const { text } = composePdf([{ number: 1, ...page }]);
  assert.match(text, /and the sentence carries on into the next column\./);
});

test("a short right-column line beside the gutter stays in its column", () => {
  const items = columns(12, { right: { 5: "tions." } });
  items.find((i) => i.str === "tions.").width = 24;
  const order = layoutPage(items).lines.map((l) => l.text);
  assert.ok(
    order.indexOf("tions.") > order.indexOf("Left 11."),
    order.join(" "),
  );
});

test("a first-page footer does not cut a sentence running onto the next page", () => {
  const first = columns(10, {
    right: { 9: "the vocabulary is already huge. In" },
  });
  first.push(
    sized(
      "Proceedings of the 52nd Annual Meeting, pages 624–633,",
      105,
      29,
      380,
      9,
    ),
    sized("© 2014 Association for Computational Linguistics", 123, 21, 330, 9),
  );
  const second = columns(4, {
    left: { 0: "this paper, we introduce an approach." },
  });
  const pages = [first, second].map((items, n) => ({
    number: n + 1,
    ...layoutPage(items, { width: 612, height: 792 }),
  }));
  const { text } = composePdf(pages, { removeMargins: true });
  // The footer follows the paragraph the sentence finishes in.
  assert.match(
    text,
    /already huge\. In this paper, we introduce an approach\.[^\n]*\n\nProceedings of the 52nd[^\n]*Linguistics\n\nRight 0\./,
  );
});

test("a footnote at the foot of a column waits for the sentence to finish", () => {
  const items = columns(10, {
    left: { 9: "the improvement that HMM-T of-" },
    right: { 0: "fers over the old approach." },
  });
  items.push(
    sized("3The distribution can be obtained from", 85, 82, 205, 9),
    sized("the HMM parameters using Bayes Rule.", 72, 72, 205, 9),
  );
  const page = { number: 1, ...layoutPage(items) };
  const lookup = async (w) => w === "offers";
  return markLineJoins([page], lookup).then(() => {
    assert.match(
      composePdf([page]).text,
      /HMM-T offers over the old approach\.[^]*\n\n3The distribution can be obtained from the HMM parameters using Bayes Rule\.$/,
    );
  });
});

test("a caption beside the text is read after it, not line by line between", () => {
  const items = [];
  for (let i = 0; i < 8; i++)
    items.push(
      sized(`Body line ${i} of the text runs on`, 81, 500 - i * 13.5, 253, 10),
    );
  // The caption sits on its own baselines, a few points off the text's.
  for (let i = 0; i < 4; i++)
    items.push(sized(`caption ${i}`, 346, 494 - i * 13.5, 176, 10));
  const order = layoutPage(items).lines.map((l) => l.text);
  assert.deepEqual(order, [
    ...Array.from(
      { length: 8 },
      (_, i) => `Body line ${i} of the text runs on`,
    ),
    ...Array.from({ length: 4 }, (_, i) => `caption ${i}`),
  ]);
});

test("line-end hyphens: compounds keep them, broken words lose them", async () => {
  const words = ["hand", "tagged", "based", "gram", "it"];
  const lines = [
    "we used hand-",
    "tagged data and HMM-",
    "based models with n-",
    "gram counts, which it-",
    "eratively improve be-",
    "cause the state-",
    "of the art.",
  ].map((text, i) => ({
    text,
    x: 40,
    y: 700 - i * 13,
    right: 250,
    top: 710 - i * 13,
    height: 10,
  }));
  const page = { number: 1, width: 612, height: 792, lines };
  await markLineJoins([page], async (w) => words.includes(w.toLowerCase()));
  assert.equal(
    composePdf([page]).text,
    "we used hand-tagged data and HMM-based models with n-gram counts, which iteratively improve because the state- of the art.",
  );
});

test("a compound broken at a hyphen keeps its hyphen however short its pieces", async () => {
  const lines = [
    "commanding an American sloop-",
    "of-war of the first class, and a tete-a-",
    "tete with Mrs. Bennet. Rig-",
    "a-dig, dig, dig!",
  ].map((text, i) => ({
    text,
    x: 40,
    y: 700 - i * 13,
    right: 250,
    top: 710 - i * 13,
    height: 10,
  }));
  const page = { number: 1, width: 612, height: 792, lines };
  await markLineJoins([page], async () => null);
  assert.equal(
    composePdf([page]).text,
    "commanding an American sloop-of-war of the first class, and a tete-a-tete with Mrs. Bennet. Rig-a-dig, dig, dig!",
  );
});

test("a word hyphenated at the foot of a column joins the next column", async () => {
  const items = columns(6, {
    left: { 5: "for the dimen-" },
    right: { 0: "sions of the space." },
  });
  const page = { number: 1, ...layoutPage(items) };
  await markLineJoins(
    [page],
    async (w) => w === "dimensions" || w === "dimension",
  );
  assert.match(composePdf([page]).text, /for the dimensions of the space\./);
});
