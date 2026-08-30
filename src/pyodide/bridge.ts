// Loads Pyodide from the jsdelivr CDN, installs the two vendored,
// on_step-instrumented wheels via micropip, and exposes typed wrappers for
// running algorithms with the JSON-string on_step bridge pattern.
//
// CRITICAL, empirically discovered (see plan doc "Phase 0 checkpoint 4"):
// never pass a raw Python dict across the Python->JS callback boundary.
// PyProxy/toJs conversion in the current Pyodide (v314.x) release does not
// behave as documented (Object.fromEntries(event.toJs()) throws "object is
// not iterable"). The fix, load-bearing for this whole app: the Python side
// always json.dumps() the event dict before calling the JS callback, and the
// JS side always JSON.parse()s a plain string. Do not "fix" this by trying
// PyProxy conversion again.

import { PYODIDE_CDN_SCRIPT_URL, wheelUrl } from './config';

declare global {
  interface Window {
    loadPyodide: (config?: { indexURL?: string }) => Promise<PyodideInterface>;
  }
}

// Minimal surface of the Pyodide instance actually used here — avoids taking
// a full @types/pyodide dependency for a handful of methods.
export interface PyodideInterface {
  loadPackage: (names: string | string[]) => Promise<void>;
  pyimport: (name: string) => { install: (url: string) => Promise<void> };
  globals: { set: (name: string, value: unknown) => void };
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
}

let pyodideSingleton: Promise<PyodideInterface> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

// The two libraries only need to be installed once per page load; every
// subsequent algorithm run reuses the same warmed-up Pyodide runtime, so
// per-run cost is just running the (fast, teaching-scale) algorithm itself.
export async function getPyodide(
  onProgress?: (message: string) => void
): Promise<PyodideInterface> {
  if (pyodideSingleton) return pyodideSingleton;

  pyodideSingleton = (async () => {
    onProgress?.('Loading Pyodide runtime...');
    await loadScript(PYODIDE_CDN_SCRIPT_URL);
    const pyodide = await window.loadPyodide();

    onProgress?.('Loading micropip...');
    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');

    onProgress?.('Installing polysearch...');
    await micropip.install(wheelUrl('polysearch'));
    onProgress?.('Installing polysort...');
    await micropip.install(wheelUrl('polysort'));

    onProgress?.('Ready.');
    return pyodide;
  })();

  return pyodideSingleton;
}

// Registers the JSON-string bridge for a single Python-side call. Each call
// gets its own uniquely-named JS global to avoid cross-talk between
// concurrent/rapid tool calls (e.g. two algorithm runs kicked off back to back
// before the first's Python call has returned).
let bridgeCounter = 0;

export async function runPythonWithOnStep(
  pythonSetupAndCall: (onStepGlobalName: string) => string,
  onEvent: (eventDict: Record<string, unknown>) => void
): Promise<unknown> {
  const pyodide = await getPyodide();
  const globalName = `_polyraptor_on_step_${++bridgeCounter}`;

  const jsCallback = (jsonString: string) => {
    try {
      onEvent(JSON.parse(jsonString));
    } catch (err) {
      console.error('polyraptor: failed to parse on_step JSON payload', err, jsonString);
    }
  };

  pyodide.globals.set(globalName, jsCallback);
  const code = pythonSetupAndCall(globalName);
  return pyodide.runPythonAsync(code);
}
