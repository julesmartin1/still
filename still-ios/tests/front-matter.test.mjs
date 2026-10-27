import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findStart,
  contentsLists,
  displayTitle,
  isFirstPart,
  isFrontMatter,
} from "../dist/front-matter.js";
import { bookParts } from "../dist/epub.js";

const prose = (label, words = 80) => `${label} ` + "word ".repeat(words).trim();

test("a chapter one is told from chapter ten, and front matter by name", () => {
  for (const title of [
    "Chapter 1",
    "CHAPTER I. Loomings.",
    "Letter 1",
    "ADVENTURE I. A SCANDAL IN BOHEMIA",
    "I.A Scandal in Bohemia",
    "Book the First",
    "Part One · I",
    "One",
    "Prologue",
    "Chapitre premier",
    "Erstes Kapitel",
  ])
    assert.ok(isFirstPart(title), title);
  for (const title of ["Chapter 10", "Chapter II", "Ice", "In the beginning", "Introduction"])
    assert.ok(!isFirstPart(title), title);
  for (const title of ["Preface", "INTRODUCTION.", "A Note on the Text", "Dedication", "Also by Jane Doe", "Table of Contents"])
    assert.ok(isFrontMatter(title), title);
  assert.ok(!isFrontMatter("Loomings"));
  assert.equal(displayTitle("ETYMOLOGY."), "Etymology");
  assert.equal(displayTitle("EXTRACTS (Supplied by a Sub-Sub-Librarian)."), "Extracts");
});

test("a book starts at its first chapter, past what comes before it", () => {
  const paragraphs = [
    "FRANKENSTEIN",
    "by Mary Shelley",
    "Introduction",
    prose("intro", 300),
    "Letter 1",
    ...Array.from({ length: 30 }, (_, i) => prose("p" + i)),
  ];
  const sections = [
    { title: "Introduction", paragraph: 3 },
    { title: "Letter 1", paragraph: 5 },
    { title: "Letter 2", paragraph: 20 },
  ];
  assert.deepEqual(findStart(paragraphs, sections), {
    paragraph: 5,
    title: "Letter 1",
    before: ["Introduction"],
    skipped: 306, // the words before it, to go back to
  });
  // Where the book itself says its text starts wins.
  assert.equal(findStart(paragraphs, sections, { body: 3 }).paragraph, 3);
  // A book marked as starting on its first page says nothing.
  assert.equal(findStart(paragraphs, sections, { body: 1 }).paragraph, 5);
  // Nothing before: the start is the beginning.
  assert.equal(findStart(paragraphs.slice(4), [{ title: "Letter 1", paragraph: 1 }]).paragraph, 1);
});

test("without numbered chapters, opening front matter and title lines are passed", () => {
  const paragraphs = [
    "MOBY-DICK",
    "Etymology",
    prose("etym", 200),
    "Extracts",
    prose("extracts", 200),
    "Loomings",
    ...Array.from({ length: 40 }, (_, i) => prose("p" + i)),
  ];
  const sections = [
    { title: "MOBY-DICK", paragraph: 1 },
    { title: "ETYMOLOGY.", paragraph: 2 },
    { title: "EXTRACTS.", paragraph: 4 },
    { title: "Loomings", paragraph: 6 },
    { title: "The Carpet-Bag", paragraph: 30 },
  ];
  const start = findStart(paragraphs, sections);
  assert.equal(start.paragraph, 6);
  assert.deepEqual(start.before, ["Etymology", "Extracts"]);
  // Front matter is named by its lines when there are no sections.
  assert.deepEqual(findStart(paragraphs, [], { body: 6 }).before, ["Etymology", "Extracts"]);
  // Only in a book: an article's introduction is where it starts.
  assert.equal(findStart(paragraphs, sections, { book: false }).paragraph, 1);
  // An opening section with real text and no front-matter name is kept.
  const essays = [prose("first essay", 300), "Second", prose("second", 300)];
  assert.equal(
    findStart(essays, [{ title: "Of Truth", paragraph: 1 }, { title: "Second", paragraph: 2 }]).paragraph,
    1,
  );
});

test("a chapter one far into the text is not where it starts", () => {
  const paragraphs = Array.from({ length: 50 }, (_, i) => prose("p" + i));
  const sections = [{ title: "Part One", paragraph: 30 }];
  assert.equal(findStart(paragraphs, sections).paragraph, 1);
});

test("a contents list of links goes, with its heading", () => {
  const paragraphs = [
    "PRIDE AND PREJUDICE",
    "CONTENTS",
    "Chapter 1",
    "Chapter 2",
    "VOLUME II",
    "Chapter 3",
    "Chapter 1",
    prose("It is a truth"),
  ];
  const links = [false, false, true, true, false, true, false, false];
  assert.deepEqual([...contentsLists(paragraphs, links)].sort(), [1, 2, 3, 4, 5]);
  // Two links are a cross-reference, not a list.
  assert.equal(contentsLists(paragraphs, [false, false, true, true]).size, 0);
});

test("a contents list in plain text goes up to the first chapter's own heading", () => {
  const paragraphs = [
    "Frankenstein",
    "CONTENTS",
    "Letter 1",
    "Letter 2",
    "Chapter 1",
    "Chapter 10",
    "Letter 1",
    "To Mrs. Saville, England.",
    prose("You will rejoice"),
    "Letter 2",
    "To Mrs. Saville, England.",
    prose("How slowly"),
    "Chapter 1",
    prose("I am by birth"),
    "Chapter 10",
    prose("I spent the following day"),
  ];
  assert.deepEqual([...contentsLists(paragraphs)].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  // No list without later headings to name.
  assert.equal(contentsLists(["Contents", "Alpha", "Beta", "Gamma", prose("text")]).size, 0);
});

test("a book in parts starts in the part that holds its first chapter", () => {
  const paragraphs = ["Title", "Preface", prose("pre", 40)];
  const sections = [{ title: "Preface", paragraph: 2 }];
  for (let c = 0; c < 6; c++) {
    sections.push({ title: "Chapter " + (c + 1), paragraph: paragraphs.length + 1 });
    for (let p = 0; p < 4; p++) paragraphs.push(prose(`c${c}p${p}`, 50));
  }
  const book = {
    title: "Book",
    text: paragraphs.join("\n\n"),
    sections,
    start: 4,
    before: ["Preface"],
  };
  const parts = bookParts(book, 2400);
  assert.ok(parts.length > 1);
  assert.equal(parts[0].start, 4);
  assert.deepEqual(parts[0].before, ["Preface"]);
  assert.match(parts[0].text.split("\n\n")[3], /^c0p0/);
  for (const part of parts.slice(1)) {
    assert.equal(part.start, 1);
    assert.deepEqual(part.before, []);
  }
});
