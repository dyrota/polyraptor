// Tier 2: custom algorithms, both families. Covers cases the mirror-of-tier-1
// pattern doesn't exercise on its own: an algorithm running against a
// BUILT-IN problem, the SAME algorithm running against a CUSTOM problem (the
// new problem-source branching), a missing algorithm, an infinite loop, and
// an algorithm that doesn't accept on_step.
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

// ---- SORT ----
console.log('\n=== sort: algorithm on a BUILT-IN problem ===');
const dataset = await call('sort_author_dataset', { dataset_type: 'random_integers', size: 8, seed: 1 });
const bubbleAlgoSrc = `def algorithm(problem, on_step=None):
    data = problem.data().copy()
    n = len(data)
    for i in range(n):
        for j in range(0, n - i - 1):
            if on_step:
                on_step({'type': 'compare', 'a': {'buffer': 'main', 'index': j, 'value': data[j]}, 'b': {'buffer': 'main', 'index': j + 1, 'value': data[j + 1]}})
            if problem.comparator(data[j], data[j + 1]) > 0:
                data[j], data[j + 1] = data[j + 1], data[j]
    return data`;
const sortAlgo = await call('sort_author_python_algorithm', { source_code: bubbleAlgoSrc });
console.log('author:', JSON.stringify(sortAlgo));
check('sort algorithm authored, accepts_on_step true', sortAlgo.valid && sortAlgo.accepts_on_step === true);

const runOnBuiltin = await call('sort_run_python_algorithm', { problem_id: dataset.problem_id, algorithm_id: sortAlgo.algorithm_id });
console.log('run on built-in:', JSON.stringify(runOnBuiltin));
const sortedBuiltin = JSON.stringify(runOnBuiltin.summary.raw_return_value) === JSON.stringify([...dataset.values].sort((a, b) => a - b));
check('custom algorithm correctly sorted the BUILT-IN dataset', runOnBuiltin.ok && sortedBuiltin);

console.log('\n=== sort: SAME algorithm on a CUSTOM problem (the branching case) ===');
const customProblemSrc = `from polysort.interfaces import SortProblem
class Problem(SortProblem):
    def data(self):
        return [9, 1, 5, 3]
    def comparator(self, a, b):
        return -1 if a < b else (1 if a > b else 0)`;
const customProblem = await call('sort_author_python_problem', { source_code: customProblemSrc });
const runOnCustom = await call('sort_run_python_algorithm', { problem_id: customProblem.problem_id, algorithm_id: sortAlgo.algorithm_id });
console.log('run on custom problem:', JSON.stringify(runOnCustom));
check('SAME custom algorithm correctly sorted a CUSTOM problem too', runOnCustom.ok && JSON.stringify(runOnCustom.summary.raw_return_value) === JSON.stringify([1, 3, 5, 9]));

console.log('\n=== sort: algorithm missing entirely ===');
const missingAlgo = await call('sort_author_python_algorithm', { source_code: 'def not_algorithm(problem):\n    return []' });
console.log(JSON.stringify(missingAlgo));
check('missing `algorithm` function reported cleanly', !missingAlgo.valid && missingAlgo.kind === 'name_error');

console.log('\n=== sort: algorithm that does NOT accept on_step ===');
const noOnStepSrc = `def algorithm(problem):
    data = problem.data().copy()
    data.sort()
    return data`;
const noOnStepAlgo = await call('sort_author_python_algorithm', { source_code: noOnStepSrc });
check('accepts_on_step correctly false', noOnStepAlgo.valid && noOnStepAlgo.accepts_on_step === false, noOnStepAlgo);
const noOnStepRun = await call('sort_run_python_algorithm', { problem_id: dataset.problem_id, algorithm_id: noOnStepAlgo.algorithm_id });
check('still runs fine with event_count 0, not an error', noOnStepRun.ok && Object.keys(noOnStepRun.summary.event_type_counts ?? {}).length === 0, noOnStepRun);

console.log('\n=== sort: infinite loop inside a custom algorithm ===');
const hangAlgoSrc = 'def algorithm(problem, on_step=None):\n    while True:\n        pass';
const hangAlgo = await call('sort_author_python_algorithm', { source_code: hangAlgoSrc });
const tickBefore = performance.now();
const responsiveDuring = [];
const hangPromise = call('sort_run_python_algorithm', { problem_id: dataset.problem_id, algorithm_id: hangAlgo.algorithm_id });
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1000);
  responsiveDuring.push(await page.evaluate(() => document.title === 'polyraptor' || true));
}
const hangResult = await hangPromise;
const elapsed = performance.now() - tickBefore;
console.log('elapsed ms:', elapsed.toFixed(0), 'result:', JSON.stringify(hangResult));
check('page responsive throughout (6/6)', responsiveDuring.every(Boolean));
check('timed out with friendly message, not a raw hang', !hangResult.ok && hangResult.kind === 'timeout');
const afterHang = await call('sort_author_python_algorithm', { source_code: 'def algorithm(problem):\n    return problem.data()' });
check('worker respawned and usable after the hang', afterHang.valid);

// ---- SEARCH ----
console.log('\n=== search: algorithm on a BUILT-IN problem (maze) ===');
const maze = await call('search_author_maze', { rows: 6, cols: 6, wall_density: 0.2, seed: 3 });
const bfsAlgoSrc = `def algorithm(problem, on_step=None):
    from collections import deque
    start = problem.initial_state()
    frontier = deque([(start, [start])])
    visited = {start}
    while frontier:
        state, path = frontier.popleft()
        if on_step:
            on_step({'type': 'expand', 'state': state})
        if problem.goal_check(state):
            return path
        for op in problem.operators():
            nxt = problem.apply_operator(op, state)
            if nxt is not None and nxt not in visited:
                visited.add(nxt)
                frontier.append((nxt, path + [nxt]))
    return None`;
const searchAlgo = await call('search_author_python_algorithm', { source_code: bfsAlgoSrc });
check('search algorithm authored', searchAlgo.valid, searchAlgo);
const searchRunBuiltin = await call('search_run_python_algorithm', { problem_id: maze.problem_id, algorithm_id: searchAlgo.algorithm_id });
console.log('run on maze:', JSON.stringify(searchRunBuiltin));
check('custom BFS found a real path on the built-in maze', searchRunBuiltin.ok && Array.isArray(searchRunBuiltin.summary.raw_return_value) && searchRunBuiltin.summary.raw_return_value.length > 0);

console.log('\n=== search: SAME algorithm on a CUSTOM problem ===');
const customSearchProblemSrc = `from polysearch.interfaces import StateSpaceProblem
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
const customSearchProblem = await call('search_author_python_problem', { source_code: customSearchProblemSrc });
const searchRunCustom = await call('search_run_python_algorithm', { problem_id: customSearchProblem.problem_id, algorithm_id: searchAlgo.algorithm_id });
console.log('run on custom problem:', JSON.stringify(searchRunCustom));
check('SAME custom algorithm solved a CUSTOM problem too', searchRunCustom.ok && JSON.stringify(searchRunCustom.summary.raw_return_value) === JSON.stringify([0, 1, 2, 3]));

// ---- regression check ----
console.log('\n=== regression: existing tools still fine ===');
const regressionRun = await call('search_run_algorithm', { problem_id: maze.problem_id, algorithm: 'a_star', heuristic: 'manhattan_distance' });
check('search_run_algorithm still works', regressionRun.trace_id !== undefined);
const regressionSort = await call('sort_run_algorithm', { problem_id: dataset.problem_id, algorithm: 'quick_sort' });
check('sort_run_algorithm still works', regressionSort.trace_id !== undefined);

console.log('\n' + (allPass ? '=== ALL CASES PASS ===' : '=== AT LEAST ONE CASE FAILED ==='));
await browser.close();
process.exit(allPass ? 0 : 1);
