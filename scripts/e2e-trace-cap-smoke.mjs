// The trace store's event budget: traces used to accumulate forever, and a
// trace is orders of magnitude heavier than anything else this app keeps
// (a 300-element bubble sort is ~89,700 event objects). An agent benchmarking
// repeatedly -- the exact usage this app is built for -- grew the tab without
// bound.
//
// What must hold once the budget evicts something, and is checked here rather
// than assumed, because each has a plausible way to go wrong:
//   - the OLDEST goes, not an arbitrary one, and its id fails with the same
//     explanatory error an unknown trace_id has always produced;
//   - the NEWEST is never evicted, however large, since it is the one the
//     panel is about to draw;
//   - a trace left PLAYING while newer runs evict it stops its interval
//     instead of throwing into nobody's catch block once per tick;
//   - the page keeps rendering the active run throughout.
//
// Deliberately sized to the minimum that trips the budget: the runs here are
// the largest this app can make, which is the only way to reach it without
// making the suite slow for its own sake.
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const context = await browser.newContext();
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

let allPass = true;
function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${detail !== undefined ? ' -- ' + JSON.stringify(detail) : ''}`);
  if (!cond) allPass = false;
}

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const RUNS = 5;
const { traces, problemId } = await page.evaluate(async (runs) => {
  const call = async (name, args) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args)));
  // reverse_sorted at the maximum size is the worst case on purpose: bubble
  // sort on it is the largest trace this app can produce.
  const ds = await call('sort_author_dataset', { dataset_type: 'reverse_sorted', size: 300 });
  const out = [];
  for (let i = 0; i < runs; i++) {
    const run = await call('sort_run_algorithm', { problem_id: ds.problem_id, algorithm: 'bubble_sort' });
    out.push({ trace_id: run.trace_id, length: run.trace_length });
  }
  return { traces: out, problemId: ds.problem_id };
}, RUNS);

const total = traces.reduce((a, t) => a + t.length, 0);
check(`${RUNS} max-size runs exceed the event budget`, total > 400000, total);

const oldest = traces[0].trace_id;
const newest = traces[traces.length - 1].trace_id;

const oldestState = await page.evaluate(
  async (id) => JSON.parse(await navigator.modelContextTesting.executeTool('playback_get_state', JSON.stringify({ trace_id: id }))),
  oldest
);
check('the oldest trace was evicted', oldestState.error === true, JSON.stringify(oldestState).slice(0, 140));
check('  -> and its error still names the recovery call', /get_state/.test(oldestState.message ?? ''), oldestState.message);

const newestState = await page.evaluate(
  async (id) => JSON.parse(await navigator.modelContextTesting.executeTool('playback_get_state', JSON.stringify({ trace_id: id }))),
  newest
);
check('the newest trace is retained', newestState.total_length > 0, JSON.stringify(newestState).slice(0, 120));

// Leave it playing, then push it out from under its own interval.
await page.evaluate(
  async (id) => navigator.modelContextTesting.executeTool('playback_play', JSON.stringify({ trace_id: id, speed: 8 })),
  newest
);
await page.evaluate(
  async (id) => {
    const call = async (name, args) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args)));
    for (let i = 0; i < 5; i++) await call('sort_run_algorithm', { problem_id: id, algorithm: 'bubble_sort' });
  },
  problemId
);
await page.waitForTimeout(2000);
check('a playing trace being evicted raises nothing', pageErrors.length === 0, pageErrors.slice(0, 3));

check('the app is still alive', !(await page.evaluate(() => !!document.querySelector('.error-boundary-fallback'))));

// The panel only ever draws the ACTIVE trace, which is never the evicted one --
// seen rather than assumed. The app opens on Search, so switch to Sort first.
await page.click('.app-tabs button:has-text("Sort")');
await page.waitForTimeout(1500);
check('the active run still renders', await page.evaluate(() => !!document.querySelector('.bar-canvas-wrapper canvas')));
const playbackTotal = await page.evaluate(() => document.querySelector('.playback-position')?.textContent?.trim());
check('  -> with a live playback bar over the surviving trace', /\/\s*\d{4,}/.test(playbackTotal ?? ''), playbackTotal);

console.log('\n' + (allPass ? '=== ALL CASES PASS ===' : '=== AT LEAST ONE CASE FAILED ==='));
await browser.close();
process.exit(allPass ? 0 : 1);
