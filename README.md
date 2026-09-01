# polyraptor

**Algorithms you can watch — and that an agent can drive, live, on the exact page you're looking at.**

Built for [OpenAI's WebMCP Challenge](https://openai.com/webmcp-challenge/). polyraptor runs real search and sort algorithms live in your browser and exposes them as [WebMCP](https://github.com/webmachinelearning/webmcp) tools, so an AI agent (ChatGPT, or anything else that speaks WebMCP) can author problems, write and run Python, verify its own claims, and scrub through the results — while you watch, or drive it yourself with the exact same buttons the agent uses.

## Why this needs to be WebMCP, not just an MCP server

A regular MCP server hitting a REST API could expose "run this algorithm" as a tool. It couldn't do what this app actually does:

- **The agent's tool calls mutate the same live page you're looking at.** There's no polling, no separate view to refresh — when the agent calls `search_run_algorithm`, the maze on your screen updates immediately, because the tool *is* a function running in this tab.
- **The algorithms genuinely execute.** Search and sort run real Python — [`polysearch`](https://github.com/dyrota/polysearch) and [`polysort`](https://github.com/dyrota/polysort), two libraries with their own test suites — compiled to WebAssembly via [Pyodide](https://pyodide.org) and running entirely client-side. No backend, no server executing anyone's code.
- **A human and an agent can touch the same state at the same time, in both directions.** Every panel has manual buttons (New Maze, New Dataset, Run, Verify) wired to the *identical* store the WebMCP tools read and write, and `search_get_state`/`sort_get_state` let an agent discover state a human created by clicking. A human can be mid-interaction while an agent calls a tool, and both see the same result immediately — that's the actual thesis of the project, not a demo trick.

## Two families

- **Search** — 8 algorithms (A\*, Best-First, Branch & Bound, BFS, DFS, Hill Climbing, Iterative Deepening, UCS) on maze, N-Queens, and missionaries-and-cannibals problems.
- **Sort** — all 10 algorithms in `polysort` (bubble, selection, insertion, merge, quick, heap, counting, radix, shell, tim), animated bar-by-bar as they run, with cross-algorithm benchmarking on identical input.

Both families let a human *or* an agent supply real Python instead of picking a built-in: a whole `StateSpaceProblem`/`SortProblem`, a whole algorithm, or just the one interesting function (a heuristic, a comparator). Untrusted code runs in a dedicated worker with a hard timeout, so an infinite loop is a friendly error message rather than a frozen tab.

## Heuristic verification

The standout feature. `search_verify_heuristic` takes a heuristic someone actually wrote and empirically checks it against ground truth — computed by exhaustively exploring the reachable state space and running a multi-source backward Dijkstra from every goal state, so it works on N-Queens (many goals) and custom Python problems, not just mazes. Three properties, each returning a concrete counterexample rather than a boolean:

| property | meaning |
| --- | --- |
| `admissible` | `h(n) ≤ h*(n)` — never overestimates the true remaining cost |
| `consistent` | `h(n) ≤ c(n,n′) + h(n′)` on every edge — strictly stronger; what A\* actually needs |
| `goal_zero` | `h(goal) == 0` |

**The verdict matters more than the booleans.** Ground truth requires exhaustive exploration, which an arbitrary problem can outgrow, and under a truncated exploration the backward cost map is computed over a subgraph — so `dist_partial(n) ≥ dist_true(n)`. That asymmetry means a violation found is always a real violation, while the *absence* of one proves something only if exploration completed. Hence three verdicts:

- `refuted` — a counterexample exists. Trustworthy at any problem size.
- `proven` — the whole reachable state space was explored and nothing was found. A real guarantee.
- `unrefuted` — the budget was hit. Nothing found among what was checked, which is **not** the same as admissible.

Reporting `unrefuted` as "admissible" would be a lie, and the gap between "I found no bug" and "there is no bug" is the thing the feature exists to teach. The counterexample is rendered on the board — the exact cell where the heuristic overestimates, and by how much — so a refutation is something you can look at, not just read.

## Architecture

- **Zero backend.** Static Vite + React + TypeScript app. Everything — including running real Python — happens in your browser tab.
- **Vendored, instrumented wheels.** `polysearch`/`polysort` ship in `public/wheels/`, built from the upstream repos and carrying an additive `on_step(event)` callback threaded through every algorithm (opt-in, `None` by default, zero behavior change when omitted) — that callback is what makes every step of a run animatable. Vendoring is the architecture rather than a stopgap: `micropip` resolves an install URL from inside Pyodide's virtual filesystem, so the wheel has to sit at an absolute same-origin URL, and serving it from `public/` is what lets a static app with no backend install a real Python package at runtime.
- **JSON-string bridge, not raw dicts.** Every event crossing from Python to JS is `json.dumps()`'d on the Python side and `JSON.parse()`'d on the JS side, deliberately avoiding Pyodide's PyProxy/dict-marshalling behavior, which turned out not to match its own documentation in the version this app uses. Values are sanitized on the way out (`pyodide/pySafeJson.ts`): Python emits bare `Infinity`/`NaN` tokens that JS's `JSON.parse` rejects outright, and `float('inf')` is the idiomatic way to write "unreachable" in a heuristic.
- **Two execution paths.** Built-in algorithms on built-in problems run on the main thread. Anything touching authored code — including a built-in algorithm on a custom problem, since it calls back into that problem's methods — runs in the worker behind a timeout.
- **Run once, replay client-side.** Algorithms run to completion once (they're fast — teaching-scale inputs, sub-second), capturing a full event trace; `playback_play`/`step`/`jump_to` then scrub through that trace with zero further Python calls, shared across the search and sort families.
- **Authored code persists locally.** Each editor's contents survive a reload via `localStorage`, with a "Reset to template" escape hatch. Storage is treated as optional — private windows make these calls throw, and the app works and simply forgets.

See `dev-notes/` for the incremental verification pages that de-risked this architecture before anything in `src/` was built on top of it.

## Running it locally

```
npm install
npm run dev
```

Open the URL it prints in Chrome with `chrome://flags/#enable-webmcp-testing` enabled, or in ChatGPT's in-app browser.

`scripts/e2e-*.mjs` are Playwright-based smoke tests driving real Chrome, real WebMCP tool calls, and real Pyodide. They need a running dev server, so start one first and pass its URL:

```
node scripts/e2e-smoke.mjs http://localhost:5173/
```

| suite | covers |
| --- | --- |
| `e2e-smoke` | search family, end to end |
| `e2e-sort-smoke` | sort family, end to end |
| `e2e-python-search-smoke` / `e2e-python-sort-smoke` | authored problems, including timeout + worker respawn |
| `e2e-python-algorithm-smoke` | authored algorithms against built-in and custom problems |
| `e2e-python-tier3-smoke` | authored heuristics and comparators |
| `e2e-share-link-smoke` | shareable links round-trip |
| `e2e-verify-heuristic-smoke` | heuristic verification, all three verdicts |
| `e2e-state-discovery-smoke` | an agent seeing state a human created |
| `e2e-persistence-smoke` | reload survival, and storage being unavailable |
| `e2e-regression-smoke` | specific bugs found in audit, kept fixed |

## Roadmap

- **`polyevolve`** as a proper Python package — would complete a `polysearch` / `polysort` / `polyevolve` trilogy sharing one instrumentation convention. A JS-native genetic-algorithm family (Matter.js creatures) shipped and was then removed in `0f5adcd` precisely so it could come back this way; the working prototype is preserved at the `evolve-js-prototype` tag.
- **Comparator verification for sort** — the same machinery applied to the other family. A comparator has real checkable properties (totality, antisymmetry, transitivity), and an intransitive one is a classic bug that produces silently wrong output rather than an error.
- **Interleaved human/agent activity log** — the sidebar currently shows only the agent's tool calls, so a human's own clicks are invisible in the one place the shared-state thesis would be most legible.

## Vendored library changes

Building this app surfaced real bugs in both libraries. They were fixed at the source rather than worked around here, and both changes are now merged upstream — [polysearch#1](https://github.com/dyrota/polysearch/pull/1) and [polysort#1](https://github.com/dyrota/polysort/pull/1) — along with the `on_step` instrumentation the animation layer depends on:

- **`iterative_deepening` never iterated.** It treated `max_depth` as the depth to search *at* rather than a ceiling, so it ran one depth-limited DFS and returned whatever it found — a 57-step path on an open 8×8 grid where the optimum is 15. It also reported `inferences: 0` on that branch, making it look free next to every other algorithm.
- **`hill_climbing` reported stalls as solutions**, returning its partial path when it hit a local optimum. Worse, `random_restart` selected on lowest cost, so a climb that stalled immediately (cost 0) beat one that reached the goal — it reliably picked the *worst* attempt. Restarts also always began from `initial_state()`, so they could not escape the optimum they exist to escape; a problem can now opt in with a `random_state()` method.
- **`counting_sort` and `radix_sort` silently ignored the comparator.** Being non-comparison sorts they cannot honor one, but they said nothing about it: given a descending comparator they returned an ascending list. They now raise a `TypeError` naming the limitation, which matters here because this app checks sortedness *using* the problem's comparator and would otherwise blame the student's code.

### Rebuilding the wheels

Neither library is on PyPI yet, and a released version wouldn't change the vendoring — the wheel still has to be served same-origin for `micropip` to install it. What a vendored `.whl` *does* lose is provenance: it's an opaque binary with no record of which commit produced it. `public/wheels/MANIFEST.json` closes that gap, and `scripts/build-wheels.mjs` regenerates both:

```
npm run wheels          # rebuild both wheels + manifest from local checkouts
npm run wheels:check    # verify the vendored wheels match those checkouts
```

Checkouts default to `../polysearch` and `../polysort`; override with `POLYSEARCH_DIR` / `POLYSORT_DIR`. Building from a dirty tree is refused unless you pass `--allow-dirty`, so a wheel always maps to a commit that exists. `wheels:check` compares module contents rather than file hashes — wheels are zip archives carrying mtimes, so two builds of identical source are never byte-identical.

## License

MIT — see `LICENSE`.
