// Drives the three spike scenarios and prints pass/fail with actual evidence
// (timestamps, ticker samples), not just "it seemed fine". Run from the
// polyraptor repo root (needs its node_modules for playwright):
//   cd dev-notes/phase0-check5 && python3 -m http.server 8123 &
//   node dev-notes/phase0-check5/verify.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:8123/';
const browser = await chromium.launch({ channel: 'chrome' });

let allPass = true;

// ---- Scenario A: streaming ----
{
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => window.runStreamTest());
  await page.waitForFunction(() => window.__streamDone === true, { timeout: 15000 });
  const timestamps = await page.evaluate(() => window.__streamTimestamps);
  const events = await page.evaluate(() => window.__streamEvents);
  const spreadMs = timestamps[timestamps.length - 1] - timestamps[0];
  const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
  const minGap = Math.min(...gaps);
  console.log('\n=== Scenario A: streaming ===');
  console.log('event count:', timestamps.length, '(expect 11: start + 10 iterations)');
  console.log('first event payload:', events[0]);
  console.log('last event payload:', events[events.length - 1]);
  console.log('total spread (ms):', spreadMs.toFixed(1));
  console.log('per-event gaps (ms):', gaps.map((g) => g.toFixed(1)).join(', '));
  console.log('smallest gap (ms):', minGap.toFixed(1));
  const pass = timestamps.length === 11 && spreadMs > 500 && minGap > 5;
  console.log(pass ? 'PASS: events arrived progressively, not clustered at the end' : 'FAIL');
  allPass &&= pass;
  await page.close();
}

// ---- Scenario B: termination + respawn, main thread stays responsive ----
{
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => window.runHangTest());

  const tickerSamples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250);
    tickerSamples.push(await page.evaluate(() => window.__ticker));
  }
  console.log('\n=== Scenario B: termination + respawn ===');
  console.log('ticker samples during the hang (must be strictly increasing):', tickerSamples);
  const strictlyIncreasing = tickerSamples.every((v, i) => i === 0 || v > tickerSamples[i - 1]);

  await page.evaluate(() => window.__respawnAndTestTrivial());
  await page.waitForFunction(() => window.__freshWorkerResult !== null, { timeout: 15000 });
  const freshResult = await page.evaluate(() => window.__freshWorkerResult);
  console.log('fresh worker result for 1+1 after terminate+respawn:', freshResult);

  const pass = strictlyIncreasing && freshResult === 2;
  console.log(pass ? 'PASS: main thread never stalled, fresh worker works after terminate()' : 'FAIL');
  allPass &&= pass;
  await page.close();
}

// ---- Scenario C: negative control (old main-thread path really does freeze) ----
{
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => window.runNegativeControl());
  // give it a moment to actually reach the hang before probing
  await page.waitForTimeout(3000);
  console.log('\n=== Scenario C: negative control ===');
  let froze = false;
  try {
    await page.evaluate(() => document.title, { timeout: 3000 });
    console.log('page responded to evaluate() -- did NOT freeze');
  } catch (err) {
    froze = true;
    console.log('page did not respond within 3s -- confirms the main thread really is frozen');
    console.log('(error, expected):', err.message.split('\n')[0]);
  }
  console.log(froze ? 'PASS: old main-thread path genuinely freezes on the same hang' : 'FAIL (unexpected -- old path should freeze)');
  allPass &&= froze;
  // Don't bother closing this page gracefully -- it's deliberately hung.
}

console.log('\n' + (allPass ? '=== ALL SCENARIOS PASS ===' : '=== AT LEAST ONE SCENARIO FAILED ==='));
process.exit(allPass ? 0 : 1);
