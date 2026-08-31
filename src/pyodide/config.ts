// Single source of truth for the Pyodide CDN version and vendored wheel
// paths, shared by the main-thread bridge (bridge.ts) and the untrusted-code
// worker (worker.ts) so the two paths can never silently drift onto
// different Pyodide versions.
export const PYODIDE_VERSION = '314.0.6';
export const PYODIDE_CDN_SCRIPT_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
export const PYODIDE_CDN_MODULE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;

export function wheelUrl(name: 'polysearch' | 'polysort'): string {
  const filename = name === 'polysearch' ? 'polysearch-0.1.0-py3-none-any.whl' : 'polysort-0.1.0-py3-none-any.whl';
  // Absolute URL is required, not optional: micropip resolves this from
  // inside Pyodide's own virtual filesystem, where a relative path means
  // nothing. Built from Vite's BASE_URL rather than hardcoding "/wheels/" so
  // a subpath deploy (GitHub Pages, or any host serving this under a prefix)
  // still finds them -- the old form silently 404'd anywhere but the domain
  // root, and a missing wheel surfaces as an opaque micropip failure during
  // startup rather than anything that names the real cause.
  //
  // `self`, not `window` -- this is called from both the main thread
  // (bridge.ts) and the worker (worker.ts), and a worker's global scope has
  // no `window`. `self.location.origin` works in both: in a window context
  // `self === window`, in a worker `self` is the worker's own global scope,
  // and both expose `.location.origin`.
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${self.location.origin}${prefix}wheels/${filename}`;
}
