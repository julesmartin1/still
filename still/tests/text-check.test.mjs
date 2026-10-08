import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkText,
  rejoinLines,
  wrappedLines,
  gutenbergBook,
  decodeText,
  looksLikeMarkdown,
  stripItalics,
  stripMarkdown,
  unwrapParagraphs,
} from "../dist/text-check.js";

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

test("numbered section headings are not mistaken for page headers", () => {
  const body = (i) => "The argument continues at some length".slice(0, 20 + i * 2) + ".";
  const sections = Array.from(
    { length: 8 },
    (_, i) => `Section ${Math.floor(i / 3) + 1}.${(i % 3) + 1}\n\n${body(i)}`,
  ).join("\n\n");
  assert.ok(!checkText(sections).some((f) => f.id === "headers"));
  // The same heading on every page is still a running header.
  const running = Array.from(
    { length: 8 },
    (_, i) => `Chapter 3\n\n${body(i)}`,
  ).join("\n\n");
  assert.ok(checkText(running).some((f) => f.id === "headers"));
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

test("a Project Gutenberg file keeps the book and drops the header and licence", () => {
  const file = [
    "The Project Gutenberg EBook of On the Duty of Civil Disobedience",
    "",
    "Title: On the Duty of Civil Disobedience",
    "       An essay",
    "",
    "Author: Henry David Thoreau",
    "",
    "*** START OF THE PROJECT GUTENBERG EBOOK, ON THE DUTY OF CIVIL DISOBEDIENCE ***",
    "",
    "Produced by a volunteer",
    "and another",
    "",
    "I heartily accept the motto.",
    "",
    "That government is best which governs least.",
    "",
    "End of the Project Gutenberg EBook of On the Duty of Civil Disobedience",
    "",
    "*** END OF THE PROJECT GUTENBERG EBOOK, ON THE DUTY OF CIVIL DISOBEDIENCE ***",
    "",
    "1.A. By reading or using any part of this Project Gutenberg-tm electronic work…",
  ].join("\r\n");
  assert.deepEqual(gutenbergBook(file), {
    title: "On the Duty of Civil Disobedience",
    text: "I heartily accept the motto.\n\nThat government is best which governs least.",
  });
  assert.equal(gutenbergBook("Just an essay about Project Gutenberg."), null);
});

test("text files in Latin-1 / Windows-1252 keep their accents", () => {
  // Bytes 0x80–0x9F (curly quotes, dashes) differ between Latin-1 and
  // Windows-1252; browsers decode them as Windows-1252, Node as Latin-1.
  const latin1 = Uint8Array.from([0x49, 0x62, 0xe1, 0xf1, 0x65, 0x7a, 0x2c, 0x20, 0x64, 0xed, 0x61, 0x73]);
  assert.equal(decodeText(latin1), "Ibáñez, días");
  assert.equal(decodeText(new TextEncoder().encode("Ibáñez — días")), "Ibáñez — días");
});

test("words split by a line-end hyphen are joined", async () => {
  const words = new Set(["example", "something"]);
  const lookup = async (w) => (words.has(w) ? { word: w } : null);
  const text =
    "An exam- ple of some- thing well- known, independent- and free-minded.";
  const finding = checkText(text + " " + text).find((f) => f.id === "split");
  assert.equal(
    await finding.fix(text, lookup),
    "An example of something well-known, independent- and free-minded.",
  );
});

test("front matter at the top is removed, a rule further down is not", () => {
  assert.equal(
    stripMarkdown("---\ntitle: How to do great work\ndate: 2023-07\n---\n\nIf you collected lists."),
    "If you collected lists.",
  );
  assert.equal(
    stripMarkdown('---\ntitle: "Lisp"\ntags: [\'Languages\']\ndescription: >\n    A look back.\n---\nWhen programmers talk.'),
    "When programmers talk.",
  );
  assert.equal(stripMarkdown('+++\ntitle = "Notes"\n+++\nBody.'), "Body.");
  assert.equal(stripMarkdown("Intro.\n\n---\ntitle: kept\n---\nEnd."), "Intro.\n\ntitle: kept\n\nEnd.");
  assert.ok(looksLikeMarkdown("---\ntitle: Notes\n---\nPlain words."));
});

test("links and emphasis wrapping onto the next line are removed, but not across a blank line", () => {
  assert.equal(
    stripMarkdown("In [one\ncomic](https://xkcd.com/224/), a character **reaches\nsome** sort of _Lisp\nenlightenment_."),
    "In one\ncomic, a character reaches\nsome sort of Lisp\nenlightenment.",
  );
  assert.equal(
    stripMarkdown("via [the Flavors\nextension](https://en.wikipedia.org/wiki/Flavors_(programming_language)) were"),
    "via the Flavors\nextension were",
  );
  assert.equal(stripMarkdown("a *star\n\nhere* b"), "a *star\n\nhere* b");
  assert.equal(stripMarkdown("[open\n\nclose](x)"), "[open\n\nclose](x)");
});

test("footnote references go and footnotes become plain paragraphs", () => {
  assert.equal(
    stripMarkdown("Older only than Fortran, by just one year.[^1] Imagine.[^note]\n\n[^1]: McCarthy, 5.\n[^note]: ibid."),
    "Older only than Fortran, by just one year. Imagine.\n\nMcCarthy, 5.\n\nibid.",
  );
});

test("HTML comments, template tags, scripts and tags are removed and entities decoded", () => {
  assert.equal(
    stripMarkdown(
      [
        "A debate.",
        "<!--more-->",
        "",
        "{% include subscribe.html %}As I said in [my post]({% link _posts/x.md %}){{ page.note }}.",
        "",
        '<blockquote class="twitter-tweet"><p lang="en">This week&#39;s post: the &quot;CH&quot; class &amp; more&nbsp;&#8212; <a href="https://t.co/x">link</a></p></blockquote>',
        '<script async src="https://platform.twitter.com/widgets.js">var x = 1;</script>',
      ].join("\n"),
    ),
    "A debate.\n\nAs I said in my post.\n\nThis week's post: the \"CH\" class & more — link",
  );
  assert.equal(stripMarkdown("If x<y and y>z, write &lt;b&gt;."), "If x<y and y>z, write <b>.");
  assert.equal(stripMarkdown("Wrap it in `<em>` or <em>this</em>."), "Wrap it in <em> or this.");
});

test("a quote inside a list item loses its >", () => {
  assert.equal(
    stripMarkdown("1.  A sentence.\n\n    > Professor Harold Laski\n- > quoted item\n> > nested"),
    "1.  A sentence.\n\n    Professor Harold Laski\nquoted item\nnested",
  );
});

test("note numbers like [1] are removed, other brackets stay", () => {
  assert.equal(
    stripMarkdown(
      [
        "The market must not exist.",
        "\\[1\\]",
        "",
        "On sales and marketing. \\[2\\]",
        "Numbers[3]. More alien [sic] and [The Allies] and [12a].",
        "",
        "\\[1\\] Actually Emerson never said it.",
      ].join("\n"),
    ),
    "The market must not exist.\n\nOn sales and marketing.\nNumbers. More alien [sic] and [The Allies] and [12a].\n\nActually Emerson never said it.",
  );
});

test("pasted text is cleaned only when it is plainly Markdown", () => {
  assert.ok(looksLikeMarkdown("# Notes\n\nThe **main** point, see [the paper](https://e.com)."));
  assert.ok(looksLikeMarkdown("# Notes\r\n\r\nThe **main** point is **this** one."));
  assert.ok(!looksLikeMarkdown("She said _it_ was _at once_ and _done_."));
  assert.ok(!looksLikeMarkdown("Shopping:\n- eggs\n- milk\n\n2 * 3 is six."));
  assert.ok(!looksLikeMarkdown("A plain paragraph with **one** bold word."));
  assert.ok(!looksLikeMarkdown("*** START OF THE EBOOK ***\n\nIt was _at once_ ``done,'' he said.\n\n> quoted"));
});

test("underscore italics in plain-text books are removed, snake_case is not", () => {
  assert.equal(
    stripItalics("_It_ was done _at\nonce_, said file_name_here and __init__ and _ _."),
    "It was done at\nonce, said file_name_here and __init__ and _ _.",
  );
  assert.equal(stripItalics("«_¡Olé!_», gritó."), "«¡Olé!», gritó.");
  // An italic verse quotation over two stanzas, with a book's CRLF lines.
  assert.equal(
    stripItalics("Il dit:\r\n\r\n    _Cùm morosa vago\r\n\r\n    singultiet vena._\r\n\r\nEt pouruoyez."),
    "Il dit:\r\n\r\n    Cùm morosa vago\r\n\r\n    singultiet vena.\r\n\r\nEt pouruoyez.",
  );
  assert.equal(stripItalics("a _b\r\n\r\nc_ d"), "a _b\r\n\r\nc_ d");
  const text = "_One_ and _two_ and _three_ marks.";
  const finding = checkText(text).find((f) => f.id === "markdown");
  assert.match(finding.message, /^3 formatting marks \(like _, \*\* or #\)/);
  assert.equal(finding.fix(text), "One and two and three marks.");
});

test("plain-text books read each wrapped paragraph as one", () => {
  const prose =
    "  It was a bright cold day in April, and the clocks were striking\n" +
    "  thirteen. Winston Smith, his chin nuzzled into his breast in an\n" +
    "  effort to escape the vile wind, slipped quickly through the doors.";
  const verse = "      Not a drum was heard,\n      not a funeral note,";
  assert.equal(
    unwrapParagraphs(`${prose}\n\n${verse}\n\n*       *       *\n\n${prose}`),
    [prose.replace(/\n\s*/g, " ").trim(), verse, prose.replace(/\n\s*/g, " ").trim()].join(
      "\n\n",
    ),
  );
});
