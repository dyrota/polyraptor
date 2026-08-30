// Automated smoke test: launches real Chrome (matching what's been tested
// manually), loads the running dev server, captures console/page errors,
// screenshots the result, and — if the WebMCP testing flags actually work in
// an automated launch — exercises the same tool-calling sequence used for
// manual verification throughout this project. Not a permanent CI suite,
// just a way to catch regressions (crashes, visual issues) before a human
// has to.
import { chromium } from 'playwright';
import fs from 'node:fs';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const SHOT_DIR = new URL('../.smoke-shots/', import.meta.url).pathname;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const consoleMessages = [];
const pageErrors = [];

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();

page.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => pageErrors.push(err.stack || String(err)));

console.log(`Navigating to ${targetUrl} ...`);
await page.goto(targetUrl, { waitUntil: 'load' });

// Give React/Pyodide a moment to settle.
await page.waitForTimeout(4000);

await page.screenshot({ path: SHOT_DIR + '01-initial.png', fullPage: true });

const headerText = await page.locator('.status-bar').innerText().catch(() => '(status bar not found)');
console.log('Header status:', JSON.stringify(headerText));

const webmcpTestingAvailable = await page.evaluate(() => {
  return typeof navigator.modelContextTesting?.listTools === 'function';
});
console.log('navigator.modelContextTesting available:', webmcpTestingAvailable);

let toolNames = null;
if (webmcpTestingAvailable) {
  toolNames = await page.evaluate(() => navigator.modelContextTesting.listTools().map((t) => t.name));
  console.log('Registered tools:', toolNames);

  // Exercise the same sequence used for manual verification.
  const result = await page.evaluate(async () => {
    const call = async (name, args) => JSON.parse(await navigator.modelContextTesting.executeTool(name, JSON.stringify(args)));
    const maze = await call('search_author_maze', { rows: 10, cols: 10, wall_density: 0.3 });
    const run = await call('search_run_algorithm', { problem_id: maze.problem_id, algorithm: 'a_star', heuristic: 'manhattan_distance' });
    await call('playback_play', { trace_id: run.trace_id, speed: 4 });
    return { maze, run };
  });
  console.log('Tool sequence result:', JSON.stringify(result, null, 2));

  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOT_DIR + '02-mid-animation.png', fullPage: true });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: SHOT_DIR + '03-later.png', fullPage: true });
}

console.log('\n=== Console messages ===');
consoleMessages.forEach((m) => console.log(m));
console.log('\n=== Page errors ===');
pageErrors.forEach((e) => console.log(e));
console.log(`\nScreenshots written to ${SHOT_DIR}`);

await browser.close();
process.exit(pageErrors.length > 0 ? 1 : 0);
