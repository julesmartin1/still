"""Browser tests for Still's interface (keyboard, dialogs, storage, bookshelf).

The unit tests (npm test) cover reading logic; these cover the glue around it,
which is where most real bugs have been found.

Setup, once:
    pip install playwright
    python -m playwright install chromium
Run from the still/ folder:
    python3 tests/ui/run.py

It starts its own copy of the server on port 4199 (set STILL_UI_PORT to use
another) and prints one line per check. Exit code is non-zero if anything
fails.
"""
import asyncio
import datetime
import json
import os
import subprocess
import sys
import time
import traceback

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # still/
PORT = int(os.environ.get("STILL_UI_PORT", "4199"))  # set it to run beside another copy
URL = f"http://127.0.0.1:{PORT}/"
RESULTS = []
TESTS = []


def check(fn):
    TESTS.append(fn)
    return fn


async def fresh(browser, onboarded=True, storage=None, init=None, reader=True, setup=None, **options):
    # bypass_csp lets Playwright's own helpers run; the app's CSP is
    # unchanged for real users.
    ctx = await browser.new_context(
        viewport=options.pop("viewport", {"width": 1100, "height": 850}),
        bypass_csp=True,
        accept_downloads=True,
        **options,
    )
    # Most checks start past the first-run welcome; `storage` seeds
    # localStorage before the app starts.
    seed = dict(storage or {})
    if onboarded:
        seed.setdefault("still-onboarded", "1")
    if seed:
        await ctx.add_init_script(
            "(s => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1;"
            " for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } })("
            + json.dumps(seed) + ")"
        )
    if init:  # a script to run before the app, e.g. a fake speech engine
        await ctx.add_init_script(init)
    if setup:  # e.g. routes that must be in place before the app starts
        await setup(ctx)
    page = await ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    await page.goto(URL)
    await page.wait_for_function("document.documentElement.dataset.ready === 'true'")
    # The app opens on Home (the library); most checks start in the reader.
    if reader and onboarded and await page.is_visible("#continueCard"):
        await page.click("#continueCard")
    return ctx, page


async def go_home(page):
    if not await page.is_visible("#home"):
        await page.click("#backHome")
        await page.wait_for_selector("#home", state="visible")


async def add(page):
    await go_home(page)
    await page.click("#newText")


async def shelf(page):
    await go_home(page)
    await page.click("#library")


async def tool(page, selector):
    """Reading tools live in the reading options sheet (Aa)."""
    if not await page.is_visible(selector):
        await page.click("#readerTools")
    await page.click(selector)


async def settings(page):
    """Opens Settings with everything under More settings showing."""
    await tool(page, "#readingSettings")
    await page.evaluate("document.getElementById('moreSettings').open = true")


async def open_text(page, text, title="Test reading", kind=None, checkins=None):
    await add(page)
    await page.fill("#textTitle", title)
    await page.evaluate(
        "t => { const el = document.getElementById('textInput'); el.value = t; el.dispatchEvent(new Event('input')); }",
        text,
    )
    if kind or checkins:
        await page.evaluate("document.getElementById('moreOptions').open = true")
    if kind:
        await page.select_option("#importType", kind)
    if checkins:
        await page.select_option("#importCheckins", checkins)
    await page.click("#inputForm [type=submit]")
    await page.wait_for_timeout(200)


def dialog_open(page, dialog_id):
    return page.evaluate(f"document.getElementById('{dialog_id}').open")


@check
async def space_plays_after_opening_a_reading(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "One two three four five. Six seven eight nine ten.")
    await page.keyboard.press("Space")
    await page.wait_for_timeout(300)
    assert not await dialog_open(page, "inputDialog"), "Add reading dialog reopened"
    assert "Pause" in await page.inner_text("#play"), "Space did not start playback"
    assert not page.errors, page.errors
    await ctx.close()


@check
async def space_plays_after_saving_settings(browser):
    ctx, page = await fresh(browser)
    await settings(page)
    await page.click("#saveReadingDetails")
    await page.keyboard.press("Space")
    await page.wait_for_timeout(300)
    assert not await dialog_open(page, "settingsDialog"), "settings reopened"
    assert "Pause" in await page.inner_text("#play")
    await ctx.close()


@check
async def review_shortcut_is_safe_when_all_words_are_hidden(browser):
    ctx, page = await fresh(browser)
    await add(page)
    await page.fill("#textInput", "(Smith, 2020) [12] (Jones & Lee, 2019)")
    await page.evaluate("document.getElementById('moreOptions').open = true")
    await page.select_option("#importType", "academic")
    await page.check("#importSkipCitations")
    await page.click("#inputForm [type=submit]")
    await page.click("h1")
    await page.keyboard.press("r")
    await page.keyboard.press("ArrowLeft")
    await page.wait_for_timeout(200)
    assert not page.errors, page.errors
    await ctx.close()


@check
async def chinese_is_read_word_by_word(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "在一个安静的早晨，阳光慢慢地移过地板。")
    count = await page.inner_text("#count")
    total = int(count.split("/")[1].split()[0])
    assert total >= 6, count
    await ctx.close()


@check
async def hebrew_is_laid_out_right_to_left(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "שלום עולם. זה טקסט בעברית.")
    direction = await page.evaluate("getComputedStyle(document.getElementById('word')).direction")
    assert direction == "rtl", direction
    await tool(page, "#readingMode")
    para_dir = await page.evaluate(
        "getComputedStyle(document.querySelector('#normalText p')).direction"
    )
    assert para_dir == "rtl", para_dir
    await ctx.close()


@check
async def oversized_paste_is_refused_with_a_reason(browser):
    ctx, page = await fresh(browser)
    await add(page)
    await page.evaluate("document.getElementById('textInput').value = 'word '.repeat(420000)")
    await page.click("#inputForm [type=submit]")
    assert await dialog_open(page, "inputDialog")
    message = await page.evaluate("document.getElementById('textInput').validationMessage")
    assert "too long" in message, message
    await ctx.close()


@check
async def long_reading_survives_reload_without_stalling(browser):
    ctx, page = await fresh(browser)
    words = "Reading " * 1_000 + "\n\n"
    await open_text(page, words * 120, title="Very long reading")  # ~1 MB
    assert "unavailable" not in await page.inner_text("#saved")
    stored = await page.evaluate("localStorage.getItem('still-reader-v1').length")
    assert stored < 100_000, f"text should not be in localStorage ({stored} chars)"
    await page.wait_for_timeout(500)
    await page.reload()
    await page.wait_for_function("document.getElementById('title').textContent === 'Very long reading'")
    assert not page.errors, page.errors
    await ctx.close()


@check
async def bookmarks_can_be_deleted_and_are_not_duplicated(browser):
    ctx, page = await fresh(browser)
    for _ in range(2):
        await tool(page, "#bookmarks")
        await page.click("#markCurrent")
        await page.click("#saveMark")
        await page.click("#marksDialog .close")
    await tool(page, "#bookmarks")
    assert await page.locator("#marksList .saved-mark").count() == 1, "duplicate bookmark"
    delete = page.locator("#marksList .saved-mark button", has_text="Delete")
    await delete.click()
    assert await page.locator("#marksList .saved-mark").count() == 1, "deleted without confirmation"
    await page.locator("#marksList .saved-mark button", has_text="Press again").click()
    assert await page.locator("#marksList .saved-mark").count() == 0
    await ctx.close()


@check
async def trash_can_be_emptied_and_open_reading_moves_on(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "First reading text.", title="First")
    await open_text(page, "Second reading text.", title="Second")
    await shelf(page)
    await page.wait_for_timeout(300)
    await page.get_by_role("button", name="Remove Second", exact=True).click()
    await page.wait_for_timeout(400)
    assert await page.inner_text("#title") != "Second", "trashed reading stayed open"
    await page.select_option("#shelfView", "trash")
    await page.wait_for_timeout(300)
    assert await page.is_visible("#emptyTrash")
    await page.click("#emptyTrash")
    await page.click("#confirmDelete")
    await page.wait_for_timeout(400)
    assert await page.locator("#libraryList .shelf-row").count() == 0
    await ctx.close()


@check
async def backup_with_oversized_reading_still_restores_the_rest(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "A short essay.", title="Short")
    # Simulate a reading saved by an older version before the paste limit.
    await page.evaluate("""async () => {
      const lib = await import('./library.js');
      await lib.saveReading({id: 'old-long', title: 'Old long paste', text: 'x '.repeat(1000001),
                             index: 0, wordCount: 1000001, updatedAt: 1});
    }""")
    await shelf(page)
    await page.wait_for_timeout(300)
    async with page.expect_download() as download:
        await page.evaluate("document.getElementById('exportLibrary').click()")
    path = await (await download.value).path()
    await page.set_input_files("#restoreFile", path)
    await page.wait_for_function("document.getElementById('backupStatus').textContent.includes('Ready')")
    status = await page.text_content("#backupStatus")
    assert "Old long paste" in status and "skipped" in status, status
    await ctx.close()


@check
async def bookshelf_search_finds_text_not_just_titles(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "Alpha particles and the aurora.", title="Doc A")
    await shelf(page)
    await page.fill("#shelfSearch", "aurora")
    await page.wait_for_timeout(400)
    assert await page.locator("#libraryList .shelf-row", has_text="Doc A").count() == 1
    await ctx.close()


@check
async def screen_reader_hears_position_when_paused(browser):
    ctx, page = await fresh(browser)
    await page.click("#play")
    await page.wait_for_timeout(700)
    await page.click("#play")
    status = await page.inner_text("#srStatus")
    assert status.startswith("Paused at word"), status
    role = await page.get_attribute("#progressTrack", "role")
    assert role == "progressbar"
    await ctx.close()


@check
async def theme_follows_the_device_by_default(browser):
    ctx, page = await fresh(browser, color_scheme="dark")
    theme = await page.evaluate("document.documentElement.dataset.theme")
    assert theme == "dark", theme
    await ctx.close()


@check
async def phone_layout_has_no_sideways_scroll(browser):
    ctx, page = await fresh(browser, viewport={"width": 320, "height": 640})
    overflow = await page.evaluate("document.documentElement.scrollWidth - innerWidth")
    assert overflow <= 0, overflow
    await ctx.close()


@check
async def words_are_centred_by_default_and_can_be_anchored(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "comprehension reading a")
    assert await page.locator("#word .focus").count() == 0, "centred should be the default"
    await settings(page)
    await page.select_option("#appearancePlacement", "anchored")
    offset = await page.evaluate("""() => {
      const f = document.querySelector('#word .focus').getBoundingClientRect();
      const mark = document.querySelector('.focal-line').getBoundingClientRect();
      return Math.abs(f.left + f.width / 2 - (mark.left + mark.width / 2));
    }""")
    assert offset <= 1, f"focus letter is {offset}px off the marks"
    assert await page.text_content("#word .focus") == "p"
    await page.select_option("#appearancePlacement", "centered")
    assert await page.locator("#word .focus").count() == 0
    await ctx.close()


@check
async def soft_change_fades_briefly_and_respects_reduced_motion(browser):
    for reduced, expect_fades in (("no-preference", True), ("reduce", False)):
        ctx, page = await fresh(browser, reduced_motion=reduced)
        durations = await page.evaluate("""async () => {
          const w = document.getElementById('word'), seen = [], orig = w.animate.bind(w);
          w.animate = (k, o) => (seen.push(o.duration), orig(k, o));
          document.getElementById('play').click();
          await new Promise(r => setTimeout(r, 1200));
          document.getElementById('play').click();
          return seen;
        }""")
        if expect_fades:
            assert durations and all(12 <= d <= 40 for d in durations), durations
        else:
            assert not durations, durations
        await ctx.close()


def prose(words, seed="calm"):
    return " ".join(f"{seed}{i}" + ("." if i % 12 == 11 else "") for i in range(words)) + "."


@check
async def check_in_pauses_at_a_section_end_and_resumes(browser):
    ctx, page = await fresh(browser)
    text = "Chapter One\n\n" + prose(70, "a") + "\n\nChapter Two\n\n" + prose(40, "b")
    await open_text(page, text, kind="book")
    await settings(page)
    await page.select_option("#checkinMode", "sections")
    await page.click("#saveReadingDetails")
    await page.fill("#speedValue", "600")
    await page.press("#speedValue", "Enter")
    await page.click("#play")
    await page.wait_for_function("document.getElementById('checkinDialog').open", timeout=20000)
    word = await page.get_attribute("#word", "aria-label") or await page.text_content("#word")
    assert word.startswith("a69"), f"paused on {word!r}, expected the end of chapter one"
    await page.fill("#checkinRecap", "letters and numbers")
    await page.click("[data-rating=mostly]")
    await page.wait_for_timeout(300)
    assert not await dialog_open(page, "checkinDialog")
    assert "Pause" in await page.inner_text("#play"), "reading did not resume"
    await page.click("#play")
    await tool(page, "#bookmarks")
    assert "1 check-in" in await page.inner_text("#checkinSummary")
    assert "letters and numbers" in await page.inner_text("#checkinList")
    await ctx.close()


@check
async def lost_the_thread_offers_a_slower_replay(browser):
    ctx, page = await fresh(browser)
    await open_text(page, prose(90, "c"), checkins="500")
    await page.fill("#speedValue", "600")
    await page.press("#speedValue", "Enter")
    await page.click("#play")
    await page.wait_for_function("document.getElementById('checkinDialog').open", timeout=20000)
    assert "reached the end" in await page.inner_text("#checkinTitle")
    await page.click("#checkinDialog", position={"x": 5, "y": 5})  # focus off the text box
    await page.keyboard.press("3")
    assert await page.is_visible("#checkinFollow")
    await page.click("#checkinPrimary")
    await page.wait_for_timeout(300)
    assert "Pause" in await page.inner_text("#play")
    assert "slower replay" in await page.text_content("#learning")
    await ctx.close()


@check
async def check_ins_are_offered_on_import_and_spaced_by_words(browser):
    ctx, page = await fresh(browser)
    # Off by default: a reading with no choice never pauses.
    await add(page)
    assert await page.input_value("#importCheckins") == "off"
    await page.click("#inputDialog [data-close]")
    text = "\n\n".join(prose(100, f"p{n}x") for n in range(6))
    await open_text(page, text, checkins="500")
    await page.fill("#speedValue", "600")
    await page.press("#speedValue", "Enter")
    await page.click("#play")
    # About 50 s at the fastest pace: check-ins are deliberately not frequent.
    await page.wait_for_function("document.getElementById('checkinDialog').open", timeout=90000)
    count = int((await page.text_content("#count")).split(" ")[0])
    # At the end of the fifth paragraph: 500 words in, never mid-paragraph.
    assert count == 500, count
    await page.click("#checkinSkip")
    await page.click("#play")
    # The next reading remembers the choice.
    await add(page)
    assert await page.input_value("#importCheckins") == "500"
    await ctx.close()


@check
async def check_ins_can_be_turned_off(browser):
    ctx, page = await fresh(browser)
    await open_text(page, prose(90, "d"))
    await settings(page)
    await page.select_option("#checkinMode", "off")
    await page.click("#saveReadingDetails")
    await page.fill("#speedValue", "600")
    await page.press("#speedValue", "Enter")
    await page.click("#play")
    await page.wait_for_function("document.getElementById('play').textContent.includes('Read again')", timeout=20000)
    assert not await dialog_open(page, "checkinDialog")
    await ctx.close()


@check
async def pdf_table_of_contents_becomes_chapters(browser):
    ctx, page = await fresh(browser)
    await add(page)
    await page.set_input_files("#pdfFile", os.path.join(HERE, "..", "fixtures", "chapters.pdf"))
    await page.wait_for_function(
        "document.getElementById('pdfStatus').textContent.startsWith('Imported')", timeout=30000
    )
    assert "Found 3 chapters" in await page.text_content("#pdfStatus")
    options = await page.eval_on_selector_all("#startSection option", "o => o.map(x => x.textContent)")
    assert options == ["Beginning", "Chapter One: The River", "Chapter Two: The Bridge", "Chapter Three: Home"], options
    await page.click("#inputForm [type=submit]")
    await page.wait_for_timeout(200)
    assert await page.text_content("#mode") == "1 of 3 · Chapter One: The River"
    await tool(page, "#contents")
    await page.locator("#sectionList button", has_text="Chapter Two").click()
    assert await page.text_content("#mode") == "2 of 3 · Chapter Two: The Bridge"
    assert await page.text_content("#word") == "Chapter"
    await ctx.close()


@check
async def import_flags_printed_line_breaks_and_rejoins_them(browser):
    ctx, page = await fresh(browser)
    await add(page)
    lines = ["The morning was quiet and the road ran down to the river where"] * 6
    lines += ["the light lay flat on the water and nothing moved at all there."] * 6
    text = "\n".join(lines)
    await page.evaluate(
        "t => { const e = document.getElementById('textInput'); e.value = t; e.dispatchEvent(new Event('input')); }",
        text,
    )
    await page.wait_for_selector("#textCheck:not([hidden])", timeout=3000)
    await page.locator("#textCheckList button", has_text="Rejoin").click()
    assert "\n" not in (await page.input_value("#textInput")).strip()
    await page.wait_for_selector("#textCheck[hidden]", state="attached", timeout=3000)
    await ctx.close()


@check
async def markdown_symbols_are_flagged_and_removed(browser):
    ctx, page = await fresh(browser)
    await add(page)
    text = "# Notes\n\nRead **this** and [the paper](https://example.com).\n\n- first\n- second"
    await page.evaluate(
        "t => { const e = document.getElementById('textInput'); e.value = t; e.dispatchEvent(new Event('input')); }",
        text,
    )
    await page.wait_for_selector("#textCheck:not([hidden])", timeout=3000)
    await page.locator("#textCheckList button", has_text="Remove the symbols").click()
    value = await page.input_value("#textInput")
    assert value == "Notes\n\nRead this and the paper.\n\nfirst\nsecond", value
    # A .md file has its symbols removed on import.
    await page.set_input_files(
        "#textFile",
        files=[{"name": "notes.md", "mimeType": "text/markdown", "buffer": text.encode()}],
    )
    await page.wait_for_function(
        "document.getElementById('textFileStatus').textContent.includes('Markdown')", timeout=5000
    )
    assert (await page.input_value("#textInput")).startswith("Notes\n\nRead this")
    assert await page.input_value("#textTitle") == "notes"
    # Pasted Markdown is cleaned straight away.
    await page.evaluate(
        """t => {
          const e = document.getElementById('textInput');
          const data = new DataTransfer();
          data.setData('text/plain', t);
          e.value = t;
          e.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data}));
        }""",
        text,
    )
    await page.wait_for_function(
        "document.getElementById('textFileStatus').textContent.includes('formatting symbols')", timeout=5000
    )
    assert (await page.input_value("#textInput")).startswith("Notes\n\nRead this")
    # A plain-text book's _italics_ lose their underscores on import.
    await page.set_input_files(
        "#textFile",
        files=[{"name": "book.txt", "mimeType": "text/plain", "buffer": b"It was done _at\r\nonce_, and file_name stays."}],
    )
    await page.wait_for_function(
        "document.getElementById('textFileStatus').textContent.includes('italics')", timeout=5000
    )
    assert "_" not in (await page.input_value("#textInput")).replace("file_name", "")
    await ctx.close()


def mini_epub(chapters):
    """A small EPUB 3 book; chapters is a list of (file name, body XHTML)."""
    import io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        items = "".join(
            f'<item id="c{i}" href="{name}" media-type="application/xhtml+xml"/>' for i, (name, _) in enumerate(chapters)
        )
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Small Book</dc:title></metadata>'
            f'<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{items}</manifest>'
            f"<spine>{spine}</spine></package>",
        )
        z.writestr(
            "OEBPS/nav.xhtml",
            '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>'
            '<nav epub:type="toc"><ol><li><a href="one.xhtml">Part One</a><ol>'
            '<li><a href="one.xhtml#s1">I</a></li><li><a href="two.xhtml">II</a></li></ol></li></ol></nav></body></html>',
        )
        for name, body in chapters:
            z.writestr(
                "OEBPS/" + name,
                '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                f"<body>{body}</body></html>",
            )
    return buf.getvalue()


@check
async def epub_skips_front_matter_and_note_numbers(browser):
    ctx, page = await fresh(browser)
    await add(page)
    book = mini_epub(
        [
            ("title.xhtml", '<section epub:type="titlepage"><h1>Small Book</h1><p>A Novel by Someone</p></section>'),
            ("imprint.xhtml", '<section epub:type="imprint"><p>This ebook is released under a licence.</p></section>'),
            (
                "one.xhtml",
                '<h2 id="s1">I</h2><p>The river ran quietly past the mill.<a href="notes.xhtml#n1" '
                'epub:type="noteref">1</a> Nobody watched it.</p>',
            ),
            # Not well-formed XML: an unknown tag with a space inside.
            ("two.xhtml", "<h2>II</h2><p>Write to <Your Name Here> and the bridge held firm.</p>"),
            ("notes.xhtml", '<aside epub:type="endnotes"><ol><li id="n1"><p>A note about mills.</p></li></ol></aside>'),
            ("colophon.xhtml", '<section epub:type="colophon"><p>Set in a nice typeface.</p></section>'),
        ]
    )
    await page.set_input_files(
        "#epubFile", files=[{"name": "small.epub", "mimeType": "application/epub+zip", "buffer": book}]
    )
    await page.wait_for_function(
        "document.getElementById('epubStatus').textContent.startsWith('Imported')", timeout=10000
    )
    text = await page.input_value("#textInput")
    assert "mill. Nobody" in text, text
    assert "licence" not in text and "typeface" not in text and "A Novel" not in text, text
    assert "A note about mills" not in text, text
    assert "the bridge held firm" in text, text
    options = await page.eval_on_selector_all("#startSection option", "o => o.map(x => x.textContent)")
    assert "Part One · I" in options and "Part One · II" in options, options
    assert await page.is_hidden("#epubParts")
    await ctx.close()


@check
async def holding_the_word_shows_its_sentence(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "First one here. The quick brown fox jumps over the dog. Last one.")
    await page.click("#play")
    await page.wait_for_function("document.getElementById('word').textContent === 'quick'", timeout=5000)
    box = await page.locator("#wordReader .stage").bounding_box()
    await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 20)
    await page.mouse.down()
    await page.wait_for_timeout(400)
    assert not await page.locator("#peek").is_hidden()
    peek = await page.text_content("#peek")
    assert peek.startswith("The quick brown fox") and peek.endswith("dog."), peek
    marked = await page.text_content("#peek mark")
    assert marked in ("quick", "brown"), marked
    assert "Pause" not in await page.inner_text("#play"), "kept playing while peeking"
    await page.mouse.up()
    assert await page.locator("#peek").is_hidden()
    assert "Pause" in await page.inner_text("#play"), "did not resume"
    await page.click("#play")
    # Keyboard: hold S.
    await page.keyboard.down("s")
    assert not await page.locator("#peek").is_hidden()
    await page.keyboard.up("s")
    assert await page.locator("#peek").is_hidden()
    assert "Pause" not in await page.inner_text("#play"), "resumed though it was paused"
    await ctx.close()


@check
async def find_my_pace_sets_a_starting_pace(browser):
    ctx, page = await fresh(browser)
    await page.click("#readerTools")
    assert not await page.locator("#paceInvite").is_hidden(), "first-run invite missing"
    await page.clock.install()
    await tool(page, "#findPace")
    assert await dialog_open(page, "paceDialog")
    for feel in ("comfortable", "comfortable", "fast"):
        await page.click("#pacePrimary")
        await page.clock.run_for(30000)
        await page.wait_for_selector("#paceFeel:not([hidden])")
        await page.click(f"#paceFeel [data-feel={feel}]")
    status = await page.text_content("#paceStatus")
    assert "310 words per minute" in status, status
    await page.click("#pacePrimary")
    assert not await dialog_open(page, "paceDialog")
    assert await page.input_value("#speedValue") == "310"
    assert await page.locator("#paceInvite").is_hidden()
    await ctx.close()


@check
async def first_run_welcome_sets_a_daily_goal(browser):
    ctx, page = await fresh(browser, onboarded=False)
    assert await dialog_open(page, "welcomeDialog"), "no welcome on first run"
    await page.click("#welcomeNext")
    await page.check("#goalOptions input[value='10']")
    await page.click("#goalSave")
    assert await page.is_visible("#welcomePace")
    await page.click("#welcomeSample")
    assert not await dialog_open(page, "welcomeDialog")
    assert await page.inner_text("#goalButton") == "Daily goal: 10 min"
    habits = json.loads(await page.evaluate("localStorage.getItem('still-habits')"))
    assert habits["goal"] == 10, habits
    await page.keyboard.press("Space")
    await page.wait_for_timeout(200)
    assert "Pause" in await page.inner_text("#play"), "Space did not play after the welcome"
    await page.reload()
    await page.wait_for_function("document.documentElement.dataset.ready === 'true'")
    assert not await dialog_open(page, "welcomeDialog"), "welcome shown twice"
    await ctx.close()


@check
async def reading_time_counts_toward_today(browser):
    ctx, page = await fresh(browser)
    await page.click("#play")
    assert await page.evaluate("document.body.classList.contains('immersive')"), "page did not fade back"
    await page.wait_for_timeout(1600)
    await page.click("#play")
    assert not await page.evaluate("document.body.classList.contains('immersive')")
    habits = json.loads(await page.evaluate("localStorage.getItem('still-habits')"))
    day = next(iter(habits["days"].values()))
    assert day["ms"] >= 1000 and day["words"] >= 3, day
    assert "words" in await page.inner_text("#todayLine")
    assert await page.inner_text("#timeLeft") != ""
    await ctx.close()


@check
async def streak_counts_days_in_a_row(browser):
    today = datetime.date.today()
    days = {
        (today - datetime.timedelta(days=n)).isoformat(): {"ms": 400000, "words": 1500}
        for n in (1, 2, 3)
    }
    days[(today - datetime.timedelta(days=5)).isoformat()] = {"ms": 400000, "words": 1}
    ctx, page = await fresh(browser, storage={"still-habits": json.dumps({"goal": 5, "days": days})})
    line = await page.inner_text("#streakLine")
    assert "3-day streak" in line and "keeps it going" in line, line
    assert await page.locator("#weekStrip li.met").count() == 4
    await ctx.close()


@check
async def tapping_the_word_plays_and_pauses(browser):
    ctx, page = await fresh(browser)
    stage = page.locator("#wordReader .stage")
    await stage.click()
    assert "Pause" in await page.inner_text("#play"), "tap did not play"
    await page.wait_for_timeout(300)
    await stage.click()
    assert "Pause" not in await page.inner_text("#play"), "tap did not pause"
    assert await page.locator("#peek").is_hidden()
    await ctx.close()


@check
async def arrow_keys_change_pace_and_skip_sentences(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "One two three. Four five six. Seven eight.")
    await page.keyboard.press("ArrowUp")
    assert await page.input_value("#speedValue") == "190"
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    assert await page.input_value("#speedValue") == "170"
    await page.keyboard.press("ArrowRight")
    assert await page.text_content("#word") == "Four"
    await page.keyboard.press("ArrowRight")
    assert await page.text_content("#word") == "Seven"
    await page.keyboard.press("ArrowLeft")
    assert await page.text_content("#word") == "Four"
    await ctx.close()


@check
async def back_and_forward_buttons_move_by_sentence(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "One two three. Four five six. Seven eight.")
    await page.click("#quickForward")
    assert await page.text_content("#word") == "Four"
    await page.click("#quickForward")
    assert await page.text_content("#word") == "Seven"
    await page.click("#quickRewind")
    assert await page.text_content("#word") == "Four"
    await page.click("#quickForward")
    assert await page.text_content("#word") == "Seven"
    await ctx.close()


@check
async def review_scrolls_the_whole_text_and_double_tap_reads_from_a_word(browser):
    ctx, page = await fresh(browser)
    paragraphs = [f"Paragraph {n} begins here. " + "word " * 100 + "end." for n in range(80)]
    await open_text(page, "\n\n".join(paragraphs))
    for _ in range(120):
        await page.keyboard.press("ArrowRight")
    await page.click("#review")
    assert not await page.locator("#prevPara").count()
    # The paragraphs around the place are already there to scroll through.
    shown = await page.locator("#paragraph .review-paragraph").count()
    assert shown > 3, shown
    assert await page.locator("#paragraph .token.selected").count() == 1
    # Your place is marked, and the way back stays out of sight while it shows.
    assert await page.locator("#paragraph .token.place").count() == 1
    assert await page.locator("#returnToPlace").is_hidden()
    # Scrolling to the top brings in earlier paragraphs for a while, then stops
    # and asks before going further from your place.
    first = int(await page.get_attribute("#paragraph .review-paragraph >> nth=0", "data-paragraph"))
    for _ in range(30):
        await page.evaluate("document.getElementById('paragraph').scrollTop = 0")
        await page.wait_for_timeout(30)
    auto = int(await page.get_attribute("#paragraph .review-paragraph >> nth=0", "data-paragraph"))
    assert 0 < auto < first, (first, auto)
    assert await page.is_visible("#reviewEarlier")
    assert "before your place" in await page.inner_text("#reviewEarlierNote")
    # Your place is out of view now, so the way back points down to it.
    await page.wait_for_selector("#returnToPlace", state="visible")
    assert "up" not in (await page.get_attribute("#returnToPlace", "class"))
    for _ in range(20):
        if await page.locator("#reviewEarlier").is_hidden():
            break
        await page.click("#reviewEarlier")
        await page.evaluate("document.getElementById('paragraph').scrollTop = 0")
    now = int(await page.get_attribute("#paragraph .review-paragraph >> nth=0", "data-paragraph"))
    assert now == 0, now
    # Back to my place scrolls to it and chooses it again.
    await page.click("#paragraph .review-paragraph[data-paragraph='5'] .token >> nth=3")
    await page.click("#returnToPlace")
    await page.wait_for_selector("#returnToPlace", state="hidden")
    assert await page.locator("#paragraph .token.selected.place").count() == 1
    assert await page.locator("#paragraph .token.place").is_visible()
    await page.evaluate("document.getElementById('paragraph').scrollTop = 0")
    # A single tap chooses a word; a double tap reads from it.
    target = page.locator("#paragraph .review-paragraph[data-paragraph='2'] .token >> nth=0")
    await target.click()
    assert await page.text_content("#selectedWord") == "Paragraph"
    assert await page.is_visible("#reviewDialog")
    await page.wait_for_timeout(600)
    await target.dblclick()
    await page.wait_for_selector("#reviewDialog", state="hidden")
    await page.wait_for_function("document.getElementById('play').textContent.includes('Pause')", timeout=3000)
    await page.click("#play")
    count = await page.text_content("#count")
    # Paragraph 2 starts at word 211 (105 words each); playing moves on a word or two.
    assert int(count.split(" ")[0]) in (211, 212, 213), count
    await ctx.close()


@check
async def progress_can_show_percent_read(browser):
    ctx, page = await fresh(browser)
    await open_text(page, " ".join(["word"] * 200))
    for _ in range(3):
        await page.keyboard.press("ArrowRight")
    assert "left" in await page.inner_text("#timeLeft")
    await page.click("#timeLeft")
    assert (await page.inner_text("#timeLeft")).endswith("% read")
    await page.reload()
    await page.wait_for_function("document.documentElement.dataset.ready === 'true'")
    assert (await page.inner_text("#timeLeft")).endswith("% read")
    assert await page.evaluate("JSON.parse(localStorage.getItem('still-appearance')).progress") == "percent"
    await ctx.close()


@check
async def slow_paces_and_pausing_after_each_sentence(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "One two three. Four five six.\n\nSeven eight")
    # Paces go down to 40 words a minute, in finer steps at the slow end.
    await page.fill("#speedValue", "40")
    await page.press("#speedValue", "Enter")
    assert await page.input_value("#speedValue") == "40"
    assert await page.is_disabled("#slower")
    await page.click("#faster")
    assert await page.input_value("#speedValue") == "45"
    await page.fill("#speedValue", "600")
    await page.press("#speedValue", "Enter")
    # With the pause on, playback stops on each sentence's last word.
    await tool(page, "#paceMore summary")
    await page.check("#sentenceStop")
    await page.keyboard.press("Escape")
    for last in ("three.", "six.", "eight"):
        await page.click("#play")
        await page.wait_for_function("!document.getElementById('play').textContent.includes('Pause')", timeout=5000)
        assert (await page.inner_text("#word")).strip() == last
        if last != "eight":
            assert "End of the sentence" in await page.inner_text("#status")
    assert await page.evaluate("JSON.parse(localStorage.getItem('still-appearance')).sentenceStop") is True
    await ctx.close()


@check
async def finishing_offers_the_next_reading(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "An unread book waits here.", title="Waiting book")
    await open_text(page, "Short and sweet. The end.", title="Short one")
    await page.fill("#speedValue", "600")
    await page.press("#speedValue", "Enter")
    await page.click("#play")
    await page.wait_for_function("document.getElementById('play').textContent.includes('Read again')", timeout=10000)
    assert await page.is_visible("#finishCard")
    assert "Short one" in await page.inner_text("#finishTitle")
    await page.wait_for_function("document.getElementById('finishNext').textContent.includes('Waiting book')")
    await page.click("#finishNext")
    await page.wait_for_timeout(200)
    assert await page.inner_text("#title") == "Waiting book"
    assert await page.locator("#finishCard").is_hidden()
    await ctx.close()


@check
async def new_readers_start_on_a_short_read_at_a_gentle_pace(browser):
    ctx, page = await fresh(browser, onboarded=False)
    await page.click("#welcomeNext")
    await page.click("#goalSave")
    first = (await page.inner_text("#welcomeFirstRead")).split("”")[0].strip("“")
    await page.click("#welcomeSample")
    assert await page.inner_text("#title") == first
    assert await page.input_value("#speedValue") == "180"
    # The shelf on Home marks the open piece and opens another one, once.
    await go_home(page)
    assert await page.locator(".starter-item[aria-current=true]").count() == 1
    items = page.locator(".starter-item")
    assert await items.count() >= 3
    other = items.nth(0)
    name = await other.locator("strong").inner_text()
    if name == first:
        other = items.nth(1)
        name = await other.locator("strong").inner_text()
    await other.click()
    await page.wait_for_timeout(300)
    assert await page.inner_text("#title") == name
    assert await page.locator(".starter-item[aria-current=true] strong").inner_text() == name
    # Add reading > Pick a short read goes back to the shelf.
    await add(page)
    await page.click("#sample")
    assert not await dialog_open(page, "inputDialog")
    assert await page.evaluate("document.activeElement.classList.contains('starter-item')")
    # Pace options and keyboard keys stay out of the way until wanted.
    await page.click("#continueCard")
    assert not await page.is_visible("#speed")
    await tool(page, "#paceMore summary")
    assert await page.is_visible("#speed")
    assert not page.errors, page.errors
    await ctx.close()


@check
async def finishing_a_short_read_suggests_the_next_and_find_my_pace(browser):
    ctx, page = await fresh(browser, reader=False)
    await page.locator(".starter-item").nth(0).click()
    await page.fill("#speedValue", "600")
    await page.press("#speedValue", "Enter")
    await page.evaluate("() => { const b = document.querySelector('#play'); b.click(); }")
    await page.wait_for_function("document.getElementById('play').textContent.includes('Read again')", timeout=60000)
    assert await page.is_visible("#finishPace")
    finished = await page.inner_text("#title")
    await page.wait_for_function("document.getElementById('finishNext').textContent.startsWith('Up next')")
    label = await page.inner_text("#finishNext")
    await page.wait_for_selector(".starter-item.read", state="attached")
    await page.click("#finishNext")
    await page.wait_for_timeout(300)
    title = await page.inner_text("#title")
    assert title != finished and title in label, (title, label)
    await ctx.close()


@check
async def waitlist_and_feedback_post_to_netlify_forms(browser):
    ctx, page = await fresh(browser, onboarded=False)
    posts = []

    async def capture(route):
        if route.request.method == "POST":
            posts.append(route.request.post_data)
            await route.fulfill(status=200, body="ok")
        else:
            await route.continue_()

    await page.route("**/", capture)
    assert await page.is_visible("#waitlistEmailWelcome")
    assert "stays on your device" in await page.inner_text("#welcomeDialog .waitlist-note")
    await page.fill("#waitlistEmailWelcome", "reader@example.com")
    await page.click("#welcomeDialog .waitlist button")
    await page.wait_for_function("document.querySelector('#welcomeDialog .waitlist-status').textContent.includes('Thanks')")
    assert "form-name=waitlist" in posts[0] and "where=welcome" in posts[0], posts
    assert "reader%40example.com" in posts[0], posts
    await page.click("#welcomeSkip")
    await page.click("#sendFeedback")
    await page.fill("#feedbackMessage", "The short reads helped.")
    await page.click("#feedbackForm [type=submit]")
    await page.wait_for_function("document.getElementById('feedbackStatus').textContent.includes('sent')")
    assert "form-name=feedback" in posts[1] and "short+reads" in posts[1], posts
    # Joined once: the box doesn't ask again.
    await page.reload()
    await page.wait_for_function("document.documentElement.dataset.ready === 'true'")
    assert await page.locator(".waitlist").first.is_hidden()
    assert not page.errors, page.errors
    await ctx.close()


# A stand-in for the browser's speech engine: records each utterance, then
# fires a word boundary every `__speechStep` ms and `end` after the last word.
FAKE_SPEECH = """
(() => {
  const log = (window.__speech = { spoken: [], cancels: 0 });
  window.__speechStep = 150;
  class FakeUtterance {
    constructor(text) { this.text = text; this.rate = 1; }
  }
  const synth = {
    paused: false,
    current: null,
    getVoices: () => [
      { name: "Test voice", voiceURI: "Test voice", lang: "en-US", localService: true, default: true },
      { name: "Cloud voice", voiceURI: "Cloud voice", lang: "en-US", localService: false, default: false },
    ],
    speak(u) {
      log.spoken.push({ text: u.text, rate: u.rate, voice: u.voice && u.voice.name });
      this.current = u;
      const words = [...u.text.matchAll(/\\S+/g)];
      let i = 0;
      const step = () => {
        if (this.current !== u) return;
        if (i < words.length) {
          u.onboundary && u.onboundary({ name: "word", charIndex: words[i++].index });
          setTimeout(step, window.__speechStep);
        } else {
          this.current = null;
          u.onend && u.onend({});
        }
      };
      setTimeout(() => {
        if (this.current !== u) return;
        u.onstart && u.onstart({});
        step();
      }, 10);
    },
    cancel() {
      log.cancels++;
      const u = this.current;
      this.current = null;
      if (u) setTimeout(() => u.onerror && u.onerror({ error: "interrupted" }), 0);
    },
    resume() {},
    pause() {},
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = FakeUtterance;
})();
"""

NO_SPEECH = """
Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
window.SpeechSynthesisUtterance = undefined;
"""


@check
async def read_aloud_moves_words_with_the_voice(browser):
    ctx, page = await fresh(browser, init=FAKE_SPEECH)
    await open_text(page, "One two three four. Five six seven eight.")
    # The slowest pace: the timer alone would hold "One" for over 2 seconds.
    await page.fill("#speedValue", "40")
    await page.press("#speedValue", "Enter")
    await settings(page)
    assert await page.is_visible("#readAloud")
    assert await page.locator("#readAloudBadge").is_hidden()
    await page.check("#readAloud")
    await page.keyboard.press("Escape")
    assert await page.is_visible("#readAloudBadge")
    assert await page.evaluate("JSON.parse(localStorage.getItem('still-appearance')).readAloud") is True
    spoken = "window.__speech.spoken"
    word = "document.getElementById('word').textContent"
    await page.click("#play")
    await page.wait_for_function(f"{spoken}.length === 1")
    first = await page.evaluate(f"{spoken}[0]")
    assert first["text"] == "One two three four.", first
    assert first["rate"] == 0.5, first  # 40 words a minute, as slow as voices go
    assert first["voice"] == "Test voice", first  # never the cloud voice
    # The word follows the voice's boundaries, well ahead of the timer.
    await page.wait_for_function(f"{word} === 'three'", timeout=1500)
    # Screen readers aren't told "Playing." over the voice.
    assert await page.text_content("#srStatus") == ""
    # Pause cancels the speech and keeps the word.
    await page.click("#play")
    assert await page.evaluate("window.__speech.cancels") >= 1
    held = await page.evaluate(word)
    await page.wait_for_timeout(500)
    assert await page.evaluate(word) == held
    assert await page.evaluate(f"{spoken}.length") == 1
    # Play speaks again from the current word.
    await page.click("#play")
    await page.wait_for_function(f"{spoken}.length === 2")
    again = await page.evaluate(f"{spoken}[1].text")
    assert again.startswith(held) and again.endswith("four."), (held, again)
    # Then the next sentence, to the end of the reading.
    await page.wait_for_function(f"{spoken}.length === 3")
    assert await page.evaluate(f"{spoken}[2].text") == "Five six seven eight."
    await page.wait_for_function("document.getElementById('play').textContent.includes('Read again')", timeout=5000)
    assert await page.evaluate(word) == "eight."
    # Pause after each sentence stops at the sentence end, as without the voice.
    await page.click("#readerTools")
    await page.evaluate("document.getElementById('paceMore').open = true")
    await page.check("#sentenceStop")
    await page.keyboard.press("Escape")
    await page.click("#play")
    await page.wait_for_function("!document.getElementById('play').textContent.includes('Pause')", timeout=5000)
    assert await page.evaluate(word) == "four."
    assert "End of the sentence" in await page.inner_text("#status")
    await page.click("#play")
    await page.wait_for_function(f"{spoken}.at(-1).text === 'Five six seven eight.'")
    # Skipping back a sentence starts the voice again from there.
    await page.click("#quickRewind")
    await page.wait_for_function(f"{spoken}.at(-1).text === 'One two three four.'")
    assert "Pause" in await page.inner_text("#play")
    # Turning it off goes back to the timer and hides the speaker mark.
    await page.click("#play")
    await settings(page)
    await page.uncheck("#readAloud")
    await page.keyboard.press("Escape")
    assert await page.locator("#readAloudBadge").is_hidden()
    count = await page.evaluate(f"{spoken}.length")
    await page.click("#play")
    await page.wait_for_timeout(300)
    assert await page.evaluate(f"{spoken}.length") == count
    assert await page.text_content("#srStatus") == "Playing."
    assert not page.errors, page.errors
    await ctx.close()


@check
async def read_aloud_is_hidden_without_speech(browser):
    ctx, page = await fresh(browser, init=NO_SPEECH)
    await settings(page)
    assert await page.locator("#readAloudSetting").count() == 1
    assert await page.locator("#readAloudSetting").is_hidden()
    assert await page.locator("#readAloudBadge").is_hidden()
    assert not page.errors, page.errors
    await ctx.close()


@check
async def read_aloud_is_offered_on_first_run(browser):
    ctx, page = await fresh(browser, onboarded=False, init=FAKE_SPEECH)
    await page.click("#welcomeNext")
    await page.click("#goalSave")
    assert await page.is_visible("#welcomeAloud")
    await page.check("#welcomeAloud")
    await page.click("#welcomeSample")
    assert await page.is_visible("#readAloudBadge")
    assert await page.evaluate("JSON.parse(localStorage.getItem('still-appearance')).readAloud") is True
    assert not page.errors, page.errors
    await ctx.close()


@check
async def read_aloud_voice_can_be_chosen_and_tried(browser):
    ctx, page = await fresh(browser, init=FAKE_SPEECH)
    await settings(page)
    assert await page.locator("#readAloudVoiceField").is_hidden()
    await page.check("#readAloud")
    assert await page.is_visible("#readAloudVoice")
    labels = await page.locator("#readAloudVoice option").all_inner_texts()
    assert labels[0].startswith("Most natural here (Test voice)"), labels
    assert not any("Cloud" in l for l in labels), labels
    await page.select_option("#readAloudVoice", "Test voice")
    assert await page.evaluate("JSON.parse(localStorage.getItem('still-appearance')).readAloudVoice") == "Test voice"
    await page.click("#readAloudTry")
    spoken = await page.evaluate("window.__speech.spoken.at(-1)")
    assert "how Still will read" in spoken["text"] and spoken["voice"] == "Test voice", spoken
    assert not page.errors, page.errors
    await ctx.close()


@check
async def home_is_a_library_and_the_reader_returns_to_it(browser):
    ctx, page = await fresh(browser, reader=False)
    assert await page.is_visible("#home") and not await page.is_visible("#play")
    await open_text(page, "Seven eight nine.", title="Earlier book")
    assert await page.is_visible("#play") and not await page.is_visible("#home")
    await open_text(page, "One two three. Four five six.", title="My book")
    await page.click("#backHome")
    await page.wait_for_selector("#home", state="visible")
    assert "My book" in await page.inner_text("#continueTitle")
    # The previous reading is now a book on the shelf; opening it reads it.
    await page.wait_for_selector("#bookGrid .book:not(.add-book)")
    await page.locator("#bookGrid .book:not(.add-book)").first.click()
    await page.wait_for_selector("#play", state="visible")
    assert await page.inner_text("#title") == "Earlier book"
    # Space does nothing on Home.
    await go_home(page)
    await page.keyboard.press("Space")
    assert not await page.evaluate("document.body.classList.contains('immersive')")
    assert not page.errors, page.errors
    await ctx.close()


@check
async def sheets_close_with_a_tap_outside_and_keep_changes(browser):
    ctx, page = await fresh(browser, viewport={"width": 390, "height": 844}, has_touch=True)
    await page.click("#readerTools")
    assert await dialog_open(page, "readerPanel")
    await page.mouse.click(195, 20)
    assert not await dialog_open(page, "readerPanel"), "tap outside did not close"
    await settings(page)
    assert not await dialog_open(page, "readerPanel"), "options sheet stayed under settings"
    await page.fill("#readingTitle", "Renamed")
    await page.mouse.click(195, 20)
    assert not await dialog_open(page, "settingsDialog"), "settings stayed open"
    await page.wait_for_function("document.getElementById('title').textContent === 'Renamed'", timeout=3000)
    assert not page.errors, page.errors
    await ctx.close()


def tone_wav(ms, rate=8000):
    """A WAV clip of a quiet tone, standing in for the natural voice's MP3."""
    import math
    import struct
    n = int(rate * ms / 1000)
    data = b"".join(struct.pack("<h", int(6000 * math.sin(i / 3))) for i in range(n))
    return (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(data)) + data)


def natural_voice_server(posts, status=200):
    """Stands in for netlify/functions/speak.mjs: set up, 300 ms a word."""
    async def handle(route):
        request = route.request
        if request.method == "GET":
            await route.fulfill(status=204)
            return
        body = json.loads(request.post_data)
        posts.append(body)
        if status != 200:
            await route.fulfill(status=status, body="{}")
        else:
            await route.fulfill(status=200, content_type="audio/wav",
                                body=tone_wav(300 * len(body["text"].split())))

    async def setup(ctx):
        await ctx.route("**/api/speak", handle)
    return setup


@check
async def natural_voice_reads_aloud_and_words_follow(browser):
    posts = []
    ctx, page = await fresh(browser, init=FAKE_SPEECH, setup=natural_voice_server(posts))
    await open_text(page, "One two three four. Five six seven eight.")
    await settings(page)
    await page.check("#readAloud")
    groups = await page.eval_on_selector_all("#readAloudVoice optgroup", "gs => gs.map(g => g.label)")
    assert groups == ["Natural voices (online)", "Built into this device"], groups
    assert await page.is_visible("#readAloudPrivacy")
    assert await page.input_value("#readAloudVoice") == ""  # the first natural voice
    await page.keyboard.press("Escape")
    word = "document.getElementById('word').textContent"
    await page.click("#play")
    await page.wait_for_function(f"{word} === 'three'", timeout=4000)
    assert posts[0]["text"] == "One two three four." and posts[0]["voice"] == "marin", posts
    # The next sentence was fetched while the first played.
    await page.wait_for_function("document.getElementById('play').textContent.includes('Read again')", timeout=8000)
    assert [p["text"] for p in posts[:2]] == ["One two three four.", "Five six seven eight."], posts
    assert await page.evaluate("window.__speech.spoken.length") == 0, "the device voice spoke too"
    assert not page.errors, page.errors
    await ctx.close()


@check
async def natural_voice_failing_hands_over_to_the_device_voice(browser):
    posts = []
    ctx, page = await fresh(browser, init=FAKE_SPEECH, setup=natural_voice_server(posts, status=500))
    await open_text(page, "One two three four. Five six seven eight.")
    await settings(page)
    await page.check("#readAloud")
    await page.keyboard.press("Escape")
    await page.click("#play")
    await page.wait_for_function("window.__speech.spoken.length >= 1", timeout=4000)
    assert len(posts) >= 1
    assert "switched to this device" in await page.inner_text("#toast")
    first = await page.evaluate("window.__speech.spoken[0]")
    assert first["text"] == "One two three four.", first
    assert not page.errors, page.errors
    await ctx.close()


@check
async def a_device_voice_can_still_be_chosen_over_the_natural_one(browser):
    posts = []
    ctx, page = await fresh(browser, init=FAKE_SPEECH, setup=natural_voice_server(posts))
    await open_text(page, "One two three four.")
    await settings(page)
    await page.check("#readAloud")
    await page.select_option("#readAloudVoice", "Test voice")
    await page.keyboard.press("Escape")
    await page.click("#play")
    await page.wait_for_function("window.__speech.spoken.length >= 1", timeout=4000)
    assert posts == [], posts
    assert not page.errors, page.errors
    await ctx.close()


async def main():
    server = subprocess.Popen(
        ["node", "server.mjs"],
        cwd=ROOT,
        env={**os.environ, "PORT": str(PORT)},
        stdout=subprocess.DEVNULL,
    )
    time.sleep(0.8)
    failed = 0
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            only = sys.argv[1:] or None
            for test in TESTS:
                if only and not any(o in test.__name__ for o in only):
                    continue
                try:
                    await test(browser)
                    print(f"ok   {test.__name__}")
                except Exception as error:
                    failed += 1
                    print(f"FAIL {test.__name__}: {error or type(error).__name__}")
                    if os.environ.get("VERBOSE"):
                        traceback.print_exc()
            await browser.close()
    finally:
        server.kill()
    print(f"\n{failed} failed" if failed else "\nAll browser checks passed.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    asyncio.run(main())
