import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/activityLog';
import { authorPythonSearchProblem, runAlgorithmOnPythonSearchProblem } from '../search/runPythonProblem';
import { authorPythonSearchAlgorithm, runPythonAlgorithmOnProblem } from '../search/runPythonAlgorithm';
import { authorPythonSearchHeuristic, runPythonHeuristicOnProblem } from '../search/runPythonHeuristic';
import { verifyHeuristic, summarizeVerdict } from '../search/verifyHeuristic';
import { setVerification } from '../search/state';
import { putProblem, putTrace, getProblem, newProblemId, putAlgorithm, getAlgorithm, newAlgorithmId } from '../search/state';
import type { SearchAlgorithm } from '../search/types';

const HEURISTIC_ALGORITHMS = ['a_star', 'best_first', 'hill_climbing'] as const;

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

// `_python_` infix everywhere, mirroring sortPythonTools -- every new tool
// makes "this runs real code" unmistakable in its own name.
export const searchPythonTools: ToolDefinition<never>[] = [
  {
    name: 'search_author_python_problem',
    description:
      'Define a custom search problem as real Python code, run entirely in your own browser tab (not a shared ' +
      'server). Your source must define a class named exactly `Problem` inheriting from ' +
      'polysearch.interfaces.StateSpaceProblem, implementing initial_state(), goal_check(state), operators(), ' +
      'apply_operator(operator, state), and cost(state1, state2). Validated immediately (constructed and ' +
      'smoke-tested) -- returns a problem_id usable by search_run_algorithm_on_python_problem. If validation ' +
      'fails, returns a friendly explanation of what to fix (missing method, syntax error, etc.) rather than a ' +
      'raw error. search_run_algorithm_on_python_problem runs it with no heuristic (h=0); to guide ' +
      'a_star/best_first/hill_climbing against it, author one with search_author_python_heuristic and run it ' +
      'with search_run_python_heuristic.',
    inputSchema: {
      type: 'object',
      properties: {
        source_code: { type: 'string', description: 'Full Python source defining the `Problem` class.' },
      },
      required: ['source_code'],
    },
    execute: logged('search_author_python_problem', async (args: { source_code: string }) => {
      const result = await authorPythonSearchProblem(args.source_code);
      if (!result.valid) {
        return JSON.stringify({
          valid: false,
          kind: result.kind,
          friendly_error: result.friendly_error,
          raw_traceback: result.raw_traceback,
        });
      }
      const problemId = newProblemId('search-py');
      putProblem({
        problem_id: problemId,
        type: 'python_problem',
        source_code: args.source_code,
        preview: {
          initial_state: result.initial_state,
          operator_count: result.operator_count,
          goal_check_on_initial: result.goal_check_on_initial,
        },
      });
      return JSON.stringify({
        problem_id: problemId,
        valid: true,
        initial_state: result.initial_state,
        operator_count: result.operator_count,
        goal_check_on_initial: result.goal_check_on_initial,
      });
    }),
  },
  {
    name: 'search_run_algorithm_on_python_problem',
    description:
      'Run a built-in search algorithm against a problem_id that was authored with search_author_python_problem. ' +
      'Runs in the same sandboxed worker as any custom code, since the algorithm calls back into your problem\'s ' +
      'own methods -- a bug there is contained and reported the same way a bug in a full custom algorithm would ' +
      'be. Returns a trace_id usable by the playback_* tools. No heuristic is applied here (h=0) — to run one of ' +
      'the heuristic-guided algorithms with a real heuristic against this problem, use ' +
      'search_author_python_heuristic + search_run_python_heuristic instead.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string', description: 'Must be a problem_id from search_author_python_problem.' },
        algorithm: { type: 'string', enum: SEARCH_ALGORITHMS as unknown as string[] },
      },
      required: ['problem_id', 'algorithm'],
    },
    execute: logged(
      'search_run_algorithm_on_python_problem',
      async (args: { problem_id: string; algorithm: SearchAlgorithm }) => {
        const problem = getProblem(args.problem_id);
        if (problem.type !== 'python_problem') {
          return JSON.stringify({
            ok: false,
            friendly_error: 'This problem was not authored as Python code -- use search_run_algorithm instead.',
          });
        }
        const result = await runAlgorithmOnPythonSearchProblem(problem, args.algorithm);
        if (!result.ok) {
          return JSON.stringify({
            ok: false,
            kind: result.kind,
            friendly_error: result.friendly_error,
            raw_traceback: result.raw_traceback,
          });
        }
        putTrace(result.trace!);
        return JSON.stringify({
          ok: true,
          trace_id: result.trace!.trace_id,
          trace_length: result.trace!.entries.length,
          summary: result.trace!.summary,
        });
      }
    ),
  },
  {
    name: 'search_author_python_algorithm',
    description:
      'Define a custom search algorithm as real Python code. Your source must define a function named exactly ' +
      '`algorithm(problem, on_step=None)` -- `problem` will satisfy the StateSpaceProblem contract (built-in or ' +
      'a custom one you authored). Call on_step(dict) if you accept it, with a "type" key, to drive the ' +
      'visualizer -- recommended: expand/generate/reject/goal, matching the built-in algorithms\' vocabulary, for ' +
      'the richest visualization; unrecognized event shapes still animate via a generic fallback log. Validated ' +
      'immediately by signature only (never called yet, since there is no problem bound at author time) -- ' +
      'returns an algorithm_id usable by search_run_python_algorithm.',
    inputSchema: {
      type: 'object',
      properties: {
        source_code: { type: 'string', description: 'Full Python source defining the `algorithm` function.' },
      },
      required: ['source_code'],
    },
    execute: logged('search_author_python_algorithm', async (args: { source_code: string }) => {
      const result = await authorPythonSearchAlgorithm(args.source_code);
      if (!result.valid) {
        return JSON.stringify({
          valid: false,
          kind: result.kind,
          friendly_error: result.friendly_error,
          raw_traceback: result.raw_traceback,
        });
      }
      const algorithmId = newAlgorithmId('search-algo-py');
      putAlgorithm(algorithmId, args.source_code);
      return JSON.stringify({ algorithm_id: algorithmId, valid: true, accepts_on_step: result.accepts_on_step });
    }),
  },
  {
    name: 'search_run_python_algorithm',
    description:
      'Run a custom algorithm (from search_author_python_algorithm) against any problem_id -- built-in or ' +
      'custom, resolved transparently. Since a student\'s algorithm has no obligation to match the built-in ' +
      'algorithms\' return convention, the summary is looser than search_run_algorithm\'s: raw_return_value (the ' +
      'algorithm\'s actual return value) and event_type_counts (a tally of on_step event types, useful to ' +
      'narrate even when raw_return_value is not directly interpretable). Returns a trace_id usable by the ' +
      'playback_* tools. A run that crashes partway through still returns whatever partial trace was captured.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        algorithm_id: { type: 'string', description: 'From search_author_python_algorithm.' },
      },
      required: ['problem_id', 'algorithm_id'],
    },
    execute: logged(
      'search_run_python_algorithm',
      async (args: { problem_id: string; algorithm_id: string }) => {
        const problem = getProblem(args.problem_id);
        const algorithm = getAlgorithm(args.algorithm_id);
        const result = await runPythonAlgorithmOnProblem(problem, algorithm.source_code);
        if (!result.ok) {
          return JSON.stringify({
            ok: false,
            kind: result.kind,
            friendly_error: result.friendly_error,
            raw_traceback: result.raw_traceback,
            trace_id: result.trace?.trace_id,
            trace_length: result.trace?.entries.length,
          });
        }
        putTrace(result.trace!);
        return JSON.stringify({
          ok: true,
          trace_id: result.trace!.trace_id,
          trace_length: result.trace!.entries.length,
          summary: result.trace!.summary,
        });
      }
    ),
  },
  {
    name: 'search_author_python_heuristic',
    description:
      'Define a custom heuristic as real Python code -- the narrowest, lowest-risk custom-code slot in this ' +
      'app, since only a single pure function is untrusted, called from inside a fully trusted a_star/' +
      'best_first/hill_climbing loop. Your source must define a function named exactly `heuristic(state)` ' +
      'returning a number. Validated against problem_id\'s actual initial_state (built-in or custom problem) -- ' +
      'returns a heuristic_id usable by search_run_python_heuristic.',
    inputSchema: {
      type: 'object',
      properties: {
        source_code: { type: 'string', description: 'Full Python source defining the `heuristic` function.' },
        problem_id: { type: 'string', description: 'Problem to validate the heuristic against.' },
      },
      required: ['source_code', 'problem_id'],
    },
    execute: logged(
      'search_author_python_heuristic',
      async (args: { source_code: string; problem_id: string }) => {
        const problem = getProblem(args.problem_id);
        const result = await authorPythonSearchHeuristic(args.source_code, problem);
        if (!result.valid) {
          return JSON.stringify({
            valid: false,
            kind: result.kind,
            friendly_error: result.friendly_error,
            raw_traceback: result.raw_traceback,
          });
        }
        const heuristicId = newAlgorithmId('search-heuristic-py');
        putAlgorithm(heuristicId, args.source_code);
        return JSON.stringify({ heuristic_id: heuristicId, valid: true, sample_value: result.sample_value });
      }
    ),
  },
  {
    name: 'search_verify_heuristic',
    description:
      'Empirically check whether an authored heuristic (from search_author_python_heuristic) is admissible and ' +
      'consistent for a problem — by exhaustively computing the true remaining cost of every reachable state and ' +
      'comparing, not by trusting a claim about it. Works on any problem_id, built-in or Python-authored. ' +
      'Checks three properties, each returning a concrete counterexample rather than a boolean: admissible ' +
      '(h(n) never exceeds the true remaining cost h*(n)), consistent (h(n) <= cost(n,n\') + h(n\') on every ' +
      'edge — strictly stronger, and what A* actually needs to avoid re-expanding states), and goal_zero ' +
      '(h(goal) == 0). ' +
      'READ THE VERDICT, NOT JUST THE BOOLEANS. verdict is one of: "refuted" — a counterexample was found, which ' +
      'is trustworthy at any problem size; "proven" — the whole reachable state space was explored and nothing ' +
      'was found, a real guarantee; "unrefuted" — the state space exceeded the exploration budget, so nothing ' +
      'was found among the states checked but the heuristic is NOT proven admissible. Do not report "unrefuted" ' +
      'as admissible. ' +
      'When refuted, the counterexample names the exact state and the size of the error, which is enough to ' +
      'revise the heuristic and call this again. The verdict and counterexample also appear on the page the ' +
      'user is looking at, with the offending state highlighted on the board.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        heuristic_id: { type: 'string', description: 'From search_author_python_heuristic.' },
        state_budget: {
          type: 'integer',
          description:
            'Maximum states to explore before giving up on exhaustive ground truth (default 20000). Raising it ' +
            'can turn an "unrefuted" verdict into "proven" on a large problem, at the cost of a longer run.',
        },
      },
      required: ['problem_id', 'heuristic_id'],
    },
    execute: logged(
      'search_verify_heuristic',
      async (args: { problem_id: string; heuristic_id: string; state_budget?: number }) => {
        const problem = getProblem(args.problem_id);
        const heuristic = getAlgorithm(args.heuristic_id);
        const result = await verifyHeuristic(problem, heuristic.source_code, args.state_budget);
        if (!result.ok) {
          return JSON.stringify({
            ok: false,
            kind: result.kind,
            friendly_error: result.friendly_error,
            raw_traceback: result.raw_traceback,
          });
        }
        const report = result.report!;
        setVerification({
          problem_id: problem.problem_id,
          heuristic_id: args.heuristic_id,
          source_code: heuristic.source_code,
          report,
          at: Date.now(),
        });
        return JSON.stringify({ ok: true, summary: summarizeVerdict(report), ...report });
      }
    ),
  },
  {
    name: 'search_run_python_heuristic',
    description:
      'Run a_star/best_first/hill_climbing with a custom heuristic (from search_author_python_heuristic) ' +
      'against any problem_id -- built-in or custom. Since only the heuristic is untrusted and the algorithm ' +
      'loop is fully known, the summary is the same full, rich shape as search_run_algorithm (path_found, cost, ' +
      'inferences, etc.), unlike search_run_python_algorithm\'s looser shape. Returns a trace_id usable by the ' +
      'playback_* tools.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        heuristic_id: { type: 'string', description: 'From search_author_python_heuristic.' },
        algorithm: { type: 'string', enum: HEURISTIC_ALGORITHMS as unknown as string[], description: 'Default a_star.' },
      },
      required: ['problem_id', 'heuristic_id'],
    },
    execute: logged(
      'search_run_python_heuristic',
      async (args: { problem_id: string; heuristic_id: string; algorithm?: 'a_star' | 'best_first' | 'hill_climbing' }) => {
        const problem = getProblem(args.problem_id);
        const heuristic = getAlgorithm(args.heuristic_id);
        const result = await runPythonHeuristicOnProblem(problem, heuristic.source_code, args.algorithm ?? 'a_star');
        if (!result.ok) {
          return JSON.stringify({
            ok: false,
            kind: result.kind,
            friendly_error: result.friendly_error,
            raw_traceback: result.raw_traceback,
          });
        }
        putTrace(result.trace!);
        return JSON.stringify({
          ok: true,
          trace_id: result.trace!.trace_id,
          trace_length: result.trace!.entries.length,
          summary: result.trace!.summary,
        });
      }
    ),
  },
];
