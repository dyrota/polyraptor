// Exercises the sort family end to end: all 4 built-in datasets + custom,
// one algorithm from each on_step-shape bucket, benchmark_compare, and
// playback — plus a re-check that search still works after the shared
// trace-store/collector refactor.
//   node scripts/e2e-sort-smoke.mjs http://localhost:5173/
import { chromium } from 'playwright';
import fs from 'node:fs';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const SHOT_DIR = new URL('../.smoke-shots/', import.meta.url).pathname;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.stack || String(err)));

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(3500);

const result = await page.evaluate(async () => {
  const call = async (name, args) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args)));
  const out = {};

  // All 4 built-in datasets + custom.
  out.random = await call('sort_author_dataset', { dataset_type: 'random_integers', size: 20, seed: 42 });
  out.nearly = await call('sort_author_dataset', { dataset_type: 'nearly_sorted', size: 20, swaps: 3, seed: 1 });
  out.reverse = await call('sort_author_dataset', { dataset_type: 'reverse_sorted', size: 20 });
  out.dupes = await call('sort_author_dataset', { dataset_type: 'many_duplicates', size: 20, distinct: 3, seed: 7 });
  out.custom = await call('sort_author_custom', { values: [5, 3, 8, 1, 9, 2, 7, 4, 6] });

  // One algorithm from each verified event-shape bucket.
  out.bubbleRun = await call('sort_run_algorithm', { problem_id: out.random.problem_id, algorithm: 'bubble_sort' });
  out.insertionRun = await call('sort_run_algorithm', { problem_id: out.nearly.problem_id, algorithm: 'insertion_sort' });
  out.mergeRun = await call('sort_run_algorithm', { problem_id: out.reverse.problem_id, algorithm: 'merge_sort' });
  out.countingRun = await call('sort_run_algorithm', { problem_id: out.dupes.problem_id, algorithm: 'counting_sort' });
  out.quickRun = await call('sort_run_algorithm', { problem_id: out.custom.problem_id, algorithm: 'quick_sort' });
  out.shellRun = await call('sort_run_algorithm', { problem_id: out.random.problem_id, algorithm: 'shell_sort' });
  out.heapRun = await call('sort_run_algorithm', { problem_id: out.random.problem_id, algorithm: 'heap_sort' });
  out.selectionRun = await call('sort_run_algorithm', { problem_id: out.random.problem_id, algorithm: 'selection_sort' });
  out.timRun = await call('sort_run_algorithm', { problem_id: out.random.problem_id, algorithm: 'tim_sort' });
  out.radixRun = await call('sort_run_algorithm', { problem_id: out.random.problem_id, algorithm: 'radix_sort' });

  out.benchmark = await call('sort_benchmark_compare', {
    problem_id: out.random.problem_id,
    algorithms: ['bubble_sort', 'quick_sort', 'merge_sort', 'counting_sort'],
  });

  await call('playback_play', { trace_id: out.mergeRun.trace_id, speed: 4 });

  return out;
});

console.log('=== is_sorted for every run (must all be true) ===');
for (const key of ['bubbleRun', 'insertionRun', 'mergeRun', 'countingRun', 'quickRun', 'shellRun', 'heapRun', 'selectionRun', 'timRun', 'radixRun']) {
  console.log(key, '->', result[key].summary.is_sorted, JSON.stringify(result[key].summary));
}
console.log('\n=== benchmark ===');
console.log(JSON.stringify(result.benchmark, null, 2));

await page.waitForTimeout(1000);
await page.screenshot({ path: SHOT_DIR + 'sort-01-random-bubble.png' });

// Switch view to the merge trace to screenshot it mid-animation.
await page.evaluate(async (traceId) => {
  await navigator.modelContextTesting.executeTool('sort_run_algorithm', JSON.stringify({ problem_id: traceId, algorithm: 'merge_sort' }));
}, result.reverse.problem_id);
await page.click('.app-tabs button:has-text("Sort")').catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: SHOT_DIR + 'sort-02-merge-mid.png' });

// Re-check search still works after all the shared-file refactoring.
const searchResult = await page.evaluate(async () => {
  const call = async (name, args) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args)));
  const maze = await call('search_author_maze', { rows: 8, cols: 8, wall_density: 0.3 });
  const run = await call('search_run_algorithm', { problem_id: maze.problem_id, algorithm: 'a_star', heuristic: 'manhattan_distance' });
  return run.summary;
});
console.log('\n=== search regression check ===');
console.log(JSON.stringify(searchResult));

console.log('\n=== page errors ===');
pageErrors.forEach((e) => console.log(e));
console.log(pageErrors.length === 0 ? '\nNO PAGE ERRORS' : '\nPAGE ERRORS FOUND');

await browser.close();
process.exit(pageErrors.length > 0 ? 1 : 0);
