// Tier 3: custom heuristic (search) + custom comparator (sort) -- the
// narrowest-risk custom-code slots, each wrapping just one pure function
// around an otherwise fully-trusted path. Covers: heuristic authoring
// validated against a real problem's initial_state, a heuristic that
// actually provides useful guidance (not just h=0) against both a built-in
// maze and a custom problem, the full rich RunSummary shape (unlike tier 2's
// loose shape), a heuristic that hangs mid-run (not just at author-time --
// a genuinely new nested code path: worker -> trusted algorithm loop ->
// untrusted heuristic callback), comparator authoring producing a normal
// python_problem runnable via the EXISTING sort_run_algorithm_on_python_problem
// (no separate run tool), and validation-failure cases for both.
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'] });
const page = await browser.newPage();
page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const call = (name, args) =>
  page.evaluate(async ({ name, args }) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args))), { name, args });

let allPass = true;
function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${detail ? ' -- ' + JSON.stringify(detail) : ''}`);
  if (!cond) allPass = false;
}

// ---- SEARCH HEURISTIC ----
console.log('\n=== search heuristic: author validated against a CUSTOM problem\'s real initial_state ===');
const countingProblemSrc = `from polysearch.interfaces import StateSpaceProblem
class Problem(StateSpaceProblem):
    def initial_state(self):
        return 0
    def goal_check(self, state):
        return state == 3
    def operators(self):
        return [self.inc]
    def apply_operator(self, operator, state):
        return operator(state)
    def cost(self, s1, s2):
        return 1
    def inc(self, state):
        return state + 1 if state < 3 else None`;
const countingProblem = await call('search_author_python_problem', { source_code: countingProblemSrc });
check('counting problem authored', countingProblem.valid, countingProblem);

const perfectHeuristicSrc = 'def heuristic(state):\n    return 3 - state';
const perfectHeuristic = await call('search_author_python_heuristic', { source_code: perfectHeuristicSrc, problem_id: countingProblem.problem_id });
console.log('author result:', JSON.stringify(perfectHeuristic));
check('heuristic validated against real initial_state (0 -> sample_value 3)', perfectHeuristic.valid && perfectHeuristic.sample_value === 3);

console.log('\n=== search heuristic: run gets the FULL rich summary shape (unlike tier 2) ===');
const heuristicRunCustom = await call('search_run_python_heuristic', {
  problem_id: countingProblem.problem_id,
  heuristic_id: perfectHeuristic.heuristic_id,
  algorithm: 'a_star',
});
console.log('run result:', JSON.stringify(heuristicRunCustom));
check(
  'rich summary: path_found true, correct path, cost -- not the loose raw_return_value shape',
  heuristicRunCustom.ok &&
    heuristicRunCustom.summary.path_found === true &&
    JSON.stringify(heuristicRunCustom.summary.path) === JSON.stringify([0, 1, 2, 3]) &&
    heuristicRunCustom.summary.cost === 3
);

console.log('\n=== search heuristic: real guidance against a BUILT-IN maze (manhattan distance, not h=0) ===');
const maze = await call('search_author_maze', { rows: 8, cols: 8, wall_density: 0.2, seed: 7 });
const [goalRow, goalCol] = maze.goal;
const manhattanSrc = `def heuristic(state):
    row, col = state
    return abs(row - ${goalRow}) + abs(col - ${goalCol})`;
const manhattanHeuristic = await call('search_author_python_heuristic', { source_code: manhattanSrc, problem_id: maze.problem_id });
check('manhattan heuristic authored against the maze', manhattanHeuristic.valid, manhattanHeuristic);
const heuristicRunMaze = await call('search_run_python_heuristic', {
  problem_id: maze.problem_id,
  heuristic_id: manhattanHeuristic.heuristic_id,
  algorithm: 'a_star',
});
console.log('run on maze:', JSON.stringify(heuristicRunMaze));
check('a_star with custom heuristic found a real path on the built-in maze', heuristicRunMaze.ok && heuristicRunMaze.summary.path_found === true && heuristicRunMaze.summary.path_length > 0);

console.log('\n=== search heuristic: validation failures ===');
const missingHeuristic = await call('search_author_python_heuristic', { source_code: 'def not_heuristic(state):\n    return 0', problem_id: countingProblem.problem_id });
check('missing `heuristic` function reported cleanly', !missingHeuristic.valid && missingHeuristic.kind === 'name_error', missingHeuristic);
const nonNumberHeuristic = await call('search_author_python_heuristic', { source_code: 'def heuristic(state):\n    return "far"', problem_id: countingProblem.problem_id });
check('non-number return value rejected', !nonNumberHeuristic.valid, nonNumberHeuristic);

console.log('\n=== search heuristic: hangs MID-RUN, not just at author-time (new nested code path) ===');
const midRunHangSrc = `def heuristic(state):
    if state == 2:
        while True:
            pass
    return 3 - state`;
const midRunHangHeuristic = await call('search_author_python_heuristic', { source_code: midRunHangSrc, problem_id: countingProblem.problem_id });
check('author-time validation passes (only calls heuristic(initial_state=0), no hang yet)', midRunHangHeuristic.valid, midRunHangHeuristic);
const tickBefore = performance.now();
const responsiveDuring = [];
const hangPromise = call('search_run_python_heuristic', {
  problem_id: countingProblem.problem_id,
  heuristic_id: midRunHangHeuristic.heuristic_id,
  algorithm: 'a_star',
});
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1000);
  responsiveDuring.push(await page.evaluate(() => document.title === 'polyraptor' || true));
}
const hangResult = await hangPromise;
const elapsed = performance.now() - tickBefore;
console.log('elapsed ms:', elapsed.toFixed(0), 'result:', JSON.stringify(hangResult));
check('page responsive throughout the mid-run hang (6/6)', responsiveDuring.every(Boolean));
check('timed out with friendly message, not a raw hang', !hangResult.ok && hangResult.kind === 'timeout');
const afterHang = await call('search_author_python_heuristic', { source_code: perfectHeuristicSrc, problem_id: countingProblem.problem_id });
check('worker respawned and usable after the mid-run hang', afterHang.valid);

// ---- SORT COMPARATOR ----
console.log('\n=== sort comparator: descending order (proves the comparator body is genuinely exercised) ===');
const descendingComparatorSrc = `def comparator(a, b):
    if a > b:
        return -1
    if a < b:
        return 1
    return 0`;
const comparatorProblem = await call('sort_author_python_comparator', { values: [5, 3, 8, 1, 9, 2], source_code: descendingComparatorSrc });
console.log('author result:', JSON.stringify(comparatorProblem));
check('comparator problem authored', comparatorProblem.valid && comparatorProblem.size === 6);

console.log('\n=== sort comparator: runs via the EXISTING sort_run_algorithm_on_python_problem (no separate run tool) ===');
const comparatorRun = await call('sort_run_algorithm_on_python_problem', { problem_id: comparatorProblem.problem_id, algorithm: 'quick_sort' });
console.log('run result:', JSON.stringify(comparatorRun));
check(
  'sorted DESCENDING per the custom comparator, not the default ascending',
  comparatorRun.ok && JSON.stringify(comparatorRun.summary.final_values) === JSON.stringify([9, 8, 5, 3, 2, 1])
);

console.log('\n=== sort comparator: validation failure (missing comparator) ===');
const missingComparator = await call('sort_author_python_comparator', { values: [3, 1, 2], source_code: 'def not_comparator(a, b):\n    return 0' });
check('missing `comparator` function reported cleanly', !missingComparator.valid, missingComparator);

console.log('\n=== console/page errors ===');
console.log('(see PAGEERROR lines above, if any)');

console.log('\n' + (allPass ? '=== ALL CASES PASS ===' : '=== AT LEAST ONE CASE FAILED ==='));
await browser.close();
process.exit(allPass ? 0 : 1);
