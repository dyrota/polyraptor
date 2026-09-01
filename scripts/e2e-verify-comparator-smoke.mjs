// End-to-end coverage for comparator verification: the WebMCP tool, all five
// laws, the three-verdict soundness model, and the card it paints for the
// human.
//   node scripts/e2e-verify-comparator-smoke.mjs http://localhost:5173/
//
// The case worth reading is "a broken comparator still reports is_sorted:
// true" below -- that is the failure mode the whole feature exists for, and
// asserting it here keeps the claim in the README honest.
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

// Author a bare comparator over a fixed value list, then verify the problem it
// produced. Mirrors how a student actually uses the comparator sub-mode.
const authorAndVerify = async (values, source_code, extra = {}) => {
  const p = await call('sort_author_python_comparator', { values, source_code });
  if (!p.valid) return { authorFailed: p };
  return { ...(await call('sort_verify_comparator', { problem_id: p.problem_id, ...extra })), problem_id: p.problem_id };
};

const VALUES = [5, 3, 9, 1, 7, 2, 8];

// ---------------------------------------------------------------------------
console.log('\n=== a correct comparator is PROVEN ===');
const good = await authorAndVerify(VALUES, 'def comparator(a, b):\n    return -1 if a < b else (1 if a > b else 0)\n');
check('ascending comparator verdict is "proven"', good.verdict === 'proven', JSON.stringify(good).slice(0, 220));
for (const law of ['total', 'deterministic', 'antisymmetric', 'transitive', 'equivalence_transitive']) {
  check(`  -> ${law} holds`, good[law]?.holds === true, JSON.stringify(good[law]));
}
check('  -> it really called the comparator', good.comparator_calls > 0, String(good.comparator_calls));
check('  -> and covered every distinct value', good.values_checked === VALUES.length, `${good.values_checked} of ${VALUES.length}`);

console.log('\n=== a descending comparator is equally valid ===');
const desc = await authorAndVerify(VALUES, 'def comparator(a, b):\n    return 1 if a < b else (-1 if a > b else 0)\n');
check('descending verdict is "proven"', desc.verdict === 'proven', JSON.stringify(desc).slice(0, 200));

// ---------------------------------------------------------------------------
console.log('\n=== reflexivity: a >= b comparator never returns 0 ===');
const noEqual = await authorAndVerify(VALUES, 'def comparator(a, b):\n    return 1 if a >= b else -1\n');
check('verdict is "refuted"', noEqual.verdict === 'refuted', JSON.stringify(noEqual).slice(0, 200));
check('  -> antisymmetry is the law that catches it', noEqual.antisymmetric?.holds === false, JSON.stringify(noEqual.antisymmetric));
check('  -> counterexample is flagged as the reflexive case', noEqual.antisymmetric?.counterexample?.reflexive === true, JSON.stringify(noEqual.antisymmetric?.counterexample));

// ---------------------------------------------------------------------------
console.log('\n=== antisymmetry: a comparator that says "greater" both ways ===');
const alwaysGreater = await authorAndVerify(VALUES, 'def comparator(a, b):\n    return 1\n');
check('verdict is "refuted"', alwaysGreater.verdict === 'refuted', JSON.stringify(alwaysGreater).slice(0, 200));
const anti = alwaysGreater.antisymmetric?.counterexample;
check('  -> names both values and both answers', typeof anti?.a === 'number' && typeof anti?.b === 'number' && anti?.a_vs_b === 1 && anti?.b_vs_a === 1, JSON.stringify(anti));

// ---------------------------------------------------------------------------
console.log('\n=== transitivity: a genuine 3-cycle ===');
// Rock-paper-scissors over three values: 1 < 2 < 3 < 1. Every pair is
// antisymmetric and every comparison is deterministic, so transitivity is the
// only law that can catch this -- exactly the point.
const cyclic = await authorAndVerify(
  [1, 2, 3],
  [
    'def comparator(a, b):',
    '    if a == b:',
    '        return 0',
    '    beats = {(1, 3), (3, 2), (2, 1)}',
    '    return -1 if (a, b) in beats else 1',
  ].join('\n')
);
check('verdict is "refuted"', cyclic.verdict === 'refuted', JSON.stringify(cyclic).slice(0, 220));
check('  -> transitivity is violated', cyclic.transitive?.holds === false, JSON.stringify(cyclic.transitive));
check('  -> antisymmetry still holds (so it is not just a sign bug)', cyclic.antisymmetric?.holds === true, JSON.stringify(cyclic.antisymmetric));
const tri = cyclic.transitive?.counterexample;
check('  -> counterexample names three concrete values', typeof tri?.a === 'number' && typeof tri?.b === 'number' && typeof tri?.c === 'number', JSON.stringify(tri));
check('  -> and the three answers really do contradict', tri && tri.a_vs_b < 0 && tri.b_vs_c < 0 && tri.a_vs_c >= 0, JSON.stringify(tri));

// ---------------------------------------------------------------------------
console.log('\n=== equivalence transitivity: the tolerance-comparator trap ===');
// 1.0 ~ 1.4 ~ 1.8, but 1.0 < 1.8. Antisymmetric and transitive on strict
// inequality; only the equivalence law catches it.
const tolerance = await authorAndVerify(
  [1.0, 1.4, 1.8],
  'def comparator(a, b):\n    if abs(a - b) < 0.5:\n        return 0\n    return -1 if a < b else 1\n'
);
check('verdict is "refuted"', tolerance.verdict === 'refuted', JSON.stringify(tolerance).slice(0, 220));
check('  -> equivalence transitivity is violated', tolerance.equivalence_transitive?.holds === false, JSON.stringify(tolerance.equivalence_transitive));
const eqCe = tolerance.equivalence_transitive?.counterexample;
check('  -> counterexample shows a=b, b=c, a!=c', eqCe && eqCe.a_vs_b === 0 && eqCe.b_vs_c === 0 && eqCe.a_vs_c !== 0, JSON.stringify(eqCe));

// ---------------------------------------------------------------------------
console.log('\n=== totality: a comparator that returns None ===');
const returnsNone = await authorAndVerify(VALUES, 'def comparator(a, b):\n    if a == b:\n        return 0\n    if a < b:\n        return -1\n');
check('verdict is "refuted"', returnsNone.verdict === 'refuted', JSON.stringify(returnsNone).slice(0, 200));
check('  -> totality is the law that catches it', returnsNone.total?.holds === false, JSON.stringify(returnsNone.total));
check('  -> and the reason names what came back', /not a number/i.test(returnsNone.total?.counterexample?.reason ?? ''), returnsNone.total?.counterexample?.reason);

console.log('\n=== totality: a comparator that raises ===');
const raises = await authorAndVerify(VALUES, 'def comparator(a, b):\n    if a == 9 or b == 9:\n        raise ValueError("nope")\n    return -1 if a < b else (1 if a > b else 0)\n');
check('verdict is "refuted"', raises.verdict === 'refuted', JSON.stringify(raises).slice(0, 200));
check('  -> the exception is reported as a totality counterexample, not a crash', /ValueError/.test(raises.total?.counterexample?.reason ?? ''), raises.total?.counterexample?.reason);

console.log('\n=== totality: NaN, which neither orders nor raises ===');
const nan = await authorAndVerify(VALUES, 'def comparator(a, b):\n    return float("nan") if a != b else 0\n');
check('NaN is refuted', nan.verdict === 'refuted', JSON.stringify(nan).slice(0, 200));
check('  -> and is named as NaN specifically', /nan/i.test(nan.total?.counterexample?.reason ?? ''), nan.total?.counterexample?.reason);

// ---------------------------------------------------------------------------
console.log('\n=== determinism: a comparator with state ===');
const nondet = await authorAndVerify(
  VALUES,
  ['_n = [0]', 'def comparator(a, b):', '    _n[0] += 1', '    if _n[0] % 3 == 0:', '        return 1', '    return -1 if a < b else (1 if a > b else 0)'].join('\n')
);
check('verdict is "refuted"', nondet.verdict === 'refuted', JSON.stringify(nondet).slice(0, 200));
check('  -> determinism is violated', nondet.deterministic?.holds === false, JSON.stringify(nondet.deterministic));

// ---------------------------------------------------------------------------
console.log('\n=== a built-in dataset verifies without any authored code ===');
const builtin = await call('sort_author_dataset', { dataset_type: 'random_integers', size: 20, seed: 7 });
const builtinVerdict = await call('sort_verify_comparator', { problem_id: builtin.problem_id });
check("the built-in comparator is proven", builtinVerdict.verdict === 'proven', JSON.stringify(builtinVerdict).slice(0, 220));

console.log('\n=== soundness: a tiny budget must degrade, never lie ===');
const truncated = await call('sort_verify_comparator', { problem_id: builtin.problem_id, value_budget: 5 });
check('budget-limited run reports "unrefuted", not "proven"', truncated.verdict === 'unrefuted', JSON.stringify(truncated).slice(0, 220));
check('  -> and says so explicitly', truncated.budget_exceeded === true);
check('  -> summary refuses to claim validity', /not|does NOT|unchecked/i.test(truncated.summary ?? ''), truncated.summary);

console.log('\n=== soundness: refutation still works under a tiny budget ===');
const truncRefuted = await authorAndVerify(VALUES, 'def comparator(a, b):\n    return 1\n', { value_budget: 3 });
check('refutation survives truncation', truncRefuted.verdict === 'refuted', JSON.stringify(truncRefuted).slice(0, 200));

// ---------------------------------------------------------------------------
console.log('\n=== the reason this feature exists: a broken comparator still reports is_sorted ===');
const cyclicRun = await call('sort_run_algorithm_on_python_problem', { problem_id: cyclic.problem_id, algorithm: 'bubble_sort' });
check('a sort against the cyclic comparator completes without error', cyclicRun.ok === true, JSON.stringify(cyclicRun).slice(0, 200));
check('  -> and reports is_sorted: true, which is why the animation cannot show the bug', cyclicRun.summary?.is_sorted === true, JSON.stringify(cyclicRun.summary));
check('  -> while verification refutes the same comparator', cyclic.verdict === 'refuted');

// ---------------------------------------------------------------------------
console.log("\n=== the agent's verdict lands on the page the human is looking at ===");
// The app opens on the Search tab, so SortPanel is not mounted until a human
// switches to it -- everything above this line went through the stores and the
// tool layer, which is exactly the split being tested here.
await page.click('.app-tabs button:has-text("Sort")').catch(() => {});
await page.waitForTimeout(200);
const shown = await authorAndVerify(
  [1, 2, 3],
  ['def comparator(a, b):', '    if a == b:', '        return 0', '    beats = {(1, 3), (3, 2), (2, 1)}', '    return -1 if (a, b) in beats else 1'].join('\n')
);
await page.waitForTimeout(500);
const cardText = await page.locator('.verify-card').innerText().catch(() => '');
check('a verification card is rendered', cardText.length > 0, `len=${cardText.length}`);
check('card shows the refuted verdict', /refuted/i.test(cardText), cardText.slice(0, 160));
check('card explains the cycle in words', /cycle|transitive/i.test(cardText), cardText.slice(0, 400));
check('card reports how many triples were checked', /triples/i.test(cardText), cardText.slice(0, 400));
// The refutation is rendered on the bars too, the way search renders its own
// on the board -- a legend entry only appears when marks were drawn.
const legend = await page.locator('.bar-canvas-wrapper .maze-legend').innerText().catch(() => '');
check('the bar canvas marks the counterexample', /counterexample/i.test(legend), legend.replace(/\n/g, ' ').slice(0, 200));
await page.screenshot({ path: SHOT_DIR + 'verify-comparator-refuted.png', fullPage: true });

// A verdict must survive a leftover trace from a DIFFERENT problem. The panel
// derives its displayed problem from the active trace first, so without
// setVerification dropping a foreign trace the card is suppressed as stale and
// the tool call paints nothing at all -- the failure the store exists to
// prevent, reachable any time an agent runs one problem and then verifies
// another.
console.log('\n=== a verdict outranks a leftover trace from another problem ===');
const other = await call('sort_author_dataset', { dataset_type: 'random_integers', size: 10, seed: 2 });
await call('sort_run_algorithm', { problem_id: other.problem_id, algorithm: 'bubble_sort' });
await page.waitForTimeout(300);
await call('sort_verify_comparator', { problem_id: shown.problem_id });
await page.waitForTimeout(400);
const afterTrace = await page.locator('.verify-card').innerText().catch(() => '');
check('card is shown despite another problem having the active trace', afterTrace.length > 0, `len=${afterTrace.length}`);
check('  -> and it is the verdict for the verified problem', /refuted/i.test(afterTrace), afterTrace.slice(0, 160));

// Stale-verdict guard: switching to another problem must not show this verdict.
await call('sort_author_dataset', { dataset_type: 'reverse_sorted', size: 12 });
await page.waitForTimeout(400);
const staleCards = await page.locator('.verify-card').count();
check('verdict is hidden once a different problem becomes active', staleCards === 0, `count=${staleCards}`);

// ---------------------------------------------------------------------------
console.log('\n=== an agent can discover a verdict through sort_get_state ===');
await call('sort_verify_comparator', { problem_id: shown.problem_id });
const state = await call('sort_get_state', {});
check('latest_verification is reported', state.latest_verification !== null, JSON.stringify(state.latest_verification));
check('  -> with the verdict, not just booleans', state.latest_verification?.verdict === 'refuted', JSON.stringify(state.latest_verification));
check('  -> and names the problem it describes', state.latest_verification?.problem_id === shown.problem_id, JSON.stringify(state.latest_verification));

console.log('\n=== page errors ===');
if (pageErrors.length) {
  console.log(pageErrors.join('\n---\n'));
  failures.push('page errors');
} else console.log('NO PAGE ERRORS');

await browser.close();
console.log(failures.length ? `\n=== ${failures.length} FAILURE(S): ${failures.join(', ')} ===` : '\n=== ALL CASES PASS ===');
process.exit(failures.length ? 1 : 0);
