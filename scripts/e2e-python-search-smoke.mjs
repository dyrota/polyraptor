// Mirrors e2e-python-sort-smoke.mjs's four cases, adapted for search's
// 5-method StateSpaceProblem ABC instead of sort's 2-method SortProblem.
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(err.message));

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const call = (name, args) =>
  page.evaluate(
    async ({ name, args }) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args))),
    { name, args }
  );

let allPass = true;

// (a) happy path
{
  const author = await call('search_author_python_problem', {
    source_code: `from polysearch.interfaces import StateSpaceProblem


class Problem(StateSpaceProblem):
    def initial_state(self):
        return (0, 0)

    def goal_check(self, state):
        return state == (2, 2)

    def operators(self):
        return [self.move_right, self.move_down]

    def apply_operator(self, operator, state):
        return operator(state)

    def cost(self, state1, state2):
        return 1

    def move_right(self, state):
        row, col = state
        if col >= 2:
            return None
        return (row, col + 1)

    def move_down(self, state):
        row, col = state
        if row >= 2:
            return None
        return (row + 1, col)
`,
  });
  console.log('=== (a) happy path ===');
  console.log('author result:', JSON.stringify(author));
  const pass1 = author.valid === true && author.operator_count === 2 && author.goal_check_on_initial === false;
  const run = await call('search_run_algorithm_on_python_problem', { problem_id: author.problem_id, algorithm: 'breadth_first' });
  console.log('run result:', JSON.stringify(run));
  const pass2 = run.ok === true && run.summary.path_found === true && run.summary.path_length === 5; // (0,0)->(0,1)->(0,2)->(1,2)->(2,2) or similar 5-state path
  console.log(pass1 && pass2 ? 'PASS' : 'FAIL');
  allPass &&= pass1 && pass2;
}

// (b) missing method
{
  const result = await call('search_author_python_problem', {
    source_code: `from polysearch.interfaces import StateSpaceProblem


class Problem(StateSpaceProblem):
    def initial_state(self):
        return (0, 0)

    def goal_check(self, state):
        return state == (1, 1)

    def operators(self):
        return []
`,
  });
  console.log('\n=== (b) missing method ===');
  console.log('result:', JSON.stringify(result));
  const pass = result.valid === false && result.kind === 'missing_methods' && /apply_operator|cost/.test(result.friendly_error);
  console.log(pass ? 'PASS: friendly message mentions the missing method(s), not a raw traceback' : 'FAIL');
  allPass &&= pass;
}

// (c) syntax error
{
  const result = await call('search_author_python_problem', {
    source_code: `from polysearch.interfaces import StateSpaceProblem


class Problem(StateSpaceProblem)
    def initial_state(self):
        return (0, 0)
`,
  });
  console.log('\n=== (c) syntax error ===');
  console.log('result:', JSON.stringify(result));
  // Line 4: two blank lines after the import (matching the template's
  // style), then the broken class declaration.
  const pass = result.valid === false && result.kind === 'syntax_error' && /line 4/.test(result.friendly_error);
  console.log(pass ? 'PASS' : 'FAIL');
  allPass &&= pass;
}

// (d) infinite loop -- the important one
{
  console.log('\n=== (d) infinite loop -- the important one ===');
  const start = Date.now();
  // Deliberately NOT awaited yet -- kicks off the hanging call, then samples
  // page responsiveness concurrently while it's still pending, so the
  // samples are genuine evidence of "responsive DURING the hang", not just
  // "responsive after it already resolved" (awaiting first would make every
  // subsequent check happen strictly after the 8s timeout already fired).
  const authorPromise = call('search_author_python_problem', {
    source_code: `from polysearch.interfaces import StateSpaceProblem


class Problem(StateSpaceProblem):
    def initial_state(self):
        return (0, 0)

    def goal_check(self, state):
        while True:
            pass

    def operators(self):
        return []

    def apply_operator(self, operator, state):
        return None

    def cost(self, state1, state2):
        return 1
`,
  });

  const responsiveSamples = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    const alive = await page.evaluate(() => document.title === document.title);
    responsiveSamples.push(alive);
  }
  console.log('page responsive DURING the hang (6 samples at ~1s intervals, expect all true):', responsiveSamples);

  const author = await authorPromise;
  const elapsed = Date.now() - start;
  console.log('author result (hangs in goal_check called during author-time validation):', JSON.stringify(author));
  console.log('elapsed ms:', elapsed);

  const pass1 = author.valid === false && author.kind === 'timeout' && /8 seconds/.test(author.friendly_error);
  const pass2 = elapsed > 7500 && elapsed < 12000;
  const pass3 = responsiveSamples.every(Boolean);
  console.log(pass1 && pass2 && pass3 ? 'PASS: timed out with friendly message, page never froze' : 'FAIL');
  allPass &&= pass1 && pass2 && pass3;

  const after = await call('search_author_python_problem', {
    source_code: `from polysearch.interfaces import StateSpaceProblem


class Problem(StateSpaceProblem):
    def initial_state(self):
        return (0, 0)

    def goal_check(self, state):
        return True

    def operators(self):
        return []

    def apply_operator(self, operator, state):
        return None

    def cost(self, state1, state2):
        return 1
`,
  });
  console.log('post-timeout call (confirms worker respawned):', JSON.stringify(after));
  const pass4 = after.valid === true;
  console.log(pass4 ? 'PASS: worker respawned and works after timeout' : 'FAIL');
  allPass &&= pass4;
}

console.log('\n=== console/page errors ===');
consoleErrors.forEach((e) => console.log(e));
console.log(consoleErrors.length === 0 ? 'NO PAGE ERRORS' : 'PAGE ERRORS FOUND');
allPass &&= consoleErrors.length === 0;

console.log('\n' + (allPass ? '=== ALL CASES PASS ===' : '=== AT LEAST ONE CASE FAILED ==='));
await browser.close();
process.exit(allPass ? 0 : 1);
