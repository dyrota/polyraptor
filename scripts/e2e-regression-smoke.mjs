// Regression suite for the bugs found in the full audit. Same shape as the
// other e2e-*.mjs scripts: real Chrome, real WebMCP tool calls, real Pyodide.
// Every case here FAILED before its fix, so this is the file that keeps them
// fixed. Run against a dev server:
//   node scripts/e2e-regression-smoke.mjs http://localhost:5173/
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const failures = [];
const pageErrors = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`);
    failures.push(name);
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();
page.on('pageerror', (err) => pageErrors.push(err.stack || String(err)));

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForFunction(() => typeof navigator.modelContextTesting?.executeTool === 'function', null, { timeout: 30000 });
// Wait for the wheels to finish installing before any tool that runs Python.
await page.waitForFunction(() => document.querySelector('.status-neutral')?.textContent?.includes('Ready'), null, {
  timeout: 120000,
});

const call = (name, args) =>
  page.evaluate(
    async ({ name, args }) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args))),
    { name, args }
  );

// ---------------------------------------------------------------------------
console.log('\n=== 1. maze author: hostile start/goal coords ===');
// Fractional coords used to hang the tab forever in the L-shaped fallback walk
// (r stepping ±1 from 1.5 straddles an integer goal and never equals it).
// Out-of-bounds coords threw a TypeError out of isSolvable.
const hostile = [
  ['fractional (previously an unrecoverable hang)', { rows: 8, cols: 8, start: [1.5, 2.5] }],
  ['out of bounds', { rows: 8, cols: 8, start: [99, 99] }],
  ['negative', { rows: 8, cols: 8, goal: [-4, -4] }],
];
for (const [label, args] of hostile) {
  const started = Date.now();
  const res = await Promise.race([
    call('search_author_maze', args),
    new Promise((r) => setTimeout(() => r({ timedOut: true }), 20000)),
  ]);
  check(
    `search_author_maze survives ${label}`,
    !res.timedOut && !res.error && typeof res.problem_id === 'string',
    JSON.stringify(res).slice(0, 140)
  );
  // Coordinates must come back clamped into the grid, not echoed back raw.
  if (res.start) {
    const inGrid = (c) => Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[0] < 8 && c[1] >= 0 && c[1] < 8;
    check(`  -> clamped to an in-grid integer cell (${Date.now() - started}ms)`, inGrid(res.start) && inGrid(res.goal), JSON.stringify(res.start) + '/' + JSON.stringify(res.goal));
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. hill climbing that gets stuck must not report success ===');
// hill_climbing_search returns its PARTIAL path when it stalls, which
// "path is not None" read as a solution: 6-queens reported path_found:true,
// path_length:1, cost:0 for a run that never placed a queen.
const nq = await call('search_author_n_queens', { n: 6 });
const hc = await call('search_run_algorithm', { problem_id: nq.problem_id, algorithm: 'hill_climbing', heuristic: 'attacking_queen_pairs' });
check(
  'stuck hill climbing reports path_found:false',
  hc.summary.path_found === false,
  JSON.stringify(hc.summary)
);
check('  -> and reports no cost alongside it', hc.summary.cost === null || hc.summary.cost === undefined, String(hc.summary.cost));

// ---------------------------------------------------------------------------
console.log('\n=== 3. iterative deepening actually iterates ===');
// Handed an explicit max_depth the library runs ONE depth-limited DFS at that
// depth, so it returned the first path it stumbled into (41 steps on an open
// 8x8) rather than the shallowest, and reported inferences:0 every time.
const maze = await call('search_author_maze', { rows: 8, cols: 8, wall_density: 0, seed: 7 });
const bfs = await call('search_run_algorithm', { problem_id: maze.problem_id, algorithm: 'breadth_first' });
const idd = await call('search_run_algorithm', { problem_id: maze.problem_id, algorithm: 'iterative_deepening' });
check(
  'iterative_deepening finds the optimal-length path (matches BFS)',
  idd.summary.path_found && idd.summary.path_length === bfs.summary.path_length,
  `id=${idd.summary.path_length} bfs=${bfs.summary.path_length}`
);
check('iterative_deepening reports a real inference count, not 0', idd.summary.inferences > 0, String(idd.summary.inferences));

// ---------------------------------------------------------------------------
console.log('\n=== 4. heuristic/problem mismatch is explained, not a raw AttributeError ===');
// Each heuristic is a method on ONE problem class; the schema offers all four
// for every problem, so this pairing is easy for an agent to reach.
const mismatch = await call('search_run_algorithm', { problem_id: nq.problem_id, algorithm: 'a_star', heuristic: 'manhattan_distance' });
check(
  'wrong heuristic for problem type returns a guiding message',
  mismatch.error === true && /attacking_queen_pairs/.test(mismatch.message ?? ''),
  JSON.stringify(mismatch).slice(0, 200)
);

// ---------------------------------------------------------------------------
console.log('\n=== 5. a heuristic returning float("inf") does not break the bridge ===');
// json.dumps emits a bare `Infinity` token, which JS's JSON.parse rejects --
// and "return inf for unreachable" is the textbook way to write a heuristic.
const infH = await call('search_author_python_heuristic', {
  problem_id: maze.problem_id,
  source_code: 'def heuristic(state):\n    return float("inf") if state == (3, 3) else 0\n',
});
check('heuristic returning inf validates cleanly', infH.valid === true, JSON.stringify(infH).slice(0, 200));
if (infH.valid) {
  const infRun = await call('search_run_python_heuristic', { problem_id: maze.problem_id, heuristic_id: infH.heuristic_id, algorithm: 'a_star' });
  check('  -> and runs to completion', infRun.ok === true, JSON.stringify(infRun).slice(0, 200));
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. a non-JSON-serializable initial_state is accepted ===');
// StateSpaceProblem requires states to be HASHABLE (they go into visited
// sets), not JSON-serializable. A frozenset is a legitimate state.
const fs = await call('search_author_python_problem', {
  source_code: [
    'from polysearch.interfaces import StateSpaceProblem',
    'class Problem(StateSpaceProblem):',
    '    def initial_state(self): return frozenset({1, 2})',
    '    def goal_check(self, s): return len(s) >= 4',
    '    def operators(self): return [lambda s: s | {max(s) + 1}]',
    '    def apply_operator(self, op, s): return op(s)',
    '    def cost(self, a, b): return 1',
  ].join('\n'),
});
check('frozenset initial_state is accepted', fs.valid === true, JSON.stringify(fs).slice(0, 220));

// ---------------------------------------------------------------------------
console.log('\n=== 7. benchmarking a custom sort problem must not silently ignore its comparator ===');
// runSortAlgorithm rewraps values in the trusted ASCENDING problem class, so
// benchmarking a descending custom problem used to report ascending results
// as if they were that problem's.
const desc = await call('sort_author_python_comparator', {
  values: [5, 3, 8, 1],
  source_code: 'def comparator(a, b):\n    return (a < b) - (a > b)\n',
});
const bench = await call('sort_benchmark_compare', { problem_id: desc.problem_id, algorithms: ['bubble_sort', 'merge_sort'] });
check(
  'sort_benchmark_compare refuses a python_problem instead of answering wrongly',
  bench.error === true,
  JSON.stringify(bench).slice(0, 200)
);

// ---------------------------------------------------------------------------
console.log('\n=== 8. mutating tools are not advertised as read-only ===');
// Every tool defaulted to readOnlyHint:true, including every authoring, running
// and playback tool -- the exact opposite of what they do.
const tools = await page.evaluate(() =>
  navigator.modelContextTesting.listTools().map((t) => ({ name: t.name, ro: t.annotations?.readOnlyHint }))
);
// The testing API doesn't necessarily surface annotations at all; only assert
// on them when it does, so this case reports "unavailable" rather than a
// false failure on a Chrome build that omits them.
const exposesAnnotations = tools.some((t) => t.ro !== undefined);
if (!exposesAnnotations) {
  console.log('SKIP: this Chrome build does not expose annotations via modelContextTesting.listTools()');
} else {
  const shouldMutate = ['search_author_maze', 'search_run_algorithm', 'sort_run_algorithm', 'playback_play', 'playback_jump_to'];
  const wrong = tools.filter((t) => shouldMutate.includes(t.name) && t.ro === true);
  check('page-mutating tools declare readOnlyHint:false', wrong.length === 0, JSON.stringify(wrong));
  const readOnly = tools.filter((t) => ['search_benchmark_compare', 'playback_get_state'].includes(t.name));
  check(
    'genuinely read-only tools still declare readOnlyHint:true',
    readOnly.length === 2 && readOnly.every((t) => t.ro === true),
    JSON.stringify(readOnly)
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== 9. missionaries banks follow the state, not the boat ===');
// polysearch's (m, c, boat) counts are always the number still on the STARTING
// bank. Conditioning them on boat position inverted every state where the boat
// was on the right -- including the goal (0,0,0), which drew all six people
// still on the left under a caption saying they had crossed.
const mc = await call('search_author_missionaries_and_cannibals', {});
const mcRun = await call('search_run_algorithm', { problem_id: mc.problem_id, algorithm: 'breadth_first' });
await call('playback_jump_to', { trace_id: mcRun.trace_id, seq: mcRun.trace_length - 1 });
await page.waitForTimeout(300);
const banks = await page.$$eval('.mc-bank', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
check(
  'at the goal state the start bank is empty',
  /start bank: 0 missionaries, 0 cannibals/.test(banks[0] ?? ''),
  JSON.stringify(banks)
);
check(
  '  -> and everyone is on the goal bank, with the boat',
  /goal bank: 3 missionaries, 3 cannibals, boat here/.test(banks[1] ?? ''),
  JSON.stringify(banks)
);
// The caption belongs under the scene, not as a third flex column beside it.
const captionBelow = await page.evaluate(() => {
  const cap = document.querySelector('.mc-caption');
  const bank = document.querySelector('.mc-bank');
  return cap && bank ? cap.getBoundingClientRect().top >= bank.getBoundingClientRect().bottom - 1 : false;
});
check('missionaries caption renders below the banks', captionBelow);

// ---------------------------------------------------------------------------
console.log('\n=== 10. propose_heuristic produces a complete run summary ===');
// It used to hand its trace a hand-built {path_found, cost}, so the panel
// rendered "path length , cost 18,  states expanded" with two blanks and the
// solution path was never painted (MazeCanvas colours summary.path).
const pMaze = await call('search_author_maze', { rows: 10, cols: 10, wall_density: 0.25, seed: 7 });
await call('search_propose_heuristic', { problem_id: pMaze.problem_id, weights: { manhattan_distance: 1 }, algorithm: 'a_star' });
await page.waitForTimeout(400);
const proposeSummary = await page.locator('.search-summary').innerText();
check(
  'on-page summary has no blank fields',
  /path length \d+, cost \d+, \d+ states expanded/.test(proposeSummary),
  JSON.stringify(proposeSummary)
);
const proposeState = await call('search_get_state', {});
check(
  '  -> and the trace carries the path for the canvas to paint',
  Array.isArray(proposeState.active_trace?.summary?.path) && proposeState.active_trace.summary.path.length > 0,
  JSON.stringify(proposeState.active_trace?.summary ?? null).slice(0, 200)
);

// ---------------------------------------------------------------------------
console.log('\n=== 11. the family switcher is a keyboard-operable tablist ===');
// role="tablist" is a promise about keyboard behaviour; announcing the role and
// then ignoring arrow keys leaves a keyboard user worse off than plain buttons.
await page.getByRole('tab', { name: 'Search', exact: true }).focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const afterArrow = await page.evaluate(() => ({
  selected: [...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-selected')),
  focused: document.activeElement?.id ?? null,
  roving: [...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('tabindex')),
}));
check(
  'ArrowRight moves selection and focus to the next tab',
  afterArrow.selected[1] === 'true' && afterArrow.focused === 'tab-sort',
  JSON.stringify(afterArrow)
);
check('  -> with a roving tabindex, so Tab enters the tablist once', afterArrow.roving.join(',') === '-1,0', JSON.stringify(afterArrow.roving));
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
check(
  'ArrowLeft moves back',
  (await page.evaluate(() => document.activeElement?.id)) === 'tab-search'
);

// ---------------------------------------------------------------------------
console.log('\n=== 12. a share link no longer destroys the draft it replaces ===');
// A shared link wins over whatever is saved in that slot, which is the right
// precedence -- but it used to overwrite the draft underneath silently, with no
// copy kept anywhere and no way back ("Reset to template" gives you the
// template, and the ?shared= param is stripped once consumed). The displaced
// draft is now set aside and offered back.
const MARK = '# MY_OWN_WORK_MARKER';
const slotKey = (s) => 'polyraptor:v1:' + s;
const readSlot = (s) => page.evaluate((k) => localStorage.getItem(k), slotKey(s));

await page.evaluate(() => localStorage.clear());
await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.click('.mode-toggle button:has-text("Write your own")');
await page.click('.mode-toggle.sub-toggle button:has-text("Problem")');
await page.waitForTimeout(250);
await page.click('.python-editor .cm-content');
await page.keyboard.press('Control+Home');
await page.keyboard.type(`${MARK}\n`);
await page.waitForTimeout(800); // past the 400ms persistence debounce
check('the human\'s draft is saved', (await readSlot('search-problem'))?.includes(MARK));

const shareHref =
  targetUrl.replace(/\/?$/, '/') +
  '?shared=' +
  encodeURIComponent(JSON.stringify({ kind: 'search-problem', source: '# someone else\'s code\n' }));
await page.goto(shareHref, { waitUntil: 'load' });
await page.waitForTimeout(1500);
check('the shared source is what loads', (await readSlot('search-problem'))?.startsWith("# someone else"));
check('  -> and the displaced draft was kept, not destroyed', (await readSlot('search-problem:displaced'))?.includes(MARK));

await page.click('.mode-toggle button:has-text("Write your own")');
await page.waitForTimeout(300);
check('a notice offers it back', await page.locator('.displaced-notice').isVisible().catch(() => false));
await page.click('button:has-text("Restore my problem")');
await page.waitForTimeout(800);
check(
  '  -> Restore returns it to the editor',
  (await page.locator('.python-editor .cm-content').innerText()).includes(MARK)
);
check('  -> and clears the backup so it stops being offered', (await readSlot('search-problem:displaced')) === null);

// An untouched template is not "work", so arriving on a link must not offer it
// back. Reached by resetting rather than by clearing localStorage directly:
// the pagehide flush writes the live page's React state on the way out, so
// clearing storage under a page that still holds a draft just puts it back.
// Resetting makes the page itself hold the template, which is the state under
// test anyway.
await page.click('button:has-text("Reset to template")');
await page.waitForTimeout(800);
await page.goto(shareHref, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.click('.mode-toggle button:has-text("Write your own")');
await page.waitForTimeout(300);
check(
  'an untouched template is not offered back as a displaced draft',
  !(await page.locator('.displaced-notice').isVisible().catch(() => false))
);

// ---------------------------------------------------------------------------
console.log('\n=== page errors ===');
if (pageErrors.length) {
  console.log(pageErrors.join('\n---\n'));
  failures.push('page errors were raised');
} else {
  console.log('NO PAGE ERRORS');
}

await browser.close();

console.log(failures.length ? `\n=== ${failures.length} FAILURE(S): ${failures.join(', ')} ===` : '\n=== ALL CASES PASS ===');
process.exit(failures.length ? 1 : 0);
