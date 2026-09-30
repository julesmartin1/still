"""Browser tests for Still's interface (keyboard, dialogs, storage, bookshelf).

The unit tests (npm test) cover reading logic; these cover the glue around it,
which is where most real bugs have been found.

Setup, once:
    pip install playwright
    python -m playwright install chromium
Run from the still/ folder:
    python3 tests/ui/run.py

It starts its own copy of the server on port 4199 and prints one line per
check. Exit code is non-zero if anything fails.
"""
import asyncio
import os
import subprocess
import sys
import time
import traceback

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # still/
PORT = 4199
URL = f"http://127.0.0.1:{PORT}/"
RESULTS = []
TESTS = []


def check(fn):
    TESTS.append(fn)
    return fn


async def fresh(browser, **options):
    # bypass_csp lets Playwright's own helpers run; the app's CSP is
    # unchanged for real users.
    ctx = await browser.new_context(
        viewport=options.pop("viewport", {"width": 1100, "height": 850}),
        bypass_csp=True,
        accept_downloads=True,
        **options,
    )
    page = await ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    await page.goto(URL)
    await page.wait_for_function("document.documentElement.dataset.ready === 'true'")
    return ctx, page


async def open_text(page, text, title="Test reading", kind=None):
    await page.click("#newText")
    await page.fill("#textTitle", title)
    await page.evaluate(
        "t => { const el = document.getElementById('textInput'); el.value = t; el.dispatchEvent(new Event('input')); }",
        text,
    )
    if kind:
        await page.select_option("#importType", kind)
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
    await page.click("#readingSettings")
    await page.click("#saveReadingDetails")
    await page.keyboard.press("Space")
    await page.wait_for_timeout(300)
    assert not await dialog_open(page, "settingsDialog"), "settings reopened"
    assert "Pause" in await page.inner_text("#play")
    await ctx.close()


@check
async def review_shortcut_is_safe_when_all_words_are_hidden(browser):
    ctx, page = await fresh(browser)
    await page.click("#newText")
    await page.fill("#textInput", "(Smith, 2020) [12] (Jones & Lee, 2019)")
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
    await page.click("#readingMode")
    para_dir = await page.evaluate(
        "getComputedStyle(document.querySelector('#normalText p')).direction"
    )
    assert para_dir == "rtl", para_dir
    await ctx.close()


@check
async def oversized_paste_is_refused_with_a_reason(browser):
    ctx, page = await fresh(browser)
    await page.click("#newText")
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
        await page.click("#bookmarks")
        await page.click("#markCurrent")
        await page.click("#saveMark")
        await page.click("#marksDialog .close")
    await page.click("#bookmarks")
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
    await page.click("#library")
    await page.wait_for_timeout(300)
    await page.locator(".shelf-row", has_text="Second").locator("button", has_text="Remove").click()
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
    await page.click("#library")
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
    await page.click("#library")
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
async def words_are_anchored_on_their_focus_letter(browser):
    ctx, page = await fresh(browser)
    await open_text(page, "comprehension reading a")
    offset = await page.evaluate("""() => {
      const f = document.querySelector('#word .focus').getBoundingClientRect();
      const mark = document.querySelector('.focal-line').getBoundingClientRect();
      return Math.abs(f.left + f.width / 2 - (mark.left + mark.width / 2));
    }""")
    assert offset <= 1, f"focus letter is {offset}px off the marks"
    assert await page.text_content("#word .focus") == "p"
    await page.click("#readingSettings")
    await page.locator("summary", has_text="Appearance").click()
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
