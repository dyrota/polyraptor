// The other half of the shared-state premise: an agent must be able to SEE
// state it did not create. Everything here fails without search_get_state /
// sort_get_state, because until they existed an agent could only act on ids it
// had authored itself in the current conversation.
//   node scripts/e2e-state-discovery-smoke.mjs http://localhost:5173/
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const failures = [];
const pageErrors = [];
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`);
    failures.push(name);
  }
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'] });
const page = await browser.newPage();
page.on('pageerror', (e) => pageErrors.push(e.stack || String(e)));
await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForFunction(() => typeof navigator.modelContextTesting?.executeTool === 'function', null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('.status-neutral')?.textContent?.includes('Ready'), null, { timeout: 120000 });

const call = (name, args = {}) =>
  page.evaluate(
    async ({ name, args }) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args))),
    { name, args }
  );

// ---------------------------------------------------------------------------
console.log('\n=== the agent can see a maze the HUMAN created by clicking ===');
await page.getByRole('button', { name: 'New Maze' }).click();
await page.waitForTimeout(300);
const s1 = await call('search_get_state');
check('active_problem is reported', s1.active_problem !== null, JSON.stringify(s1).slice(0, 160));
check('  -> it is a maze', s1.active_problem?.type === 'maze', s1.active_problem?.type);
check('  -> with a usable problem_id', typeof s1.active_problem?.problem_id === 'string');
check('  -> and the grid itself, for reasoning about it', Array.isArray(s1.active_problem?.maze), typeof s1.active_problem?.maze);
check('  -> with start and goal', Array.isArray(s1.active_problem?.start) && Array.isArray(s1.active_problem?.goal));

// ---------------------------------------------------------------------------
console.log('\n=== and can then act on that id without ever having authored it ===');
const ran = await call('search_run_algorithm', { problem_id: s1.active_problem.problem_id, algorithm: 'a_star', heuristic: 'manhattan_distance' });
check('running the human-created problem works', typeof ran.trace_id === 'string', JSON.stringify(ran).slice(0, 160));
const s2 = await call('search_get_state');
check('the resulting trace is discoverable', s2.active_trace?.trace_id === ran.trace_id, JSON.stringify(s2.active_trace).slice(0, 160));
check('  -> with its playback position', typeof s2.active_trace?.current_seq === 'number' && typeof s2.active_trace?.total_length === 'number');

// ---------------------------------------------------------------------------
console.log('\n=== authored algorithms and heuristics are listed and distinguished ===');
const h = await call('search_author_python_heuristic', {
  problem_id: s1.active_problem.problem_id,
  source_code: 'def heuristic(state):\n    return 0\n',
});
const a = await call('search_author_python_algorithm', {
  source_code: 'def algorithm(problem, on_step=None):\n    return []\n',
});
const s3 = await call('search_get_state');
check('heuristic_ids includes the authored heuristic', s3.heuristic_ids?.includes(h.heuristic_id), JSON.stringify(s3.heuristic_ids));
check('algorithm_ids includes the authored algorithm', s3.algorithm_ids?.includes(a.algorithm_id), JSON.stringify(s3.algorithm_ids));
check('  -> and the two are not conflated', !s3.heuristic_ids.includes(a.algorithm_id) && !s3.algorithm_ids.includes(h.heuristic_id));

// ---------------------------------------------------------------------------
console.log('\n=== the latest verification verdict is discoverable ===');
await call('search_verify_heuristic', { problem_id: s1.active_problem.problem_id, heuristic_id: h.heuristic_id });
const s4 = await call('search_get_state');
check('latest_verification is reported', s4.latest_verification !== null, JSON.stringify(s4.latest_verification));
check('  -> with a verdict, not just booleans', typeof s4.latest_verification?.verdict === 'string', s4.latest_verification?.verdict);

// ---------------------------------------------------------------------------
console.log('\n=== a bad id names its own recovery path ===');
const bad = await call('search_run_algorithm', { problem_id: 'nope-does-not-exist', algorithm: 'a_star' });
check('unknown problem_id error mentions search_get_state', /search_get_state/.test(bad.message ?? ''), JSON.stringify(bad).slice(0, 200));
const badTrace = await call('playback_get_state', { trace_id: 'nope' });
check('unknown trace_id error mentions get_state', /get_state/.test(badTrace.message ?? ''), JSON.stringify(badTrace).slice(0, 200));

// ---------------------------------------------------------------------------
console.log('\n=== sort: the agent can see a dataset the HUMAN created ===');
// role 'tab', not 'button': the family switcher is a real tablist now, and
// role="tab" replaces a <button>'s implicit role in the accessibility tree.
await page.getByRole('tab', { name: 'Sort', exact: true }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'New Dataset' }).click();
await page.waitForTimeout(1500);
const t1 = await call('sort_get_state');
check('active sort problem is reported', t1.active_problem !== null, JSON.stringify(t1).slice(0, 160));
check('  -> with its values', Array.isArray(t1.active_problem?.values), typeof t1.active_problem?.values);
const sortRan = await call('sort_run_algorithm', { problem_id: t1.active_problem.problem_id, algorithm: 'merge_sort' });
check('running the human-created dataset works', typeof sortRan.trace_id === 'string', JSON.stringify(sortRan).slice(0, 160));

console.log('\n=== page errors ===');
if (pageErrors.length) {
  console.log(pageErrors.join('\n---\n'));
  failures.push('page errors');
} else console.log('NO PAGE ERRORS');

await browser.close();
console.log(failures.length ? `\n=== ${failures.length} FAILURE(S): ${failures.join(', ')} ===` : '\n=== ALL CASES PASS ===');
process.exit(failures.length ? 1 : 0);
