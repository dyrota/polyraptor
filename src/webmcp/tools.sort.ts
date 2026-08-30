import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/toolCallLog';
import { authorSortDataset, runSortAlgorithm, benchmarkCompareSort } from '../sort/runAlgorithm';
import { putProblem, putTrace, getProblem, newProblemId } from '../sort/state';
import type { SortAlgorithm, SortDatasetType } from '../sort/types';

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

export const sortTools: ToolDefinition<never>[] = [
  {
    name: 'sort_author_dataset',
    description:
      'Create a new sort problem from one of polysort\'s built-in dataset generators. Returns a problem_id to ' +
      'pass to sort_run_algorithm.',
    inputSchema: {
      type: 'object',
      properties: {
        dataset_type: {
          type: 'string',
          enum: ['random_integers', 'nearly_sorted', 'reverse_sorted', 'many_duplicates'],
        },
        size: { type: 'integer', minimum: 5, maximum: 300, description: 'Number of elements (5-300). Default 30.' },
        seed: { type: 'integer', description: 'Optional seed for reproducible generation.' },
        swaps: { type: 'integer', description: 'nearly_sorted only: how many random swaps to introduce. Default ~5% of size.' },
        distinct: { type: 'integer', description: 'many_duplicates only: how many distinct values. Default ~size/10.' },
      },
      required: ['dataset_type'],
    },
    execute: logged(
      'sort_author_dataset',
      async (args: { dataset_type: SortDatasetType; size?: number; seed?: number; swaps?: number; distinct?: number }) => {
        const { values } = await authorSortDataset(args);
        const problem = { problem_id: newProblemId('sort'), dataset_type: args.dataset_type, size: values.length, values };
        putProblem(problem);
        return JSON.stringify({ problem_id: problem.problem_id, size: problem.size, values: problem.values });
      }
    ),
  },
  {
    name: 'sort_author_custom',
    description: 'Create a sort problem from a literal list of numbers you supply. Returns a problem_id.',
    inputSchema: {
      type: 'object',
      properties: {
        values: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 300 },
      },
      required: ['values'],
    },
    execute: logged('sort_author_custom', async (args: { values: number[] }) => {
      const { values } = await authorSortDataset({ dataset_type: 'custom', values: args.values });
      const problem = { problem_id: newProblemId('sort'), dataset_type: 'custom' as const, size: values.length, values };
      putProblem(problem);
      return JSON.stringify({ problem_id: problem.problem_id, size: problem.size, values: problem.values });
    }),
  },
  {
    name: 'sort_run_algorithm',
    description:
      'Run a sort algorithm on a previously authored problem, producing a step-by-step trace you can control ' +
      'with the playback_* tools (play/pause/step/jump_to). Returns a trace_id and a summary (comparisons, swaps, is_sorted).',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        algorithm: { type: 'string', enum: SORT_ALGORITHMS as unknown as string[] },
      },
      required: ['problem_id', 'algorithm'],
    },
    execute: logged('sort_run_algorithm', async (args: { problem_id: string; algorithm: SortAlgorithm }) => {
      const problem = getProblem(args.problem_id);
      const trace = await runSortAlgorithm(problem, args.algorithm);
      putTrace(trace);
      return JSON.stringify({ trace_id: trace.trace_id, trace_length: trace.entries.length, summary: trace.summary });
    }),
  },
  {
    name: 'sort_benchmark_compare',
    description:
      'Run multiple sort algorithms on the same problem and compare comparisons/swaps/time side by side. Does not produce an animatable trace.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        algorithms: { type: 'array', items: { type: 'string', enum: SORT_ALGORITHMS as unknown as string[] }, minItems: 2 },
      },
      required: ['problem_id', 'algorithms'],
    },
    execute: logged('sort_benchmark_compare', async (args: { problem_id: string; algorithms: SortAlgorithm[] }) => {
      const problem = getProblem(args.problem_id);
      const results = await benchmarkCompareSort(problem, args.algorithms);
      return JSON.stringify({ results });
    }),
  },
];
