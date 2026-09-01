// End-to-end coverage for the interleaved activity log: that a human's clicks
// and an agent's tool calls land on ONE timeline, are distinguishable, and are
// honest about failure.
//   node scripts/e2e-activity-log-smoke.mjs http://localhost:5173/
//
// The assertion that matters is the interleaving one: a human action recorded
// BETWEEN two agent calls, in the order they happened. Two separate lists
// would pass every other check here and still lose the only thing this panel
// proves.
import { chromium } from 'playwright';
import fs from 'node:fs';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const SHOT_DIR = new URL('../.smoke-shots/', import.meta.url).pathname;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const failures = [];
const pageErrors = [];
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`);
    failures.push(name);
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => pageErrors.push(e.stack || String(e)));

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForFunction(() => typeof navigator.modelContextTesting?.executeTool === 'function', null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('.status-neutral')?.textContent?.includes('Ready'), null, { timeout: 120000 });

const call = (name, args) =>
  page.evaluate(
    async ({ name, args }) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args))),
    { name, args }
  );

// Oldest-first, matching the order things actually happened. The list renders
// newest-first, so this reverses it back.
const timeline = () =>
  page.$$eval('.activity-entry', (nodes) =>
    nodes
      .map((n) => ({
        actor: n.classList.contains('actor-human') ? 'human' : 'agent',
        label: n.querySelector('.activity-name')?.textContent ?? '',
        status: (n.className.match(/status-(\w+)/) ?? [])[1] ?? '',
      }))
      .reverse()
  );

// ---------------------------------------------------------------------------
console.log('\n=== an empty log invites both sides ===');
const emptyText = await page.locator('.activity-log-empty').innerText().catch(() => '');
check('empty state mentions clicking as well as asking an agent', /click/i.test(emptyText) && /agent/i.test(emptyText), emptyText);

// ---------------------------------------------------------------------------
console.log('\n=== an agent tool call is recorded as the agent ===');
await call('search_author_maze', { rows: 8, cols: 8, wall_density: 0, seed: 1 });
await page.waitForTimeout(300);
let entries = await timeline();
check('one entry so far', entries.length === 1, JSON.stringify(entries));
check('  -> attributed to the agent', entries[0]?.actor === 'agent', JSON.stringify(entries[0]));
check('  -> and named by its tool name', entries[0]?.label === 'search_author_maze', JSON.stringify(entries[0]));

// ---------------------------------------------------------------------------
console.log('\n=== a human click is recorded as the human, on the same list ===');
await page.click('.search-controls button:has-text("New Maze")');
await page.waitForTimeout(300);
entries = await timeline();
check('a second entry appeared', entries.length === 2, JSON.stringify(entries));
check('  -> attributed to the human', entries[1]?.actor === 'human', JSON.stringify(entries[1]));
check('  -> and named by the button, not a tool', entries[1]?.label === 'New Maze', JSON.stringify(entries[1]));

// ---------------------------------------------------------------------------
console.log('\n=== the interleaving is preserved in order ===');
await call('search_get_state', {});
await page.waitForTimeout(300);
entries = await timeline();
const shape = entries.map((e) => e.actor).join(',');
check('agent, then human, then agent — on one timeline', shape === 'agent,human,agent', shape);
check('  -> and the human entry sits between the two agent ones', entries[1]?.label === 'New Maze', JSON.stringify(entries));

// ---------------------------------------------------------------------------
console.log('\n=== a human run through Pyodide is recorded with its result ===');
await page.click('.search-controls button:has-text("Run")');
await page.waitForTimeout(2500);
entries = await timeline();
const humanRun = entries.filter((e) => e.actor === 'human' && e.label === 'Run');
check('the Run click is logged', humanRun.length === 1, JSON.stringify(entries));
check('  -> and completed ok', humanRun[0]?.status === 'ok', JSON.stringify(humanRun[0]));

// ---------------------------------------------------------------------------
console.log('\n=== a human click that succeeds ===');
await page.click('.app-tabs button:has-text("Sort")');
await page.waitForTimeout(200);
await page.click('.mode-toggle button:has-text("Write your own")');
await page.waitForTimeout(200);
await page.click('.sub-toggle button:has-text("Comparator")');
await page.waitForTimeout(300);
await page.fill('.search-controls input[type="text"]', '9, 4, 7');
await page.click('.search-controls button:has-text("Validate & Verify")');
await page.waitForTimeout(5000);
entries = await timeline();
const okVerify = entries.filter((e) => e.actor === 'human' && e.label === 'Validate & Verify');
check('the Validate & Verify click is logged', okVerify.length === 1, JSON.stringify(entries.slice(-4)));
check('  -> and the template comparator verifies ok', okVerify[0]?.status === 'ok', JSON.stringify(okVerify[0]));

// ---------------------------------------------------------------------------
console.log('\n=== a human failure is recorded as an error, not a silent success ===');
// This is the case the wrapper is easy to get wrong: authoring paths fail by
// RETURNING {valid:false} rather than throwing, so a naive wrapper logs a
// broken-Python click as 'ok'. Replace the editor's contents with a function
// under the wrong name, which authoring rejects without raising.
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('def wrong_name(a, b):\n    return 0\n');
await page.waitForTimeout(300);
await page.click('.search-controls button:has-text("Validate & Verify")');
await page.waitForTimeout(5000);
entries = await timeline();
const failedHuman = entries.filter((e) => e.actor === 'human' && e.label === 'Validate & Verify');
check('the failing click is logged too', failedHuman.length === 2, JSON.stringify(entries.slice(-4)));
check('  -> and is recorded as an error, not ok', failedHuman[1]?.status === 'error', JSON.stringify(failedHuman[1]));
const errText = await page.locator('.activity-entry.actor-human.status-error .activity-error').first().innerText().catch(() => '');
check('  -> carrying the friendly error, not a generic failure', /comparator/i.test(errText), errText.slice(0, 160));

// ---------------------------------------------------------------------------
console.log('\n=== the filter can isolate either side without losing the other ===');
const total = (await timeline()).length;
await page.click('.activity-filter button:has-text("You")');
await page.waitForTimeout(200);
const humanOnly = await timeline();
check('filtering to You shows only human entries', humanOnly.length > 0 && humanOnly.every((e) => e.actor === 'human'), JSON.stringify(humanOnly));
await page.click('.activity-filter button:has-text("Agent")');
await page.waitForTimeout(200);
const agentOnly = await timeline();
check('filtering to Agent shows only agent entries', agentOnly.length > 0 && agentOnly.every((e) => e.actor === 'agent'), JSON.stringify(agentOnly));
check('  -> and the two partitions account for every entry', humanOnly.length + agentOnly.length === total, `${humanOnly.length} + ${agentOnly.length} != ${total}`);
await page.click('.activity-filter button:has-text("All")');
await page.waitForTimeout(200);
check('All restores the full timeline', (await timeline()).length === total);

await page.screenshot({ path: SHOT_DIR + 'activity-log.png', fullPage: true });

console.log('\n=== page errors ===');
if (pageErrors.length) {
  console.log(pageErrors.join('\n---\n'));
  failures.push('page errors');
} else console.log('NO PAGE ERRORS');

await browser.close();
console.log(failures.length ? `\n=== ${failures.length} FAILURE(S): ${failures.join(', ')} ===` : '\n=== ALL CASES PASS ===');
process.exit(failures.length ? 1 : 0);
