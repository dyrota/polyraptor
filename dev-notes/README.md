# dev-notes

Standalone diagnostic pages used to de-risk the architecture before building the real app in `src/` — not part of the app itself, nothing under `src/` imports from here.

- **phase0-check1** — confirms the WebMCP tool-calling round trip (`document.modelContext`/`navigator.modelContext` registration, discovery, execution) in isolation, with no Pyodide involved.
- **phase0-check2** — confirms Pyodide + `micropip` can load a locally-built, vendored wheel via an absolute same-origin URL, using a throwaway dummy package.
- **phase0-check3** — confirms the real, `on_step`-instrumented `polysearch` wheel runs a real algorithm through Pyodide with a real JS callback, and specifically nails down how Python dicts need to cross the Python→JS boundary (JSON-string, not a raw dict — see the comment at the top of `src/pyodide/bridge.ts`).
- **phase0-check5** — confirms the untrusted-code worker is viable before `src/pyodide/worker.ts` was written on top of it: that `postMessage` streams out of a worker *during* synchronous Python execution (so an animation can fill in while student code runs), and that `terminate()` + respawn cleanly kills a genuine infinite loop and leaves the next run healthy. `verify.mjs` drives the page and prints evidence; both `src/pyodide/worker.ts` and `src/pyodide/workerBridge.ts` cite it by name.

Each one isolates a single unknown before the next layer got built on top of it. Kept because the failures found here (Pyodide's `toJs()` not behaving as documented, the Chrome testing API's real method names) are exactly the kind of thing worth having a record of.
