import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/activityLog';
import { generateMaze } from '../search/mazeGenerator';
import { putProblem, putTrace, getProblem, newProblemId } from '../search/state';
import { runSearchAlgorithm, benchmarkCompareSearch, proposeHeuristic } from '../search/runAlgorithm';
import type { AuthoredProblem, SearchAlgorithm } from '../search/types';

const SEARCH_ALGORITHMS = [
  'a_star',
  'best_first',
  'branch_and_bound',
  'breadth_first',
  'depth_first',
  'hill_climbing',
  'iterative_deepening',
  'uniform_cost',
] as const;

export const searchTools: ToolDefinition<never>[] = [
  {
    name: 'search_author_maze',
    description:
      'Create a new maze pathfinding problem: a grid of open cells and walls, with a start and goal position. ' +
      'The maze is randomly generated but guaranteed solvable. Returns a problem_id to pass to search_run_algorithm.',
    inputSchema: {
      type: 'object',
      properties: {
        rows: { type: 'integer', minimum: 4, maximum: 30, description: 'Number of rows (4-30).' },
        cols: { type: 'integer', minimum: 4, maximum: 30, description: 'Number of columns (4-30).' },
        wall_density: { type: 'number', minimum: 0, maximum: 0.6, description: 'Fraction of non-path cells that are walls (0-0.6). Default 0.25.' },
        seed: { type: 'integer', description: 'Optional seed for reproducible generation.' },
        start: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: 'Optional [row, col] start. Defaults to [0, 0].' },
        goal: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: 'Optional [row, col] goal. Defaults to bottom-right corner.' },
      },
      required: ['rows', 'cols'],
    },
    execute: logged(
      'search_author_maze',
      async (args: { rows: number; cols: number; wall_density?: number; seed?: number; start?: [number, number]; goal?: [number, number] }) => {
        const generated = generateMaze({
          rows: args.rows,
          cols: args.cols,
          wallDensity: args.wall_density,
          seed: args.seed,
          start: args.start,
          goal: args.goal,
        });
        const problem: AuthoredProblem = {
          problem_id: newProblemId('maze'),
          type: 'maze',
          origin: 'agent',
          maze: generated.maze,
          start: generated.start,
          goal: generated.goal,
        };
        putProblem(problem);
        return JSON.stringify({
          problem_id: problem.problem_id,
          rows: generated.maze.length,
          cols: generated.maze[0].length,
          start: generated.start,
          goal: generated.goal,
          seed_used: generated.seedUsed,
        });
      }
    ),
  },
  {
    name: 'search_author_missionaries_and_cannibals',
    description:
      'Create the classic missionaries-and-cannibals problem (fixed at 3 missionaries, 3 cannibals — the library ' +
      'does not support other counts). Returns a problem_id to pass to search_run_algorithm.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: logged('search_author_missionaries_and_cannibals', async () => {
      const problem: AuthoredProblem = { problem_id: newProblemId('mc'), type: 'missionaries_and_cannibals', origin: 'agent' };
      putProblem(problem);
      return JSON.stringify({ problem_id: problem.problem_id });
    }),
  },
  {
    name: 'search_author_n_queens',
    description: 'Create an N-Queens problem: place N queens on an NxN board with no two attacking each other. Returns a problem_id.',
    inputSchema: {
      type: 'object',
      properties: { n: { type: 'integer', minimum: 4, maximum: 12, description: 'Board size / number of queens (4-12).' } },
      required: ['n'],
    },
    execute: logged('search_author_n_queens', async (args: { n: number }) => {
      const n = Math.max(4, Math.min(12, Math.floor(args.n)));
      const problem: AuthoredProblem = { problem_id: newProblemId('nqueens'), type: 'n_queens', origin: 'agent', n };
      putProblem(problem);
      return JSON.stringify({ problem_id: problem.problem_id, n });
    }),
  },
  {
    name: 'search_run_algorithm',
    description:
      'Run a search algorithm on a previously authored problem, producing a step-by-step trace you can then ' +
      'control with the playback_* tools (play/pause/step/jump_to). Returns a trace_id and a summary ' +
      '(path found, cost, inferences). For iterative_deepening, max_depth is always capped for safety even if you ask for more.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        algorithm: { type: 'string', enum: SEARCH_ALGORITHMS as unknown as string[] },
        heuristic: {
          type: 'string',
          enum: ['manhattan_distance', 'euclidean_distance', 'attacking_queen_pairs', 'trips'],
          description: 'Only used by a_star/best_first/hill_climbing. Ignored by other algorithms.',
        },
        random_restart: { type: 'boolean', description: 'hill_climbing only: restart from scratch on getting stuck.' },
        num_restarts: { type: 'integer', description: 'hill_climbing only, with random_restart. Default 10.' },
        max_depth: { type: 'integer', description: 'iterative_deepening only. Capped at 60 regardless of the value requested; default 40.' },
      },
      required: ['problem_id', 'algorithm'],
    },
    execute: logged(
      'search_run_algorithm',
      async (args: {
        problem_id: string;
        algorithm: SearchAlgorithm;
        heuristic?: string;
        random_restart?: boolean;
        num_restarts?: number;
        max_depth?: number;
      }) => {
        const problem = getProblem(args.problem_id);
        if (problem.type === 'python_problem') {
          return JSON.stringify({
            error: true,
            message: 'This problem was authored as Python code -- use search_run_algorithm_on_python_problem instead.',
          });
        }
        const trace = await runSearchAlgorithm(problem, args.algorithm, {
          heuristic: args.heuristic,
          random_restart: args.random_restart,
          num_restarts: args.num_restarts,
          max_depth: args.max_depth,
        });
        putTrace(trace);
        return JSON.stringify({
          trace_id: trace.trace_id,
          trace_length: trace.entries.length,
          summary: trace.summary,
        });
      }
    ),
  },
  {
    name: 'search_benchmark_compare',
    description:
      'Run multiple search algorithms on the same problem and compare their stats (path length, cost, inferences, time) side by side. Does not produce an animatable trace.',
    // Genuinely read-only: computes stats and returns them without touching
    // any store, unlike every other tool in this file.
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        algorithms: { type: 'array', items: { type: 'string', enum: SEARCH_ALGORITHMS as unknown as string[] }, minItems: 2 },
        heuristic: { type: 'string', enum: ['manhattan_distance', 'euclidean_distance', 'attacking_queen_pairs', 'trips'] },
      },
      required: ['problem_id', 'algorithms'],
    },
    execute: logged(
      'search_benchmark_compare',
      async (args: { problem_id: string; algorithms: SearchAlgorithm[]; heuristic?: string }) => {
        const problem = getProblem(args.problem_id);
        // Same guard search_run_algorithm already had. Without it a custom
        // problem reached buildProblemConstructionCode and came back as a bare
        // "Unknown problem type: python_problem" with no hint about what to do.
        if (problem.type === 'python_problem') {
          return JSON.stringify({
            error: true,
            message:
              'This problem was authored as Python code, which benchmarking does not support yet -- run one ' +
              'algorithm at a time with search_run_algorithm_on_python_problem.',
          });
        }
        const results = await benchmarkCompareSearch(problem, args.algorithms, args.heuristic);
        return JSON.stringify({ results });
      }
    ),
  },
  {
    name: 'search_propose_heuristic',
    description:
      'Propose a custom heuristic for A*/best-first search as a weighted combination of manhattan_distance and ' +
      'euclidean_distance (weights 0-3, not required to sum to 1), and empirically check whether it is admissible ' +
      '(never overestimates true remaining cost). Weights above 1 are likely to be inadmissible and will usually ' +
      'produce a concrete counterexample state. Maze problems only, and limited to those two weighted terms — ' +
      'this is the convenience form. To check an ARBITRARY heuristic you write yourself, against any problem type ' +
      'including custom ones, author it with search_author_python_heuristic and check it with ' +
      'search_verify_heuristic, which additionally tests consistency and tells you whether its verdict is proven ' +
      'or merely unrefuted. Also produces an animatable trace of the run.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string', description: 'Must be a maze-type problem.' },
        weights: {
          type: 'object',
          properties: {
            manhattan_distance: { type: 'number', minimum: 0, maximum: 3 },
            euclidean_distance: { type: 'number', minimum: 0, maximum: 3 },
          },
        },
        algorithm: { type: 'string', enum: ['a_star', 'best_first'], description: 'Default a_star.' },
      },
      required: ['problem_id', 'weights'],
    },
    execute: logged(
      'search_propose_heuristic',
      async (args: {
        problem_id: string;
        weights: { manhattan_distance?: number; euclidean_distance?: number };
        algorithm?: 'a_star' | 'best_first';
      }) => {
        const problem = getProblem(args.problem_id);
        const result = await proposeHeuristic(problem, args.weights, args.algorithm);
        putTrace({
          trace_id: result.trace_id,
          problem_id: problem.problem_id,
          algorithm: args.algorithm ?? 'a_star',
          entries: result.entries,
          // The run's own full summary, not a hand-built subset: the panel
          // reads path_length/inferences from here, and MazeCanvas paints
          // summary.path green at the end of playback.
          summary: result.run_summary,
          currentSeq: -1,
          playing: false,
          speed: 1,
        });
        // run_summary is dropped from the tool's own reply -- it repeats
        // path_found/cost and carries a full coordinate path this caller
        // already has better ways to ask for (playback_*, search_get_state).
        // inferences is the one genuinely new field, so it is lifted out.
        const { entries: _entries, run_summary, ...summary } = result;
        return JSON.stringify({ ...summary, inferences: run_summary.inferences ?? null });
      }
    ),
  },
];
