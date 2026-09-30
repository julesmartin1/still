import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutPage, composePdf } from "../dist/pdf-layout.js";

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
