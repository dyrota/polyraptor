// Single source of truth for the Pyodide CDN version and vendored wheel
// paths, shared by the main-thread bridge (bridge.ts) and the untrusted-code
// worker (worker.ts) so the two paths can never silently drift onto
// different Pyodide versions.
export const PYODIDE_VERSION = '314.0.6';
export const PYODIDE_CDN_SCRIPT_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
export const PYODIDE_CDN_MODULE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;

export function wheelUrl(name: 'polysearch' | 'polysort'): string {
  const filename = name === 'polysearch' ? 'polysearch-0.1.0-py3-none-any.whl' : 'polysort-0.1.0-py3-none-any.whl';
  // `self`, not `window` -- this is called from both the main thread
  // (bridge.ts) and the worker (worker.ts), and a worker's global scope has
  // no `window`. `self.location.origin` works in both: in a window context
  // `self === window`, in a worker `self` is the worker's own global scope,
  // and both expose `.location.origin`.
  return `${self.location.origin}/wheels/${filename}`;
}
