# dev-notes

Standalone diagnostic pages used to de-risk the architecture before building the real app in `src/` — not part of the app itself, nothing under `src/` imports from here.

- **phase0-check1** — confirms the WebMCP tool-calling round trip (`document.modelContext`/`navigator.modelContext` registration, discovery, execution) in isolation, with no Pyodide involved.
- **phase0-check2** — confirms Pyodide + `micropip` can load a locally-built, vendored wheel via an absolute same-origin URL, using a throwaway dummy package.
- **phase0-check3** — confirms the real, `on_step`-instrumented `polysearch` wheel runs a real algorithm through Pyodide with a real JS callback, and specifically nails down how Python dicts need to cross the Python→JS boundary (JSON-string, not a raw dict — see the comment at the top of `src/pyodide/bridge.ts`).

Each one isolates a single unknown before the next layer got built on top of it. Kept because the failures found here (Pyodide's `toJs()` not behaving as documented, the Chrome testing API's real method names) are exactly the kind of thing worth having a record of.
