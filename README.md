# polyraptor

**Algorithms you can watch — and that an agent can drive, live, on the exact page you're looking at.**

Built for [OpenAI's WebMCP Challenge](https://openai.com/webmcp-challenge/). polyraptor runs real search and sort algorithms live in your browser and exposes them as [WebMCP](https://github.com/webmachinelearning/webmcp) tools, so an AI agent (ChatGPT, or anything else that speaks WebMCP) can author problems, write and run Python, verify its own claims, and scrub through the results — while you watch, or drive it yourself with the exact same buttons the agent uses.

## Why this needs to be WebMCP, not just an MCP server

A regular MCP server hitting a REST API could expose "run this algorithm" as a tool. It couldn't do what this app actually does:

- **The agent's tool calls mutate the same live page you're looking at.** There's no polling, no separate view to refresh — when the agent calls `search_run_algorithm`, the maze on your screen updates immediately, because the tool *is* a function running in this tab.
- **The algorithms genuinely execute.** Search and sort run real Python — [`polysearch`](https://github.com/dyrota/polysearch) and [`polysort`](https://github.com/dyrota/polysort), two libraries with their own test suites — compiled to WebAssembly via [Pyodide](https://pyodide.org) and running entirely client-side. No backend, no server executing anyone's code.
- **A human and an agent can touch the same state at the same time, in both directions.** Every panel has manual buttons (New Maze, New Dataset, Run, Verify) wired to the *identical* store the WebMCP tools read and write, and `search_get_state`/`sort_get_state` let an agent discover state a human created by clicking. A human can be mid-interaction while an agent calls a tool, and both see the same result immediately — that's the actual thesis of the project, not a demo trick. The sidebar shows both sides on **one interleaved timeline**, so "the agent did this, then you did that, then the agent did this" is something you watch happen rather than something this README asserts.

## Two families

- **Search** — 8 algorithms (A\*, Best-First, Branch & Bound, BFS, DFS, Hill Climbing, Iterative Deepening, UCS) on maze, N-Queens, and missionaries-and-cannibals problems.
- **Sort** — all 10 algorithms in `polysort` (bubble, selection, insertion, merge, quick, heap, counting, radix, shell, tim), animated bar-by-bar as they run, with cross-algorithm benchmarking on identical input.

Both families let a human *or* an agent supply real Python instead of picking a built-in: a whole `StateSpaceProblem`/`SortProblem`, a whole algorithm, or just the one interesting function (a heuristic, a comparator). Untrusted code runs in a dedicated worker with a hard timeout, so an infinite loop is a friendly error message rather than a frozen tab.

## Verification

The standout feature, and the one both families now share: take code someone actually wrote and *empirically check whether it was allowed to do what it did* — reporting a concrete counterexample rather than a boolean, and an honest verdict rather than a green tick.

**The verdict matters more than the booleans.** Both checks are bounded by a budget, and hitting it makes the two "nothing found" outcomes mean genuinely different things. A violation found among a subset is still a violation, so refutation is sound at any size; the *absence* of one certifies something only if the check ran to completion. Hence three verdicts, used identically by both families:

- `refuted` — a counterexample exists. Trustworthy at any problem size.
- `proven` — the check ran to completion and found nothing. A real guarantee.
- `unrefuted` — the budget was hit. Nothing found among what was checked, which is **not** the same as the property holding.

Reporting `unrefuted` as "it holds" would be a lie, and the gap between "I found no bug" and "there is no bug" is the thing the feature exists to teach.

### `search_verify_heuristic`

Checks a heuristic against ground truth — computed by exhaustively exploring the reachable state space and running a multi-source backward Dijkstra from every goal state, so it works on N-Queens (many goals) and custom Python problems, not just mazes.

| property | meaning |
| --- | --- |
| `admissible` | `h(n) ≤ h*(n)` — never overestimates the true remaining cost |
| `consistent` | `h(n) ≤ c(n,n′) + h(n′)` on every edge — strictly stronger; what A\* actually needs |
| `goal_zero` | `h(goal) == 0` |

Under a truncated exploration the backward cost map is computed over a subgraph, so `dist_partial(n) ≥ dist_true(n)` — the asymmetry that makes refutation sound at any size. The counterexample is rendered on the board — the exact cell where the heuristic overestimates, and by how much — so a refutation is something you can look at, not just read.

### `sort_verify_comparator`

The same machinery, pointed at the other family — and if anything the more urgent of the two. A broken heuristic still lets A\* finish and you can see the path it took. A broken comparator makes a *correct* sorting algorithm return a wrong answer with no exception and no visible symptom: `is_sorted` even reports `true`, because sortedness here is judged by the problem's own comparator, so an inconsistent comparator is asked to grade itself and happily agrees. That circularity is why the check has to come from outside, against laws rather than against output. **If a sort result looks wrong and nothing was raised, verify the comparator before suspecting the algorithm.**

`comparator(a, b)` has to induce a strict weak ordering for "sorted" to mean anything. Five laws, checked by calling it on every pair and triple of the dataset's distinct values:

| property | meaning |
| --- | --- |
| `total` | returns a real number for every pair — no exception, no `None`, no `NaN` |
| `deterministic` | the same pair compares the same way twice |
| `antisymmetric` | `sign(cmp(a,b)) == -sign(cmp(b,a))`, which at `a == b` forces `cmp(a,a) == 0` |
| `transitive` | `a < b` and `b < c` ⟹ `a < c` — a cycle makes "sorted" undefined |
| `equivalence_transitive` | `a == b` and `b == c` ⟹ `a == c` |

The last one is the trap worth knowing: a tolerance comparator like `0 if abs(a - b) < 0.5` calls `1.0` and `1.4` equal, `1.4` and `1.8` equal, and `1.0` and `1.8` different. It is antisymmetric, transitive on strict inequality, and still not an ordering.

`proven` here is stronger than search's in one way and weaker in another, and the summary says both: a sort only ever compares elements of its own dataset, so a comparator proven over those values is genuinely enough to make sorting *this* dataset well-defined — but it says nothing about values not in it.

As on the search side, a refutation is something you can look at: the offending values are outlined on the bar canvas and labelled with the same `a`/`b`/`c` the verdict uses, so a three-way cycle reads off the bars directly.

## Architecture

- **Zero backend.** Static Vite + React + TypeScript app. Everything — including running real Python — happens in your browser tab.
- **Vendored, instrumented wheels.** `polysearch`/`polysort` ship in `public/wheels/`, built from the upstream repos and carrying an additive `on_step(event)` callback threaded through every algorithm (opt-in, `None` by default, zero behavior change when omitted) — that callback is what makes every step of a run animatable. Vendoring is the architecture rather than a stopgap: `micropip` resolves an install URL from inside Pyodide's virtual filesystem, so the wheel has to sit at an absolute same-origin URL, and serving it from `public/` is what lets a static app with no backend install a real Python package at runtime.
- **JSON-string bridge, not raw dicts.** Every event crossing from Python to JS is `json.dumps()`'d on the Python side and `JSON.parse()`'d on the JS side, deliberately avoiding Pyodide's PyProxy/dict-marshalling behavior, which turned out not to match its own documentation in the version this app uses. Values are sanitized on the way out (`pyodide/pySafeJson.ts`): Python emits bare `Infinity`/`NaN` tokens that JS's `JSON.parse` rejects outright, and `float('inf')` is the idiomatic way to write "unreachable" in a heuristic.
- **Two execution paths.** Built-in algorithms on built-in problems run on the main thread. Anything touching authored code — including a built-in algorithm on a custom problem, since it calls back into that problem's methods — runs in the worker behind a timeout.
- **Run once, replay client-side.** Algorithms run to completion once (they're fast — teaching-scale inputs, sub-second), capturing a full event trace; `playback_play`/`step`/`jump_to` then scrub through that trace with zero further Python calls, shared across the search and sort families.
- **Authored code persists locally.** Each editor's contents survive a reload via `localStorage`, with a "Reset to template" escape hatch. Storage is treated as optional — private windows make these calls throw, and the app works and simply forgets. A shared link still wins over whatever was saved in that slot, since someone arriving on one expects to see the code they were handed — but the draft it displaces is set aside rather than destroyed, and offered back above the editor until you restore or dismiss it. That notice survives reloads, so missing it on arrival doesn't cost you the work.

See `dev-notes/` for the incremental verification pages that de-risked this architecture before anything in `src/` was built on top of it.

## Running it locally

```
npm install
npm run dev
```

Open the URL it prints in Chrome with `chrome://flags/#enable-webmcp-testing` enabled, or in ChatGPT's in-app browser. Without either, the page says so and everything still works by hand — the manual controls drive the same live state the WebMCP tools do, so the app is exactly half of itself rather than broken.

It deploys as static files to Cloudflare Workers (`wrangler.jsonc` points at `dist/`, no Worker script — there is no server-side anything to run):

```
npm run deploy          # build, then publish dist/
```

`scripts/e2e-*.mjs` are Playwright-based smoke tests driving real Chrome, real WebMCP tool calls, and real Pyodide.

```
npm run e2e                     # every suite, ~45s
npm run e2e -- --only verify    # just the suites matching "verify"
npm run e2e -- --serial         # one at a time, for readable debugging
```

`npm run e2e` starts its own dev server and stops it afterwards. Suites run four at a time, which is safe because the app is entirely client-side — each suite drives its own browser with its own private copy of the state, and the only shared resource is a static file server. Output is buffered per suite so concurrency never interleaves two suites' lines, and a passing suite's chatter is suppressed.

Any suite can also be run alone against a server you already have:

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
| `e2e-verify-comparator-smoke` | comparator verification, all five laws and all three verdicts |
| `e2e-activity-log-smoke` | human and agent actions interleaved on one timeline |
| `e2e-state-discovery-smoke` | an agent seeing state a human created |
| `e2e-persistence-smoke` | reload survival, and storage being unavailable |
| `e2e-regression-smoke` | specific bugs found in audit, kept fixed |

## Roadmap

- **`polyevolve`** as a proper Python package — would complete a `polysearch` / `polysort` / `polyevolve` trilogy sharing one instrumentation convention. A JS-native genetic-algorithm family (Matter.js creatures) shipped and was then removed in `0f5adcd` precisely so it could come back this way; the working prototype is preserved at the `evolve-js-prototype` tag.
- **Click a log entry to restore that state** — every entry already names the `problem_id` and `trace_id` it touched, so the timeline could double as a session history you scrub rather than only read.

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
