// Shareable links: a `?shared=<json>` URL param should, on load, switch to
// the correct tab, switch to "Write your own" + the correct sub-mode, and
// pre-populate the matching editor (plus the values field for a comparator)
// -- all six authorable kinds across both families. Also verifies the
// round-trip via the actual "Copy share link" button (reads the real
// clipboard) rather than just calling the encode/decode functions directly,
// and confirms the `shared` param is stripped from the URL after load so a
// refresh doesn't keep re-populating over edits.
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
  permissions: ['clipboard-read', 'clipboard-write'],
});

let allPass = true;
function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${detail ? ' -- ' + JSON.stringify(detail) : ''}`);
  if (!cond) allPass = false;
}

async function freshPageWithShare(payload) {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  const url = `${targetUrl}?shared=${encodeURIComponent(JSON.stringify(payload))}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return { context, page };
}

// ---- search-problem ----
{
  const src = 'class Problem:\n    pass  # deliberately arbitrary, only checking pre-population, not validity';
  const { context, page } = await freshPageWithShare({ kind: 'search-problem', source: src });
  const searchActive = await page.evaluate(() => document.querySelector('.app-tabs button.active')?.textContent);
  check('search-problem link lands on Search tab', searchActive === 'Search');
  const subActive = await page.evaluate(() => document.querySelector('.sub-toggle button.active')?.textContent);
  check('search-problem link lands on Problem sub-mode', subActive === 'Problem');
  const editorText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent);
  check('editor pre-populated with shared source', editorText?.includes('deliberately arbitrary'), editorText);
  const urlAfter = page.url();
  check('shared param stripped from URL after load', !urlAfter.includes('shared='), urlAfter);
  await context.close();
}

// ---- search-algorithm ----
{
  const src = 'def algorithm(problem, on_step=None):\n    return None  # marker_search_algo';
  const { context, page } = await freshPageWithShare({ kind: 'search-algorithm', source: src });
  const subActive = await page.evaluate(() => document.querySelector('.sub-toggle button.active')?.textContent);
  check('search-algorithm link lands on Algorithm sub-mode', subActive === 'Algorithm');
  const editorText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent);
  check('editor pre-populated with shared algorithm source', editorText?.includes('marker_search_algo'), editorText);
  await context.close();
}

// ---- search-heuristic ----
{
  const src = 'def heuristic(state):\n    return 0  # marker_search_heuristic';
  const { context, page } = await freshPageWithShare({ kind: 'search-heuristic', source: src });
  const subActive = await page.evaluate(() => document.querySelector('.sub-toggle button.active')?.textContent);
  check('search-heuristic link lands on Heuristic sub-mode', subActive === 'Heuristic');
  const editorText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent);
  check('editor pre-populated with shared heuristic source', editorText?.includes('marker_search_heuristic'), editorText);
  await context.close();
}

// ---- sort-problem ----
{
  const src = 'class Problem:\n    pass  # marker_sort_problem';
  const { context, page } = await freshPageWithShare({ kind: 'sort-problem', source: src });
  const sortActive = await page.evaluate(() => document.querySelector('.app-tabs button.active')?.textContent);
  check('sort-problem link lands on Sort tab', sortActive === 'Sort');
  const subActive = await page.evaluate(() => document.querySelector('.sub-toggle button.active')?.textContent);
  check('sort-problem link lands on Problem sub-mode', subActive === 'Problem');
  const editorText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent);
  check('editor pre-populated with shared source', editorText?.includes('marker_sort_problem'), editorText);
  await context.close();
}

// ---- sort-algorithm ----
{
  const src = 'def algorithm(problem, on_step=None):\n    return []  # marker_sort_algo';
  const { context, page } = await freshPageWithShare({ kind: 'sort-algorithm', source: src });
  const subActive = await page.evaluate(() => document.querySelector('.sub-toggle button.active')?.textContent);
  check('sort-algorithm link lands on Algorithm sub-mode', subActive === 'Algorithm');
  const editorText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent);
  check('editor pre-populated with shared algorithm source', editorText?.includes('marker_sort_algo'), editorText);
  await context.close();
}

// ---- sort-comparator (also carries `values`) ----
{
  const src = 'def comparator(a, b):\n    return 0  # marker_sort_comparator';
  const { context, page } = await freshPageWithShare({ kind: 'sort-comparator', source: src, values: [42, 7, 13] });
  const subActive = await page.evaluate(() => document.querySelector('.sub-toggle button.active')?.textContent);
  check('sort-comparator link lands on Comparator sub-mode', subActive === 'Comparator');
  const editorText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent);
  check('editor pre-populated with shared comparator source', editorText?.includes('marker_sort_comparator'), editorText);
  const valuesInputValue = await page.evaluate(() => document.querySelector('input[type="text"]')?.value);
  check('values field pre-populated from shared payload', valuesInputValue === '42, 7, 13', valuesInputValue);
  await context.close();
}

// ---- round-trip via the real "Copy share link" button + real clipboard ----
{
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto(targetUrl, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  await page.click('button:has-text("Write your own")');
  await page.waitForTimeout(200);
  await page.click('.sub-toggle button:has-text("Problem")');
  await page.waitForTimeout(200);
  // Type a distinguishing marker into the CodeMirror editor.
  await page.click('.cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('# marker_roundtrip\nclass Problem:\n    pass');
  await page.waitForTimeout(200);

  await page.click('button:has-text("Copy share link")');
  await page.waitForTimeout(200);
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  check('clipboard contains a shared= URL', clipboardText.includes('?shared='), clipboardText.slice(0, 120));

  const decoded = JSON.parse(new URL(clipboardText).searchParams.get('shared'));
  check('round-tripped payload has correct kind', decoded.kind === 'search-problem', decoded.kind);
  check('round-tripped payload contains the typed marker', decoded.source.includes('marker_roundtrip'), decoded.source);

  // Load the copied link fresh and confirm it reproduces the same editor content.
  const { context: ctx2, page: page2 } = await freshPageWithShare(decoded);
  const editorText2 = await page2.evaluate(() => document.querySelector('.cm-content')?.textContent);
  check('fresh load of the copied link reproduces the marker', editorText2?.includes('marker_roundtrip'), editorText2);
  await ctx2.close();

  await context.close();
}

// ---- malformed / absent share param: falls back cleanly, no crash ----
{
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto(`${targetUrl}?shared=not-valid-json{{{`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const searchActive = await page.evaluate(() => document.querySelector('.app-tabs button.active')?.textContent);
  check('malformed shared param falls back to default Search tab, no crash', searchActive === 'Search');
  await context.close();
}

console.log('\n' + (allPass ? '=== ALL CASES PASS ===' : '=== AT LEAST ONE CASE FAILED ==='));
await browser.close();
process.exit(allPass ? 0 : 1);
