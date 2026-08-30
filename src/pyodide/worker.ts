// Module-type worker running untrusted, student-authored Python. Kept
// entirely separate from bridge.ts's main-thread, unbounded execution path
// -- see the plan doc ("Architecture: running untrusted student code
// safely") for why. Proven pattern from dev-notes/phase0-check5's spike
// (streaming via postMessage during synchronous execution, clean
// terminate()+respawn on a hang) -- this is that pattern ported to a real
// message protocol, not a redesign.
//
// tsconfig's lib includes DOM (for every other file in this app), which
// declares an incompatible `self`/`postMessage` shape for a worker context.
// Rather than fight that with a global augmentation (which would leak into
// every other file), this casts `self` locally to a minimal hand-rolled
// interface -- same "don't pull the full type package, hand-roll just what's
// used" philosophy bridge.ts already applies to PyodideInterface.
import { PYODIDE_CDN_MODULE_URL, wheelUrl } from './config';
import type { PyodideInterface } from './bridge';

interface WorkerSelf {
  postMessage: (data: unknown) => void;
  onmessage: ((event: { data: WorkerInMessage }) => void) | null;
}
const workerSelf = self as unknown as WorkerSelf;

interface PyodideModuleInterface extends PyodideInterface {
  runPythonAsync: (code: string) => Promise<unknown>;
}

type WorkerInMessage = { type: 'run'; id: string; python: string; extraGlobals?: Record<string, string> };

type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'on_step'; id: string; payload: string }
  | { type: 'result'; id: string; payload: string }
  | { type: 'error'; id: string; payload: { rawMessage: string; rawTraceback: string } };

function post(msg: WorkerOutMessage) {
  workerSelf.postMessage(msg);
}

const pyodideReady: Promise<PyodideModuleInterface> = (async () => {
  // /* @vite-ignore */ tells Vite's bundler not to try to statically analyze
  // or transform this specifier -- it's a real absolute URL meant to be
  // resolved by the browser's own native module loader at runtime, exactly
  // like the spike proved works, not something Vite should bundle.
  const mod = (await import(/* @vite-ignore */ PYODIDE_CDN_MODULE_URL)) as {
    loadPyodide: (config?: { indexURL?: string }) => Promise<PyodideModuleInterface>;
  };
  const pyodide = await mod.loadPyodide();
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');
  await micropip.install(wheelUrl('polysearch'));
  await micropip.install(wheelUrl('polysort'));
  // Teaching-scale problems never legitimately need deep recursion; this
  // turns a runaway-recursion bug into a fast, clean RecursionError instead
  // of a slow grind toward the full timeout. Same app-layer-guardrail
  // pattern as the existing iterative_deepening max_depth cap.
  pyodide.runPython('import sys; sys.setrecursionlimit(300)');
  post({ type: 'ready' });
  return pyodide;
})();

workerSelf.onmessage = async (event) => {
  const pyodide = await pyodideReady;
  const msg = event.data;
  if (msg.type !== 'run') return;

  const onStepGlobal = '_polyraptor_worker_on_step';
  pyodide.globals.set(onStepGlobal, (jsonString: string) => {
    post({ type: 'on_step', id: msg.id, payload: jsonString });
  });

  for (const [key, value] of Object.entries(msg.extraGlobals ?? {})) {
    pyodide.globals.set(key, value);
  }

  try {
    const result = await pyodide.runPythonAsync(msg.python);
    post({ type: 'result', id: msg.id, payload: String(result) });
  } catch (err) {
    // Pyodide's JS-side PythonError.message is the full multi-line Python
    // traceback (including "File "<your code>", line N" for frames inside
    // student source, since the wiring template compiles it under that
    // exact filename -- see runPythonProblem.ts). rawTraceback keeps that
    // whole thing for a "show details" disclosure; rawMessage is just the
    // final summary line (e.g. "TypeError: ...") for friendlyErrors.ts's
    // pattern matching, which expects the message alone, not the frames
    // above it.
    const rawTraceback = err instanceof Error ? err.message : String(err);
    const lines = rawTraceback.trim().split('\n');
    const rawMessage = lines[lines.length - 1] || rawTraceback;
    post({ type: 'error', id: msg.id, payload: { rawMessage, rawTraceback } });
  }
};
