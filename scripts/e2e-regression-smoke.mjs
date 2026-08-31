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
