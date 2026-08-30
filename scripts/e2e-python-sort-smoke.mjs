// Covers the new untrusted-code path specifically: happy path, a missing
// method, a syntax error, and -- the most important case, the entire reason
// this architecture exists -- an actual infinite loop, confirming it times
// out with a friendly message AND that the page stays fully responsive
// throughout, not just that the call eventually resolves.
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.stack || String(err)));

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.click('text=Sort');

const call = (name, args) =>
  page.evaluate(
    async ({ name, args }) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args))),
    { name, args }
  );

let allPass = true;

console.log('=== (a) happy path ===');
{
  const VALID_SOURCE = `from polysort.interfaces import SortProblem

class Problem(SortProblem):
    def data(self):
        return [5, 3, 8, 1, 9, 2]
    def comparator(self, a, b):
        if a < b: return -1
        if a > b: return 1
        return 0
`;
  const authored = await call('sort_author_python_problem', { source_code: VALID_SOURCE });
  console.log('author result:', JSON.stringify(authored));
  const run = await call('sort_run_algorithm_on_python_problem', { problem_id: authored.problem_id, algorithm: 'bubble_sort' });
  console.log('run result:', JSON.stringify(run));
  const pass = authored.valid === true && run.ok === true && run.summary?.is_sorted === true;
  console.log(pass ? 'PASS' : 'FAIL');
  allPass &&= pass;
}

console.log('\n=== (b) missing method ===');
{
  const MISSING_METHOD = `from polysort.interfaces import SortProblem

class Problem(SortProblem):
    def data(self):
        return [3, 1, 2]
`;
  const authored = await call('sort_author_python_problem', { source_code: MISSING_METHOD });
  console.log('result:', JSON.stringify(authored));
  const pass = authored.valid === false && /comparator/i.test(authored.friendly_error || '') && !/Traceback/.test(authored.friendly_error || '');
  console.log(pass ? 'PASS: friendly message mentions the missing method, not a raw traceback' : 'FAIL');
  allPass &&= pass;
}

console.log('\n=== (c) syntax error ===');
{
  const SYNTAX_ERROR = `from polysort.interfaces import SortProblem

class Problem(SortProblem)
    def data(self):
        return [1, 2, 3]
`;
  const authored = await call('sort_author_python_problem', { source_code: SYNTAX_ERROR });
  console.log('result:', JSON.stringify(authored));
  const pass = authored.valid === false && authored.kind === 'syntax_error';
  console.log(pass ? 'PASS' : 'FAIL');
  allPass &&= pass;
}

console.log('\n=== (d) infinite loop -- the important one ===');
{
  const INFINITE_LOOP = `from polysort.interfaces import SortProblem

class Problem(SortProblem):
    def data(self):
        while True:
            pass
    def comparator(self, a, b):
        return 0
`;
  const tickerStart = Date.now();
  const startedAt = performance.now();

  // Confirm the page stays responsive DURING the call, not just that it
  // eventually resolves -- poll something trivial concurrently.
  // Manual race against a timeout for each probe -- if the architecture is
  // somehow wrong and the main thread DOES freeze, this must fail fast
  // rather than hang the test script itself for the full worker timeout (or
  // longer), the way the earlier phase0-check5 negative-control bug did.
  const evaluateWithTimeout = async (fn, ms) =>
    Promise.race([page.evaluate(fn), new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate timed out')), ms))]);

  const responsivenessCheck = (async () => {
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const stillAlive = await evaluateWithTimeout(() => document.title, 2000).catch(() => null);
      samples.push(stillAlive !== null);
    }
    return samples;
  })();

  const [authored, responsiveSamples] = await Promise.all([
    call('sort_author_python_problem', { source_code: INFINITE_LOOP }),
    responsivenessCheck,
  ]);
  const elapsedMs = performance.now() - startedAt;

  console.log('result:', JSON.stringify(authored));
  console.log('elapsed ms:', elapsedMs.toFixed(0));
  console.log('page responsive during the hang (6 samples, expect all true):', responsiveSamples);

  const pass =
    authored.valid === false &&
    authored.kind === 'timeout' &&
    /didn.t finish within/i.test(authored.friendly_error || '') &&
    elapsedMs > 5000 && elapsedMs < 20000 &&
    responsiveSamples.every((s) => s === true);
  console.log(pass ? 'PASS: timed out with friendly message, page never froze' : 'FAIL');
  allPass &&= pass;

  // Confirm the worker actually respawned and works after the timeout.
  const VALID_SOURCE = `from polysort.interfaces import SortProblem
class Problem(SortProblem):
    def data(self):
        return [2, 1]
    def comparator(self, a, b):
        return -1 if a < b else (1 if a > b else 0)
`;
  const postTimeout = await call('sort_author_python_problem', { source_code: VALID_SOURCE });
  console.log('post-timeout call (confirms worker respawned):', JSON.stringify(postTimeout));
  const respawnPass = postTimeout.valid === true;
  console.log(respawnPass ? 'PASS: worker respawned and works after timeout' : 'FAIL');
  allPass &&= respawnPass;
}

console.log('\n=== page errors ===');
pageErrors.forEach((e) => console.log(e));
console.log(pageErrors.length === 0 ? 'NO PAGE ERRORS' : 'PAGE ERRORS FOUND (see above) -- FAIL');
allPass &&= pageErrors.length === 0;

await page.screenshot({ path: '.smoke-shots/python-sort-editor.png', fullPage: true });

console.log('\n' + (allPass ? '=== ALL CASES PASS ===' : '=== AT LEAST ONE CASE FAILED ==='));
await browser.close();
process.exit(allPass ? 0 : 1);
