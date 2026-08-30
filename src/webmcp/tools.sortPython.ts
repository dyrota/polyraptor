import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/toolCallLog';
import { authorPythonSortProblem, runAlgorithmOnPythonSortProblem } from '../sort/runPythonProblem';
import { putProblem, putTrace, getProblem, newProblemId } from '../sort/state';
import type { SortAlgorithm } from '../sort/types';

const SORT_ALGORITHMS = [
  'bubble_sort',
  'selection_sort',
  'insertion_sort',
  'merge_sort',
  'quick_sort',
  'heap_sort',
  'counting_sort',
  'radix_sort',
  'shell_sort',
  'tim_sort',
] as const;

// `_python_` infix everywhere -- sort_author_custom already exists and means
// "a literal number list," not code. Every tool here makes "this runs real
// code" unmistakable in its own name.
export const sortPythonTools: ToolDefinition<never>[] = [
  {
    name: 'sort_author_python_problem',
    description:
      'Define a custom sort problem as real Python code, run entirely in your own browser tab (not a shared ' +
      'server). Your source must define a class named exactly `Problem` inheriting from ' +
      'polysort.interfaces.SortProblem, implementing data() and comparator(a, b). data() must return a list of ' +
      'numbers. Validated immediately (constructed and smoke-tested) -- returns a problem_id usable by ' +
      'sort_run_algorithm_on_python_problem. If validation fails, returns a friendly explanation of what to fix ' +
      '(missing method, syntax error, etc.) rather than a raw error.',
    inputSchema: {
      type: 'object',
      properties: {
        source_code: { type: 'string', description: 'Full Python source defining the `Problem` class.' },
      },
      required: ['source_code'],
    },
    execute: logged('sort_author_python_problem', async (args: { source_code: string }) => {
      const result = await authorPythonSortProblem(args.source_code);
      if (!result.valid) {
        return JSON.stringify({
          valid: false,
          kind: result.kind,
          friendly_error: result.friendly_error,
          raw_traceback: result.raw_traceback,
        });
      }
      const problemId = newProblemId('sort-py');
      putProblem({
        problem_id: problemId,
        dataset_type: 'python_problem',
        size: result.size!,
        values: result.values!,
        source_code: args.source_code,
      });
      return JSON.stringify({ problem_id: problemId, valid: true, size: result.size, values: result.values });
    }),
  },
  {
    name: 'sort_run_algorithm_on_python_problem',
    description:
      'Run a built-in sort algorithm against a problem_id that was authored with sort_author_python_problem. ' +
      'Runs in the same sandboxed worker as any custom code, since the algorithm calls back into your problem\'s ' +
      'own data()/comparator() methods -- a bug there is contained and reported the same way a bug in a full ' +
      'custom algorithm would be. Returns a trace_id usable by the playback_* tools.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string', description: 'Must be a problem_id from sort_author_python_problem.' },
        algorithm: { type: 'string', enum: SORT_ALGORITHMS as unknown as string[] },
      },
      required: ['problem_id', 'algorithm'],
    },
    execute: logged(
      'sort_run_algorithm_on_python_problem',
      async (args: { problem_id: string; algorithm: SortAlgorithm }) => {
        const problem = getProblem(args.problem_id);
        if (problem.dataset_type !== 'python_problem') {
          return JSON.stringify({
            ok: false,
            friendly_error: 'This problem was not authored as Python code -- use sort_run_algorithm instead.',
          });
        }
        const result = await runAlgorithmOnPythonSortProblem(problem, args.algorithm);
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
