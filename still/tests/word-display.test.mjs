import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusLetter,
  splitAtFocus,
  fadeDuration,
} from "../dist/word-display.js";

test("focus letter sits about a third of the way into the word", () => {
  assert.deepEqual(splitAtFocus("a"), ["", "a", ""]);
  assert.deepEqual(splitAtFocus("the"), ["t", "h", "e"]);
  assert.deepEqual(splitAtFocus("reading"), ["re", "a", "ding"]);
  assert.deepEqual(splitAtFocus("comprehension"), ["com", "p", "rehension"]);
  assert.equal(focusLetter(20), 4);
});

test("leading punctuation is not counted as a letter", () => {
  assert.deepEqual(splitAtFocus("“Quiet,”"), ["“Q", "u", "iet,”"]);
  assert.deepEqual(splitAtFocus("—"), ["", "—", ""]);
});

test("the three parts always rebuild the word, including emoji and CJK", () => {
  for (const w of ["早晨，", "こんにちは", "naïve", "👍🏽great", "שלום", "x"])
    assert.equal(splitAtFocus(w).join(""), w);
});

test("soft fades stay within 12-40 ms and never exceed 12% of a slow word", () => {
  assert.equal(fadeDuration(230), 28); // default 260 WPM
  assert.equal(fadeDuration(100), 12); // 600 WPM: floor
  assert.equal(fadeDuration(1200), 40); // very slow: cap
  assert.equal(fadeDuration(0), 0);
});
