import { runPythonWithOnStep } from '../pyodide/bridge';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import type { AuthoredProblem, RunSummary, SearchAlgorithm, SearchTrace } from './types';

// ---- Safe interpolation into generated Python source -----------------------
// Tool args arrive as `unknown` from the WebMCP boundary. Never interpolate a
// raw agent-supplied string into Python source; always validate/coerce first,
// or map through a fixed allowlist (algorithm/heuristic names below).

function pyNum(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error(`Expected a finite number, got: ${JSON.stringify(x)}`);
  return n;
}

function pyTuple2(a: unknown, b: unknown): string {
  return `(${pyNum(a)}, ${pyNum(b)})`;
}

function pyMazeLiteral(maze: number[][]): string {
  if (
    !Array.isArray(maze) ||
    maze.length === 0 ||
    !maze.every((row) => Array.isArray(row) && row.every((v) => v === 0 || v === 1))
  ) {
    throw new Error('Invalid maze grid: expected a non-empty array of arrays of 0/1.');
  }
  return JSON.stringify(maze); // valid Python list-of-lists literal syntax too
}

const ALGORITHM_MODULE: Record<SearchAlgorithm, string> = {
  a_star: 'a_star',
  best_first: 'best_first',
  branch_and_bound: 'branch_and_bound',
  breadth_first: 'breadth_first',
  depth_first: 'depth_first',
  hill_climbing: 'hill_climbing',
  iterative_deepening: 'iterative_deepening',
  uniform_cost: 'uniform_cost',
};

const ALGORITHM_FUNC: Record<SearchAlgorithm, string> = {
  a_star: 'a_star_search',
  best_first: 'best_first_search',
  branch_and_bound: 'branch_and_bound_search',
  breadth_first: 'breadth_first_search',
  depth_first: 'depth_first_search',
  hill_climbing: 'hill_climbing_search',
  iterative_deepening: 'iterative_deepening_search',
  uniform_cost: 'uniform_cost_search',
};

// Verified directly against source (not assumed): only these three algorithms
// accept a heuristic= kwarg. branch_and_bound/breadth_first/depth_first/
// uniform_cost do not.
const TAKES_HEURISTIC = new Set<SearchAlgorithm>(['a_star', 'best_first', 'hill_climbing']);

const HEURISTIC_METHOD: Record<string, string> = {
  manhattan_distance: 'manhattan_distance_heuristic',
  euclidean_distance: 'euclidean_distance_heuristic',
  attacking_queen_pairs: 'attacking_queen_pairs_heuristic',
  trips: 'trips_heuristic',
};

// iterative_deepening_search(problem, max_depth=None, ...) is genuinely
// unbounded when max_depth is None (confirmed by reading the source — a bare
// `while True: depth += 1` with recursion scaling with the reached depth).
// This app must NEVER pass max_depth=None through. Always a finite, small cap.
const DEFAULT_MAX_DEPTH = 40;
const MAX_ALLOWED_MAX_DEPTH = 60;

function buildProblemConstructionCode(problem: AuthoredProblem, varName: string): string {
  switch (problem.type) {
    case 'maze': {
      if (!problem.maze || !problem.start || !problem.goal) {
        throw new Error('Maze problem is missing maze/start/goal.');
      }
      return (
        `from polysearch.problems.maze import MazeProblem\n` +
        `${varName} = MazeProblem(${pyMazeLiteral(problem.maze)}, ${pyTuple2(
          problem.start[0],
          problem.start[1]
        )}, ${pyTuple2(problem.goal[0], problem.goal[1])})`
      );
    }
    case 'n_queens': {
      if (problem.n === undefined) throw new Error('N-Queens problem is missing n.');
      return (
        `from polysearch.problems.n_queens import NQueensProblem\n` +
        `${varName} = NQueensProblem(${pyNum(problem.n)})`
      );
    }
    case 'missionaries_and_cannibals': {
      return (
        `from polysearch.problems.missionaries_and_cannibals import MissionariesAndCannibalsProblem\n` +
        `${varName} = MissionariesAndCannibalsProblem()`
      );
    }
    default:
      throw new Error(`Unknown problem type: ${(problem as AuthoredProblem).type}`);
  }
}

// Shared, defensive summary builder — reused by every generated script.
// Handles three real inconsistencies found by reading all 8 algorithm files
// directly rather than assuming uniformity:
//  1. iterative_deepening_search returns bare `None` (not a 3-tuple) when no
//     solution is found within a finite max_depth.
//  2. uniform_cost_search's not-found branch returns a bare `None` as the
//     first tuple element, where every other algorithm uses {'path': None}.
//  3. branch_and_bound_search's cost stays `float('inf')` when no solution is
//     ever found, which `json.dumps` will emit as the non-standard `Infinity`
//     token — valid to Python's json module, but invalid JSON that would
//     break JS's strict `JSON.parse` on the other side of the bridge.
const PY_SUMMARY_HELPER = `
def _polyraptor_sanitize(v):
    if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
        return None
    return v

def _polyraptor_make_summary(result):
    if result is None:
        return {'path_found': False, 'path': None, 'path_length': None, 'cost': None, 'inferences': None, 'elapsed_ms': None}
    path_dict, visited_dict, stats_dict = result
    path = path_dict.get('path') if path_dict else None
    stats_dict = stats_dict or {}
    time_val = stats_dict.get('time')
    return {
        'path_found': path is not None,
        # Included so the client can highlight the solution path directly,
        # rather than reconstructing it by backtracking through generate
        # events. Tuples of ints (maze/n_queens/missionaries states) all
        # serialize fine through json.dumps -> JSON.parse.
        'path': path,
        'path_length': len(path) if path else None,
        'cost': _polyraptor_sanitize(stats_dict.get('cost')),
        'inferences': stats_dict.get('inferences'),
        'elapsed_ms': (time_val * 1000) if time_val is not None else None,
    }
`;

export interface RunOptions {
  heuristic?: string;
  random_restart?: boolean;
  num_restarts?: number;
  max_depth?: number;
}

export async function runSearchAlgorithm(
  problem: AuthoredProblem,
  algorithm: SearchAlgorithm,
  options: RunOptions = {}
): Promise<SearchTrace> {
  const collector = makeCollector();
  const traceId = newTraceId(`search-${algorithm}`);

  const problemCode = buildProblemConstructionCode(problem, 'problem');
  const func = ALGORITHM_FUNC[algorithm];
  const moduleName = ALGORITHM_MODULE[algorithm];

  const kwargs: string[] = ['statistics=True', 'on_step=_json_bridge'];

  if (TAKES_HEURISTIC.has(algorithm) && options.heuristic) {
    const method = HEURISTIC_METHOD[options.heuristic];
    if (!method) throw new Error(`Unknown heuristic: ${options.heuristic}`);
    kwargs.push('heuristic=_heuristic');
  }
  if (algorithm === 'hill_climbing') {
    if (options.random_restart) {
      kwargs.push('random_restart=True');
      const n = Math.max(1, Math.min(200, Math.floor(options.num_restarts ?? 10)));
      kwargs.push(`num_restarts=${n}`);
    }
  }
  if (algorithm === 'iterative_deepening') {
    const cap = Math.max(2, Math.min(MAX_ALLOWED_MAX_DEPTH, Math.floor(options.max_depth ?? DEFAULT_MAX_DEPTH)));
    kwargs.push(`max_depth=${cap}`);
  }

  const heuristicDef =
    TAKES_HEURISTIC.has(algorithm) && options.heuristic
      ? `def _heuristic(state):\n    return problem.${HEURISTIC_METHOD[options.heuristic]}(state)\n`
      : '';

  const codeTemplate = `
import json
from polysearch.algorithms.${moduleName} import ${func}
${problemCode}
${heuristicDef}
${PY_SUMMARY_HELPER}
def _json_bridge(event_dict):
    on_step_placeholder(json.dumps(event_dict))

_result = ${func}(problem, ${kwargs.join(', ')})
json.dumps(_polyraptor_make_summary(_result))
`; // on_step_placeholder swapped for the real per-call bridge global name below

  const jsonResult = (await runPythonWithOnStep(
    (onStepGlobalName) => codeTemplate.replace(/on_step_placeholder/g, onStepGlobalName),
    collector.collect
  )) as string;

  const summary: RunSummary = JSON.parse(jsonResult);

  return {
    trace_id: traceId,
    problem_id: problem.problem_id,
    algorithm,
    entries: collector.entries,
    summary,
    currentSeq: -1,
    playing: false,
    speed: 1,
  };
}

export interface BenchmarkResult {
  algorithm: SearchAlgorithm;
  summary: RunSummary;
}

export async function benchmarkCompareSearch(
  problem: AuthoredProblem,
  algorithms: SearchAlgorithm[],
  heuristic?: string
): Promise<BenchmarkResult[]> {
  const problemCode = buildProblemConstructionCode(problem, 'problem');
  const results: BenchmarkResult[] = [];

  // Run sequentially in one Python session so import/setup cost is paid once;
  // no on_step needed here, benchmark_compare only needs the final stats.
  const perAlgoBlocks = algorithms
    .map((algo, i) => {
      const func = ALGORITHM_FUNC[algo];
      const moduleName = ALGORITHM_MODULE[algo];
      const kwargs: string[] = ['statistics=True'];
      if (TAKES_HEURISTIC.has(algo) && heuristic) kwargs.push('heuristic=_heuristic');
      if (algo === 'iterative_deepening') kwargs.push(`max_depth=${DEFAULT_MAX_DEPTH}`);
      return `
from polysearch.algorithms.${moduleName} import ${func} as _algo_${i}
_r${i} = _algo_${i}(problem, ${kwargs.join(', ')})
_results.append(('${algo}', _polyraptor_make_summary(_r${i})))
`;
    })
    .join('\n');

  const heuristicDef =
    heuristic && algorithms.some((a) => TAKES_HEURISTIC.has(a))
      ? `def _heuristic(state):\n    return problem.${HEURISTIC_METHOD[heuristic]}(state)\n`
      : '';

  const code = `
import json
${problemCode}
${heuristicDef}
${PY_SUMMARY_HELPER}
_results = []
${perAlgoBlocks}
json.dumps(_results)
`;

  const jsonResult = (await runPythonWithOnStep(() => code, () => {})) as string;
  const raw: [SearchAlgorithm, RunSummary][] = JSON.parse(jsonResult);
  for (const [algorithm, summary] of raw) results.push({ algorithm, summary });
  return results;
}

export interface HeuristicWeights {
  manhattan_distance?: number;
  euclidean_distance?: number;
}

export interface ProposeHeuristicResult {
  trace_id: string;
  path_found: boolean;
  heuristic_cost: number | null;
  ucs_optimal_cost: number | null;
  admissible: boolean;
  num_counterexamples: number;
  counterexample: { state: number[]; heuristic_value: number; true_remaining_cost: number } | null;
  entries: SearchTrace['entries'];
}

// Verified logic, ported from the empirically-confirmed reference script
// (see plan doc's "propose_heuristic — empirically verified" section).
// Maze-only: the backward-BFS-from-goal trick for computing true remaining
// cost only works because MazeProblem's moves are exactly invertible with
// uniform cost 1 (undirected graph) — N-Queens/Missionaries don't have that
// structure (N-Queens has many valid goal states, not one to search
// backward from).
export async function proposeHeuristic(
  problem: AuthoredProblem,
  weights: HeuristicWeights,
  algorithm: 'a_star' | 'best_first' = 'a_star'
): Promise<ProposeHeuristicResult> {
  if (problem.type !== 'maze' || !problem.maze || !problem.start || !problem.goal) {
    throw new Error('propose_heuristic is scoped to maze problems only.');
  }

  const manhattanW = Math.max(0, Math.min(3, Number(weights.manhattan_distance ?? 0)));
  const euclideanW = Math.max(0, Math.min(3, Number(weights.euclidean_distance ?? 0)));
  const func = algorithm === 'best_first' ? 'best_first_search' : 'a_star_search';
  const moduleName = algorithm === 'best_first' ? 'best_first' : 'a_star';

  const collector = makeCollector();
  const traceId = newTraceId('propose-heuristic');

  const code = `
import json
from collections import deque
from polysearch.algorithms.${moduleName} import ${func}
from polysearch.algorithms.uniform_cost import uniform_cost_search
from polysearch.problems.maze import MazeProblem

maze = ${pyMazeLiteral(problem.maze)}
start = ${pyTuple2(problem.start[0], problem.start[1])}
goal = ${pyTuple2(problem.goal[0], problem.goal[1])}

def _weighted_heuristic(p):
    def h(state):
        return ${manhattanW} * p.manhattan_distance_heuristic(state) + ${euclideanW} * p.euclidean_distance_heuristic(state)
    return h

def _true_remaining_cost_map():
    reverse_problem = MazeProblem(maze, goal, start)
    ops = [reverse_problem.move_up, reverse_problem.move_down, reverse_problem.move_left, reverse_problem.move_right]
    dist = {goal: 0}
    q = deque([goal])
    while q:
        cur = q.popleft()
        for op in ops:
            nxt = op(cur)
            if nxt is not None and nxt not in dist:
                dist[nxt] = dist[cur] + 1
                q.append(nxt)
    return dist

problem = MazeProblem(maze, start, goal)
h = _weighted_heuristic(problem)

# Captured as a side effect of the SAME real run used for the trace/animation
# -- these are the states the algorithm actually expanded, not a separately
# invented traversal. Matches the verified reference script's logic exactly.
_expanded = []

def _json_bridge(event_dict):
    if event_dict.get('type') == 'expand':
        _expanded.append((event_dict['state'], event_dict.get('h')))
    on_step_placeholder(json.dumps(event_dict))

path = ${func}(problem, heuristic=h, on_step=_json_bridge)

true_cost = _true_remaining_cost_map()

counterexamples = []
for state, h_value in _expanded:
    key = tuple(state) if not isinstance(state, tuple) else state
    true_val = true_cost.get(key)
    if true_val is not None and h_value is not None and h_value > true_val + 1e-9:
        counterexamples.append({'state': list(key), 'heuristic_value': h_value, 'true_remaining_cost': true_val})

ucs_result = uniform_cost_search(MazeProblem(maze, start, goal), statistics=True)
ucs_stats = ucs_result[2] if ucs_result else {}
ucs_cost = ucs_stats.get('cost') if ucs_stats else None

heuristic_cost = None
if path:
    heuristic_cost = sum(problem.cost(path[i], path[i + 1]) for i in range(len(path) - 1))

summary = {
    'path_found': path is not None,
    'heuristic_cost': heuristic_cost,
    'ucs_optimal_cost': ucs_cost,
    'admissible': len(counterexamples) == 0,
    'num_counterexamples': len(counterexamples),
    'counterexample': counterexamples[0] if counterexamples else None,
}
json.dumps(summary)
`;

  const jsonResult = (await runPythonWithOnStep(
    (onStepGlobalName) => code.replace(/on_step_placeholder/g, onStepGlobalName),
    collector.collect
  )) as string;

  const parsed = JSON.parse(jsonResult);
  return { trace_id: traceId, entries: collector.entries, ...parsed };
}
