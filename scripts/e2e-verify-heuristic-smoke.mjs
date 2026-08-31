// End-to-end coverage for heuristic verification: the WebMCP tool, the
// three-verdict soundness model, and the human-facing UI it paints.
//   node scripts/e2e-verify-heuristic-smoke.mjs http://localhost:5173/
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

const authorAndVerify = async (problem_id, source_code, extra = {}) => {
  const h = await call('search_author_python_heuristic', { problem_id, source_code });
  if (!h.valid) return { authorFailed: h };
  return call('search_verify_heuristic', { problem_id, heuristic_id: h.heuristic_id, ...extra });
};

// ---------------------------------------------------------------------------
console.log('\n=== maze: an admissible+consistent heuristic is PROVEN ===');
const maze = await call('search_author_maze', { rows: 10, cols: 10, wall_density: 0, seed: 3 });
const good = await authorAndVerify(
  maze.problem_id,
  'def heuristic(state):\n    r, c = state\n    return abs(r - 9) + abs(c - 9)\n'
);
check('manhattan verdict is "proven"', good.verdict === 'proven', JSON.stringify(good).slice(0, 200));
check('  -> admissible holds', good.admissible?.holds === true);
check('  -> consistent holds', good.consistent?.holds === true);
check('  -> ground truth from start was computed', typeof good.optimal_cost_from_initial === 'number', String(good.optimal_cost_from_initial));

// ---------------------------------------------------------------------------
console.log('\n=== maze: an inflated heuristic is REFUTED with a usable counterexample ===');
const bad = await authorAndVerify(
  maze.problem_id,
  'def heuristic(state):\n    r, c = state\n    return 3 * (abs(r - 9) + abs(c - 9))\n'
);
check('inflated verdict is "refuted"', bad.verdict === 'refuted', JSON.stringify(bad).slice(0, 200));
const ce = bad.admissible?.counterexample;
check('  -> names a concrete state', Array.isArray(ce?.state), JSON.stringify(ce));
check('  -> reports h, the true cost, and the margin', typeof ce?.h_value === 'number' && typeof ce?.true_cost === 'number' && ce?.overestimate_by > 0, JSON.stringify(ce));
check('  -> h really does exceed the true cost', ce && ce.h_value > ce.true_cost, JSON.stringify(ce));

// ---------------------------------------------------------------------------
console.log('\n=== goal-zero is checked separately from admissibility ===');
const nonzero = await authorAndVerify(maze.problem_id, 'def heuristic(state):\n    return 5\n');
check('constant heuristic violates goal-zero', nonzero.goal_zero?.holds === false, JSON.stringify(nonzero.goal_zero));
check('  -> and stays consistent (a constant never drops)', nonzero.consistent?.holds === true, JSON.stringify(nonzero.consistent));

// ---------------------------------------------------------------------------
console.log('\n=== N-Queens: many goal states (the maze-only ground truth could not do this) ===');
const nq = await call('search_author_n_queens', { n: 6 });
const nqGood = await authorAndVerify(nq.problem_id, 'def heuristic(state):\n    return 6 - len(state)\n');
check('n-queens verifies at all', nqGood.verdict === 'proven', JSON.stringify(nqGood).slice(0, 200));
check('  -> found multiple goal states', nqGood.goal_states_found > 1, String(nqGood.goal_states_found));
const nqBad = await authorAndVerify(nq.problem_id, 'def heuristic(state):\n    return 10 * (6 - len(state))\n');
check('n-queens inflated heuristic is refuted', nqBad.verdict === 'refuted', JSON.stringify(nqBad).slice(0, 160));

// ---------------------------------------------------------------------------
console.log('\n=== soundness: a tiny budget must degrade, never lie ===');
const truncated = await authorAndVerify(
  maze.problem_id,
  'def heuristic(state):\n    r, c = state\n    return abs(r - 9) + abs(c - 9)\n',
  { state_budget: 20 }
);
check('budget-limited run reports "unrefuted", not "proven"', truncated.verdict === 'unrefuted', JSON.stringify(truncated).slice(0, 200));
check('  -> and says so explicitly', truncated.budget_exceeded === true);
check('  -> summary refuses to claim admissibility', /not|does NOT|could not/i.test(truncated.summary ?? ''), truncated.summary);

console.log('\n=== soundness: refutation still works under a tiny budget ===');
const truncRefuted = await authorAndVerify(
  maze.problem_id,
  'def heuristic(state):\n    r, c = state\n    return 10 * (abs(r - 9) + abs(c - 9))\n',
  { state_budget: 20 }
);
check('refutation survives truncation', truncRefuted.verdict === 'refuted', JSON.stringify(truncRefuted).slice(0, 200));

// ---------------------------------------------------------------------------
console.log('\n=== a custom Python problem can be verified too ===');
const pyProblem = await call('search_author_python_problem', {
  source_code: [
    'from polysearch.interfaces import StateSpaceProblem',
    'class Problem(StateSpaceProblem):',
    '    def initial_state(self): return 0',
    '    def goal_check(self, s): return s == 6',
    '    def operators(self): return [lambda s: s + 1, lambda s: s + 2]',
    '    def apply_operator(self, op, s):',
    '        n = op(s)',
    '        return n if n <= 6 else None',
    '    def cost(self, a, b): return 1',
  ].join('\n'),
});
const pyVerified = await authorAndVerify(pyProblem.problem_id, 'def heuristic(state):\n    return (6 - state) / 2\n');
check('custom problem + custom heuristic verifies', pyVerified.verdict === 'proven', JSON.stringify(pyVerified).slice(0, 220));
const pyBad = await authorAndVerify(pyProblem.problem_id, 'def heuristic(state):\n    return 6 - state\n');
check('  -> and an over-tight heuristic on it is refuted', pyBad.verdict === 'refuted', JSON.stringify(pyBad).slice(0, 220));

// ---------------------------------------------------------------------------
console.log('\n=== the agent\'s verdict lands on the page the human is looking at ===');
await page.waitForTimeout(400);
const cardVisible = await page.locator('.verify-card').count();
check('a verification card is rendered', cardVisible > 0, `count=${cardVisible}`);

// Re-verify against the maze so the card describes the visible board.
const shown = await authorAndVerify(
  maze.problem_id,
  'def heuristic(state):\n    r, c = state\n    return 3 * (abs(r - 9) + abs(c - 9))\n'
);
await page.waitForTimeout(500);
const cardText = await page.locator('.verify-card').innerText().catch(() => '');
check('card shows the refuted verdict', /refuted/i.test(cardText), cardText.slice(0, 160));
check('card explains the overestimate in words', /overestimate|true remaining cost/i.test(cardText), cardText.slice(0, 300));
check('card reports how many states were checked', /checked/i.test(cardText), cardText.slice(0, 200));
await page.screenshot({ path: SHOT_DIR + 'verify-heuristic-refuted.png', fullPage: true });

// Stale-verdict guard: switching to another problem must not show this verdict.
await call('search_author_n_queens', { n: 5 });
await page.waitForTimeout(400);
const staleCards = await page.locator('.verify-card').count();
check('verdict is hidden once a different problem becomes active', staleCards === 0, `count=${staleCards}`);

console.log('\n=== page errors ===');
if (pageErrors.length) {
  console.log(pageErrors.join('\n---\n'));
  failures.push('page errors');
} else console.log('NO PAGE ERRORS');

await browser.close();
console.log(failures.length ? `\n=== ${failures.length} FAILURE(S): ${failures.join(', ')} ===` : '\n=== ALL CASES PASS ===');
process.exit(failures.length ? 1 : 0);
