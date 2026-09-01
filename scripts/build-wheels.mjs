// Rebuilds the two vendored wheels in public/wheels/ from local checkouts of
// polysearch and polysort, and records which upstream commit each one came
// from.
//
// WHY THE WHEELS ARE VENDORED AT ALL. micropip resolves an install URL from
// inside Pyodide's virtual filesystem, so the wheel has to be reachable at an
// absolute same-origin URL (see src/pyodide/config.ts). Serving it out of
// public/ is the only thing that satisfies that for a static, zero-backend
// app -- this is the architecture, not a placeholder for "pip install
// polysearch" once the libraries are on PyPI. Vendoring also keeps the app and
// the two libraries moving together: the on_step instrumentation the whole
// animation layer depends on landed upstream in tandem with this app, and a
// released-to-PyPI version would still need to be pinned to a build that has
// it.
//
// WHAT THIS SCRIPT ADDS. Building a wheel by hand leaves no record of which
// source it came from, so a vendored .whl is otherwise an opaque binary that
// nobody -- including its author six weeks later -- can map back to a commit.
// Every build writes public/wheels/MANIFEST.json with the origin URL, commit
// SHA, subject line and tree-clean status of each source checkout, plus a
// sha256 of the wheel itself.
//
// Usage:
//   node scripts/build-wheels.mjs              rebuild both wheels + manifest
//   node scripts/build-wheels.mjs --check      verify vendored wheels match
//                                              their checkouts; build nothing
//   node scripts/build-wheels.mjs --allow-dirty
//                                              build from a checkout with
//                                              uncommitted changes (records
//                                              dirty: true in the manifest)
//
// Checkout locations default to siblings of this repo and can be overridden
// with POLYSEARCH_DIR / POLYSORT_DIR.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WHEELS_DIR = join(REPO_ROOT, 'public', 'wheels');
const MANIFEST_PATH = join(WHEELS_DIR, 'MANIFEST.json');

const LIBRARIES = [
  { name: 'polysearch', dir: process.env.POLYSEARCH_DIR ?? resolve(REPO_ROOT, '..', 'polysearch') },
  { name: 'polysort', dir: process.env.POLYSORT_DIR ?? resolve(REPO_ROOT, '..', 'polysort') },
];

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const ALLOW_DIRTY = args.has('--allow-dirty');

const PYTHON = process.env.PYTHON ?? 'python3';

function git(dir, ...gitArgs) {
  return execFileSync('git', ['-C', dir, ...gitArgs], { encoding: 'utf8' }).trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Wheels are zip archives carrying per-file mtimes, so two builds of identical
// source differ byte-for-byte and a hash comparison would report drift on
// every run. Compare what actually matters instead: the set of members and the
// bytes of each. `unzip -p` streams a single member to stdout, which keeps this
// dependency-free -- the alternative is pulling a zip library into a repo that
// otherwise has none.
function wheelContentDigest(wheelPath) {
  const listing = execFileSync('unzip', ['-Z1', wheelPath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // dist-info/RECORD and METADATA embed build-dependent detail; the .py
    // sources are the thing whose drift would change app behavior.
    .filter((entry) => entry.endsWith('.py'))
    .sort();

  const hash = createHash('sha256');
  for (const entry of listing) {
    hash.update(entry);
    hash.update(execFileSync('unzip', ['-p', wheelPath, entry], { maxBuffer: 64 * 1024 * 1024 }));
  }
  return { digest: hash.digest('hex'), fileCount: listing.length };
}

function buildWheel(lib, outDir) {
  execFileSync(PYTHON, ['-m', 'build', '--wheel', '--outdir', outDir], {
    cwd: lib.dir,
    stdio: CHECK_ONLY ? 'ignore' : 'inherit',
  });
  const built = readdirSync(outDir).filter((f) => f.startsWith(`${lib.name}-`) && f.endsWith('.whl'));
  if (built.length !== 1) {
    throw new Error(`expected exactly one ${lib.name} wheel in ${outDir}, found ${built.length}: ${built.join(', ')}`);
  }
  return join(outDir, built[0]);
}

function describeCheckout(lib) {
  if (!existsSync(lib.dir)) {
    throw new Error(
      `${lib.name} checkout not found at ${lib.dir}. Clone it beside this repo, or set ${lib.name.toUpperCase()}_DIR.`
    );
  }
  const dirty = git(lib.dir, 'status', '--porcelain') !== '';
  if (dirty && !ALLOW_DIRTY && !CHECK_ONLY) {
    throw new Error(
      `${lib.name} checkout at ${lib.dir} has uncommitted changes. Commit them so the wheel maps to a real ` +
        `commit, or pass --allow-dirty to record the build as dirty.`
    );
  }
  return {
    origin: git(lib.dir, 'remote', 'get-url', 'origin'),
    commit: git(lib.dir, 'rev-parse', 'HEAD'),
    commit_subject: git(lib.dir, 'log', '-1', '--format=%s'),
    committed_at: git(lib.dir, 'log', '-1', '--format=%cI'),
    branch: git(lib.dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
    dirty,
  };
}

function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'polyraptor-wheels-'));
  let failures = 0;
  const entries = {};

  try {
    for (const lib of LIBRARIES) {
      const checkout = describeCheckout(lib);
      const outDir = join(scratch, lib.name);
      const freshWheel = buildWheel(lib, outDir);

      if (CHECK_ONLY) {
        const vendored = join(WHEELS_DIR, `${lib.name}-0.1.0-py3-none-any.whl`);
        if (!existsSync(vendored)) {
          console.error(`FAIL  ${lib.name}: no vendored wheel at ${vendored}`);
          failures += 1;
          continue;
        }
        const fresh = wheelContentDigest(freshWheel);
        const current = wheelContentDigest(vendored);
        if (fresh.digest === current.digest) {
          console.log(
            `ok    ${lib.name}  matches ${checkout.commit.slice(0, 7)}` +
              `${checkout.dirty ? ' (working tree dirty)' : ''}  ${fresh.fileCount} modules`
          );
        } else {
          console.error(
            `FAIL  ${lib.name}: vendored wheel does not match ${lib.dir} @ ${checkout.commit.slice(0, 7)}. ` +
              `Run: node scripts/build-wheels.mjs`
          );
          failures += 1;
        }
        continue;
      }

      const dest = join(WHEELS_DIR, `${lib.name}-0.1.0-py3-none-any.whl`);
      copyFileSync(freshWheel, dest);
      entries[lib.name] = {
        wheel: `${lib.name}-0.1.0-py3-none-any.whl`,
        sha256: sha256(dest),
        source: checkout,
      };
      console.log(`built ${lib.name}  from ${checkout.commit.slice(0, 7)} (${checkout.commit_subject})`);
    }

    if (CHECK_ONLY) {
      if (failures > 0) {
        console.error(`\n${failures} wheel(s) out of date.`);
        process.exit(1);
      }
      console.log('\nVendored wheels match their source checkouts.');
      return;
    }

    const manifest = {
      // Read by humans and by --check, not by the app: the app resolves wheels
      // by filename (src/pyodide/config.ts) and never parses this.
      _comment:
        'Generated by scripts/build-wheels.mjs. Records which upstream commit each vendored wheel was built from.',
      generated_at: new Date().toISOString(),
      pyodide_version_at_build: readPyodideVersion(),
      libraries: entries,
    };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nWrote ${MANIFEST_PATH.replace(`${REPO_ROOT}/`, '')}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The wheels are pure-Python and not tied to a Pyodide version, but recording
// which one they were last exercised against makes a Pyodide bump that breaks
// them easier to place.
function readPyodideVersion() {
  const config = readFileSync(join(REPO_ROOT, 'src', 'pyodide', 'config.ts'), 'utf8');
  return config.match(/PYODIDE_VERSION = '([^']+)'/)?.[1] ?? 'unknown';
}

main();
