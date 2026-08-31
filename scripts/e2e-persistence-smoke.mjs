// Verifies authored Python survives a reload, that a shared link still wins
// over stored work, that Reset actually clears the store, and that the app
// still loads when localStorage is unavailable entirely (private windows and
// blocked site data make these calls THROW, not return null).
//   node scripts/e2e-persistence-smoke.mjs http://localhost:5173/
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const failures = [];
const pageErrors = [];
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`);
    failures.push(name);
  }
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'] });
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (e) => pageErrors.push(e.stack || String(e)));

const MARKER = '# marker_persist_' + Date.now();

const gotoPythonHeuristic = async (p, url = targetUrl) => {
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForSelector('.mode-toggle button', { timeout: 20000 });
  // Pyodide pre-warms on mount and competes for the main thread; typing before
  // it settles made this suite flaky in a way the app itself was not.
  await p.waitForFunction(() => document.querySelector('.status-neutral')?.textContent?.includes('Ready'), null, { timeout: 120000 }).catch(() => {});
  await p.getByRole('button', { name: 'Write your own' }).click();
  await p.getByRole('button', { name: 'Heuristic', exact: true }).click();
};

// ---------------------------------------------------------------------------
console.log('\n=== authored source survives a reload ===');
await gotoPythonHeuristic(page);
const editor = page.locator('.python-editor .cm-content');
await editor.click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type(`${MARKER}\ndef heuristic(state):\n    return 0\n`);
// Longer than the 400ms write debounce.
await page.waitForTimeout(900);

await gotoPythonHeuristic(page);
const afterReload = await page.locator('.python-editor .cm-content').innerText();
check('heuristic source restored after reload', afterReload.includes(MARKER), afterReload.slice(0, 120));

// ---------------------------------------------------------------------------
console.log('\n=== an edit is flushed even when the page is closed immediately ===');
await gotoPythonHeuristic(page);
const FLUSH_MARKER = '# marker_flush_' + Date.now();
await page.locator('.python-editor .cm-content').click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type(FLUSH_MARKER);
// Deliberately shorter than the 400ms write debounce: only the pagehide flush
// can save this edit.
await page.waitForTimeout(60);
await gotoPythonHeuristic(page);
const flushed = await page.locator('.python-editor .cm-content').innerText();
check('edit within the debounce window survives navigation', flushed.includes(FLUSH_MARKER), flushed.slice(0, 120));

// ---------------------------------------------------------------------------
console.log('\n=== a shared link still wins over stored work ===');
const sharedPayload = encodeURIComponent(
  JSON.stringify({ kind: 'search-heuristic', source: '# marker_shared_wins\ndef heuristic(state):\n    return 1\n' })
);
await page.goto(`${targetUrl}?shared=${sharedPayload}`, { waitUntil: 'load' });
await page.waitForSelector('.python-editor .cm-content', { timeout: 20000 });
const sharedText = await page.locator('.python-editor .cm-content').innerText();
check('shared link overrides stored source', sharedText.includes('marker_shared_wins'), sharedText.slice(0, 120));
check('  -> and the stored source is not shown', !sharedText.includes(MARKER));

// ---------------------------------------------------------------------------
console.log('\n=== Reset to template clears stored work ===');
await gotoPythonHeuristic(page);
await page.getByRole('button', { name: 'Reset to template' }).click();
await page.waitForTimeout(900);
const afterReset = await page.locator('.python-editor .cm-content').innerText();
check('editor returns to the template', !afterReset.includes(MARKER) && afterReset.includes('def heuristic'), afterReset.slice(0, 120));
await gotoPythonHeuristic(page);
const afterResetReload = await page.locator('.python-editor .cm-content').innerText();
check('  -> and the reset survives a reload', !afterResetReload.includes(MARKER));

// ---------------------------------------------------------------------------
console.log('\n=== the app still works when localStorage throws (private window) ===');
const hostileContext = await browser.newContext();
const hostile = await hostileContext.newPage();
const hostileErrors = [];
hostile.on('pageerror', (e) => hostileErrors.push(e.message));
// Make every localStorage access throw, the way a blocked-site-data browser does.
await hostile.addInitScript(() => {
  const boom = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      return { getItem: boom, setItem: boom, removeItem: boom };
    },
  });
});
await gotoPythonHeuristic(hostile);
const hostileEditor = await hostile.locator('.python-editor .cm-content').innerText().catch(() => '');
check('app renders with storage unavailable', hostileEditor.includes('def heuristic'), hostileEditor.slice(0, 120));
await hostile.locator('.python-editor .cm-content').click();
await hostile.keyboard.type('# typing still works\n');
await hostile.waitForTimeout(900);
check('  -> and typing raises no page error', hostileErrors.length === 0, hostileErrors.join(' | '));
await hostileContext.close();

console.log('\n=== page errors ===');
if (pageErrors.length) {
  console.log(pageErrors.join('\n---\n'));
  failures.push('page errors');
} else console.log('NO PAGE ERRORS');

await browser.close();
console.log(failures.length ? `\n=== ${failures.length} FAILURE(S): ${failures.join(', ')} ===` : '\n=== ALL CASES PASS ===');
process.exit(failures.length ? 1 : 0);
