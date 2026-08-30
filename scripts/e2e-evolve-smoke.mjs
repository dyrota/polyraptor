import { chromium } from 'playwright';
import fs from 'node:fs';

const targetUrl = process.argv[2] || 'http://localhost:5173/';
const SHOT_DIR = new URL('../.smoke-shots/', import.meta.url).pathname;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const pageErrors = [];

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport,WebMCP'],
});
const page = await browser.newPage();
page.on('pageerror', (err) => pageErrors.push(err.stack || String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push('[console.error] ' + msg.text());
});

await page.goto(targetUrl, { waitUntil: 'load' });
await page.waitForTimeout(3000);

async function call(name, args) {
  return JSON.parse(await page.evaluate(
    ([n, a]) => navigator.modelContextTesting.executeTool(n, a),
    [name, JSON.stringify(args)]
  ));
}

// Switch to the Evolve tab so its canvas mounts.
await page.click('.app-tabs >> text=Evolve');
await page.waitForTimeout(300);

console.log('=== evolve_set_params ===');
const setResult = await call('evolve_set_params', { population_size: 16, simulation_ticks: 200, mutation_rate: 0.15, mutation_amount: 0.3, selection_strategy: 'tournament', elite_count: 2 });
console.log(setResult);

const history = [];
console.log('\n=== advancing 15 generations, one call at a time ===');
for (let i = 0; i < 15; i++) {
  const r = await call('evolve_advance_generation', { generations: 1 });
  history.push({ gen: r.generation, best: r.best_fitness, avg: r.average_fitness });
  console.log(`gen ${r.generation}: best=${r.best_fitness?.toFixed(2)}px avg=${r.average_fitness?.toFixed(2)}px`);
}

await page.waitForTimeout(500);
await page.screenshot({ path: SHOT_DIR + 'evolve-01-population.png', fullPage: true });

const first5 = history.slice(0, 5).reduce((s, r) => s + r.best, 0) / 5;
const last5 = history.slice(-5).reduce((s, r) => s + r.best, 0) / 5;
console.log(`\nfirst-5-gen avg best: ${first5.toFixed(2)}px, last-5-gen avg best: ${last5.toFixed(2)}px`);
console.log(last5 > first5 ? 'IMPROVING TREND: yes' : 'IMPROVING TREND: NO');

console.log('\n=== evolve_get_population_state ===');
console.log(await call('evolve_get_population_state', {}));

console.log('\n=== evolve_select_survivor + evolve_breed_pair ===');
const popState = await call('evolve_get_population_state', {});
const ids = popState.population.map((c) => c.id);
console.log(await call('evolve_select_survivor', { creature_id: ids[0], force_survive: true }));
console.log(await call('evolve_breed_pair', { parent_a_id: ids[0], parent_b_id: ids[1] }));

// Watch the best creature run live for a couple seconds and screenshot mid-animation.
await page.waitForTimeout(1500);
await page.screenshot({ path: SHOT_DIR + 'evolve-02-watch-mid.png', fullPage: true });

console.log('\n=== search/sort regression check ===');
await page.click('.app-tabs >> text=Search');
await page.waitForTimeout(200);
const maze = await call('search_author_maze', { rows: 8, cols: 8, wall_density: 0.25 });
const run = await call('search_run_algorithm', { problem_id: maze.problem_id, algorithm: 'a_star', heuristic: 'manhattan_distance' });
console.log('search:', JSON.stringify(run.summary.path_found), run.summary.cost);
await page.click('.app-tabs >> text=Sort');
await page.waitForTimeout(200);
const ds = await call('sort_author_dataset', { dataset_type: 'random_integers', size: 20, seed: 1 });
const sortRun = await call('sort_run_algorithm', { problem_id: ds.problem_id, algorithm: 'bubble_sort' });
console.log('sort:', JSON.stringify(sortRun.summary.is_sorted));

console.log('\n=== page errors ===');
pageErrors.forEach((e) => console.log(e));
console.log(pageErrors.length === 0 ? '\nNO PAGE ERRORS' : `\n${pageErrors.length} PAGE ERRORS`);

await browser.close();
process.exit(pageErrors.length > 0 ? 1 : 0);
