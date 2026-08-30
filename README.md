# polyraptor

**Algorithms you can watch — and that an agent can drive, live, on the exact page you're looking at.**

Built for [OpenAI's WebMCP Challenge](https://openai.com/webmcp-challenge/). polyraptor runs real search, sort, and evolution algorithms live in your browser and exposes them as [WebMCP](https://github.com/webmachinelearning/webmcp) tools, so an AI agent (ChatGPT, or anything else that speaks WebMCP) can author problems, run algorithms, and scrub through the results — while you watch, or drive it yourself with the exact same buttons the agent uses.

## Why this needs to be WebMCP, not just an MCP server

A regular MCP server hitting a REST API could expose "run this algorithm" as a tool. It couldn't do what this app actually does:

- **The agent's tool calls mutate the same live page you're looking at.** There's no polling, no separate view to refresh — when the agent calls `search_run_algorithm`, the maze on your screen updates immediately, because the tool *is* a function running in this tab.
- **The algorithms genuinely execute.** Search and sort run real Python — [`polysearch`](https://github.com/dyrota/polysearch) and [`polysort`](https://github.com/dyrota/polysort), two libraries with their own test suites — compiled to WebAssembly via [Pyodide](https://pyodide.org) and running entirely client-side. No backend, no server executing anyone's code.
- **A human and an agent can touch the same state at the same time.** Every panel has manual buttons (New Maze, Run, Advance Generation) wired to the *identical* store the WebMCP tools read and write. A human can be mid-interaction while an agent calls a tool, and both see the same result immediately — that's the actual thesis of the project, not a demo trick.

## Three families

- **Search** — 8 algorithms (A\*, Best-First, Branch & Bound, BFS, DFS, Hill Climbing, Iterative Deepening, UCS) on maze, N-Queens, and missionaries-and-cannibals problems. The standout tool is `search_propose_heuristic`: an agent proposes a weighted heuristic, and the tool empirically checks whether it's admissible — not by trusting the agent's claim, but by comparing against a computed ground-truth optimal cost and returning a concrete counterexample state if the heuristic overestimates.
- **Sort** — all 10 algorithms in `polysort` (bubble, selection, insertion, merge, quick, heap, counting, radix, shell, tim), animated bar-by-bar as they run, with cross-algorithm benchmarking on identical input.
- **Evolve** — a genetic algorithm evolving simple physics-based creatures (Matter.js) to move further each generation. JS-native — no Pyodide involved here, since there's no round-trip latency to design around in the first place.

## Architecture

- **Zero backend.** Static Vite + React + TypeScript app. Everything — including running real Python — happens in your browser tab.
- **Vendored, instrumented wheels.** `polysearch`/`polysort` ship in `public/wheels/` as locally-built wheels with an additive `on_step(event)` callback threaded through every algorithm (opt-in, `None` by default, zero behavior change when omitted) — that callback is what makes every step of a run animatable.
- **JSON-string bridge, not raw dicts.** Every event crossing from Python to JS is `json.dumps()`'d on the Python side and `JSON.parse()`'d on the JS side, deliberately avoiding Pyodide's PyProxy/dict-marshalling behavior, which turned out not to match its own documentation in the version this app uses.
- **Run once, replay client-side.** Algorithms run to completion once (they're fast — teaching-scale inputs, sub-second), capturing a full event trace; `playback_play`/`step`/`jump_to` then scrub through that trace with zero further Python calls, shared across the search and sort families.

See `dev-notes/` for the incremental verification pages that de-risked this architecture before anything in `src/` was built on top of it.

## Running it locally

```
npm install
npm run dev
```

Open the URL it prints in Chrome with `chrome://flags/#enable-webmcp-testing` enabled, or in ChatGPT's in-app browser. `scripts/e2e-*.mjs` are Playwright-based smoke tests covering all three families end to end, including real WebMCP tool calls — run any of them with `node scripts/e2e-smoke.mjs` (search), `e2e-sort-smoke.mjs`, or `e2e-evolve-smoke.mjs`.

## Roadmap

- **`polyevolve`** as a proper Python package (currently the evolve family is JS-native by deliberate scope decision for this challenge) — would complete a `polysearch` / `polysort` / `polyevolve` trilogy sharing one instrumentation convention.
- **User/agent-authored problems and algorithms** — letting someone define their own `StateSpaceProblem`/`SortProblem` or algorithm rather than picking from the built-ins. A real code-execution trust boundary worth designing deliberately rather than bolting on; see the plan notes for the shape this should probably take.

## License

MIT — see `LICENSE`.
