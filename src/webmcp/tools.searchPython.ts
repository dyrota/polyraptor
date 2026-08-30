import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/toolCallLog';
import { authorPythonSearchProblem, runAlgorithmOnPythonSearchProblem } from '../search/runPythonProblem';
import { putProblem, putTrace, getProblem, newProblemId } from '../search/state';
import type { SearchAlgorithm } from '../search/types';

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
      'raw error. Heuristic-guided algorithms (a_star/best_first/hill_climbing) fall back to no heuristic (h=0) ' +
      'against a custom problem, since custom heuristics are a separate, not-yet-available tool.',
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
      'be. Returns a trace_id usable by the playback_* tools. No heuristic is applied (h=0) since custom ' +
      'heuristics against custom problems are not yet available.',
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
];
