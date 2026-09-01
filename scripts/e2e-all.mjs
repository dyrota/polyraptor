// Runs every e2e suite and reports one summary.
//
//   npm run e2e                    start a dev server, run everything, stop it
//   npm run e2e -- http://host/    run against a server you already have
//   npm run e2e -- --only verify   run just the suites whose name contains
//                                  "verify"
//   npm run e2e -- --serial        one at a time (default is 4 at once)
//
// Suites run CONCURRENTLY by default, which is safe here for a specific
// reason: the app is entirely client-side, so each suite drives its own
// browser with its own private copy of the state. The only thing they share is
// a static file server. Output is buffered per suite and printed whole on
// completion, so concurrency never interleaves two suites' lines.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONCURRENCY = 4;
const DEV_PORT = 5199;

const argv = process.argv.slice(2);
const urlArg = argv.find((a) => a.startsWith('http'));
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx !== -1 ? argv[onlyIdx + 1] : null;
const concurrency = argv.includes('--serial') ? 1 : DEFAULT_CONCURRENCY;

const suites = readdirSync(SCRIPTS_DIR)
  .filter((f) => f.startsWith('e2e-') && f.endsWith('.mjs') && f !== 'e2e-all.mjs')
  .filter((f) => !only || f.includes(only))
  .sort();

if (suites.length === 0) {
  console.error(only ? `No suites match "${only}".` : 'No suites found.');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { cwd: join(SCRIPTS_DIR, '..'), ...opts });
}

// Returns [url, stop]. When the caller supplied a URL we start nothing and
// stopping is a no-op.
async function ensureServer() {
  if (urlArg) return [urlArg, async () => {}];

  const proc = run('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`dev server did not become ready within 30s. Output so far:\n${buffered}`));
    }, 30000);
    let buffered = '';
    const onData = (chunk) => {
      // Vite colorizes its banner, and the escape codes fall BETWEEN the host
      // and the port -- "http://localhost:" ESC "5199" ESC "/" -- so matching
      // a URL against the raw stream silently never fires. Strip first.
      buffered += chunk.toString().replace(/\[[0-9;]*m/g, '');
      if (/ready in|localhost:/.test(buffered)) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dev server exited with code ${code} before becoming ready`));
    });
  });
  // Built from the port we forced with --strictPort rather than scraped from
  // the banner: strictPort means vite either bound this port or exited.
  return [`http://localhost:${DEV_PORT}/`, async () => proc.kill('SIGTERM')];
}

function runSuite(file, url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const proc = run('node', [join(SCRIPTS_DIR, file), url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', (c) => (output += c));
    proc.stderr.on('data', (c) => (output += c));
    proc.on('close', (code) => resolve({ file, code, ms: Date.now() - started, output }));
  });
}

const [url, stopServer] = await ensureServer();
console.log(`Running ${suites.length} suite(s) against ${url}${concurrency > 1 ? ` (${concurrency} at a time)` : ''}\n`);

const results = [];
const queue = [...suites];
const startedAll = Date.now();

async function worker() {
  while (queue.length) {
    const file = queue.shift();
    const result = await runSuite(file, url);
    results.push(result);
    const tag = result.code === 0 ? 'PASS' : 'FAIL';
    console.log(`${tag}  ${file}  (${(result.ms / 1000).toFixed(1)}s)`);
    // A passing suite's chatter is noise once the summary says it passed; a
    // failing one is the only thing you actually want to read.
    if (result.code !== 0) {
      console.log(result.output.split('\n').map((l) => `      ${l}`).join('\n'));
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, suites.length) }, worker));
await stopServer();

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} suites passed in ${((Date.now() - startedAll) / 1000).toFixed(1)}s`);
if (failed.length) console.log(`Failed: ${failed.map((r) => r.file).join(', ')}`);
process.exit(failed.length ? 1 : 0);
