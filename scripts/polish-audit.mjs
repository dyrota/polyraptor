// One-off exploration script, not a permanent smoke test: visits every view
// across all three families on the live deployment and screenshots each,
// specifically to look for polish gaps rather than functional bugs (those are
// already covered by e2e-*-smoke.mjs).
import { chromium } from 'playwright';
import fs from 'node:fs';

const targetUrl = process.argv[2] || 'https://polyraptor.chase-c3f.workers.dev/';
const SHOT_DIR = new URL('../.smoke-shots/audit/', import.meta.url).pathname;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

const consoleMessages = [];
page.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleMessages.push('PAGEERROR: ' + (err.stack || String(err))));

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const call = (name, args) =>
  page.evaluate(
    async ({ name, args }) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args))),
    { name, args }
  );

// --- Search: N-Queens ---
await page.click('text=Search');
const nq = await call('search_author_n_queens', { n: 8 });
const nqRun = await call('search_run_algorithm', { problem_id: nq.problem_id, algorithm: 'breadth_first' });
await call('playback_jump_to', { trace_id: nqRun.trace_id, seq: Math.floor(nqRun.trace_length / 2) });
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT_DIR + '01-nqueens-mid.png', fullPage: true });
await call('playback_jump_to', { trace_id: nqRun.trace_id, seq: nqRun.trace_length - 1 });
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT_DIR + '01b-nqueens-solved.png', fullPage: true });

// --- Search: Missionaries ---
const mc = await call('search_author_missionaries_and_cannibals', {});
const mcRun = await call('search_run_algorithm', { problem_id: mc.problem_id, algorithm: 'breadth_first' });
await call('playback_jump_to', { trace_id: mcRun.trace_id, seq: Math.floor(mcRun.trace_length / 2) });
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT_DIR + '02-missionaries-mid.png', fullPage: true });

// --- Sort: radix (buffer-heavy visualization) ---
await page.click('text=Sort');
const ds = await call('sort_author_dataset', { dataset_type: 'random_integers', size: 20, seed: 42 });
const radixRun = await call('sort_run_algorithm', { problem_id: ds.problem_id, algorithm: 'radix_sort' });
await call('playback_jump_to', { trace_id: radixRun.trace_id, seq: Math.floor(radixRun.trace_length / 3) });
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT_DIR + '03-sort-radix-mid.png', fullPage: true });
await call('playback_jump_to', { trace_id: radixRun.trace_id, seq: radixRun.trace_length - 1 });
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT_DIR + '04-sort-radix-end.png', fullPage: true });

// --- Sort: merge (aux buffer rendering) ---
const mergeRun = await call('sort_run_algorithm', { problem_id: ds.problem_id, algorithm: 'merge_sort' });
await call('playback_jump_to', { trace_id: mergeRun.trace_id, seq: Math.floor(mergeRun.trace_length / 2) });
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT_DIR + '05-sort-merge-mid.png', fullPage: true });

// --- Evolve: idle + populated ---
await page.click('text=Evolve');
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT_DIR + '06-evolve-idle.png', fullPage: true });
await call('evolve_set_params', { population_size: 12, simulation_ticks: 200 });
await call('evolve_advance_generation', { generations: 3 });
await page.waitForTimeout(1000);
await page.screenshot({ path: SHOT_DIR + '07-evolve-populated.png', fullPage: true });

// --- Error-path UX: what does a bad tool call actually show the user? ---
const errorResult = await page.evaluate(async () => {
  try {
    return await navigator.modelContextTesting.executeTool('search_run_algorithm', JSON.stringify({ problem_id: 'nonexistent-id', algorithm: 'a_star' }));
  } catch (e) {
    return 'THREW: ' + String(e);
  }
});
await page.waitForTimeout(300);
await page.click('text=Search');
await page.screenshot({ path: SHOT_DIR + '08-after-bad-tool-call.png', fullPage: true });

// --- Mobile viewport check ---
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT_DIR + '09-mobile-search.png', fullPage: true });

console.log('errorResult:', errorResult);
console.log('\n=== console/page errors ===');
consoleMessages.forEach((m) => console.log(m));
console.log(`\nScreenshots in ${SHOT_DIR}`);

await browser.close();
