import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/activityLog';
import { authorPythonSortProblem, runAlgorithmOnPythonSortProblem } from '../sort/runPythonProblem';
import { authorPythonSortAlgorithm, runPythonAlgorithmOnProblem } from '../sort/runPythonAlgorithm';
import { authorPythonSortComparator } from '../sort/runPythonComparator';
import { verifyComparator, summarizeComparatorVerdict } from '../sort/verifyComparator';
import { setVerification } from '../sort/state';
import { putProblem, putTrace, getProblem, newProblemId, putAlgorithm, getAlgorithm, newAlgorithmId } from '../sort/state';
import { SORT_ALGORITHMS } from '../sort/types';
import type { SortAlgorithm } from '../sort/types';

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
        origin: 'agent',
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
  {
    name: 'sort_author_python_algorithm',
    description:
      'Define a custom sort algorithm as real Python code. Your source must define a function named exactly ' +
      '`algorithm(problem, on_step=None)` -- `problem` will satisfy the SortProblem contract (built-in or a ' +
      'custom one you authored). Call on_step(dict) if you accept it, with a "type" key, to drive the ' +
      'visualizer -- recommended: compare/swap/write/mark matching the built-in algorithms\' vocabulary. ' +
      'Validated immediately by signature only (never called yet, since there is no problem bound at author ' +
      'time) -- returns an algorithm_id usable by sort_run_python_algorithm.',
    inputSchema: {
      type: 'object',
      properties: {
        source_code: { type: 'string', description: 'Full Python source defining the `algorithm` function.' },
      },
      required: ['source_code'],
    },
    execute: logged('sort_author_python_algorithm', async (args: { source_code: string }) => {
      const result = await authorPythonSortAlgorithm(args.source_code);
      if (!result.valid) {
        return JSON.stringify({
          valid: false,
          kind: result.kind,
          friendly_error: result.friendly_error,
          raw_traceback: result.raw_traceback,
        });
      }
      const algorithmId = newAlgorithmId('sort-algo-py');
      putAlgorithm(algorithmId, args.source_code);
      return JSON.stringify({ algorithm_id: algorithmId, valid: true, accepts_on_step: result.accepts_on_step });
    }),
  },
  {
    name: 'sort_run_python_algorithm',
    description:
      'Run a custom algorithm (from sort_author_python_algorithm) against any problem_id -- built-in or custom, ' +
      'resolved transparently. Since a student\'s algorithm has no obligation to match the built-in algorithms\' ' +
      'return convention, the summary is looser than sort_run_algorithm\'s: raw_return_value and ' +
      'event_type_counts (a tally of on_step event types). Returns a trace_id usable by the playback_* tools. A ' +
      'run that crashes partway through still returns whatever partial trace was captured.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        algorithm_id: { type: 'string', description: 'From sort_author_python_algorithm.' },
      },
      required: ['problem_id', 'algorithm_id'],
    },
    execute: logged(
      'sort_run_python_algorithm',
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
    name: 'sort_author_python_comparator',
    description:
      'Lower-risk on-ramp to custom sort code: supply a literal list of numbers plus only a comparator(a, b) ' +
      'function (not a full Problem class) -- good for a "write just the comparison logic" assignment. Returns ' +
      'a problem_id usable by sort_run_algorithm_on_python_problem exactly like a full ' +
      'sort_author_python_problem result -- there is no separate run tool for this, it flows through the same ' +
      'path as any other custom problem.',
    inputSchema: {
      type: 'object',
      properties: {
        values: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 300 },
        source_code: { type: 'string', description: 'Full Python source defining the `comparator` function.' },
      },
      required: ['values', 'source_code'],
    },
    execute: logged(
      'sort_author_python_comparator',
      async (args: { values: number[]; source_code: string }) => {
        const result = await authorPythonSortComparator(args.values, args.source_code);
        if (!result.valid) {
          return JSON.stringify({
            valid: false,
            kind: result.kind,
            friendly_error: result.friendly_error,
            raw_traceback: result.raw_traceback,
          });
        }
        const problemId = newProblemId('sort-cmp-py');
        putProblem({
          problem_id: problemId,
          dataset_type: 'python_problem',
          origin: 'agent',
          size: result.size!,
          values: result.values!,
          source_code: result.synthetic_source!,
        });
        return JSON.stringify({ problem_id: problemId, valid: true, size: result.size, values: result.values });
      }
    ),
  },
  {
    name: 'sort_verify_comparator',
    description:
      "Empirically check whether a problem's comparator is a valid ordering at all — by actually calling it on " +
      'every pair and triple of the dataset\'s distinct values and testing the laws a sort depends on, not by ' +
      'trusting a claim about it. Works on any problem_id: a built-in dataset, a sort_author_python_problem, or ' +
      'a sort_author_python_comparator. ' +
      'WHY THIS MATTERS MORE THAN IT SOUNDS. A broken comparator does not raise — a correct sorting algorithm ' +
      'given one returns a wrong answer silently, and sort_run_algorithm still reports is_sorted: true, because ' +
      "sortedness is judged by the problem's own comparator and an inconsistent comparator is being asked to " +
      'grade itself. If a sort result looks wrong and no error was raised, verify the comparator before ' +
      'suspecting the algorithm. ' +
      'Five laws, each returning a concrete counterexample rather than a boolean: total (returns a real number ' +
      'for every pair — no exception, no None, no NaN), deterministic (the same pair compares the same way ' +
      'twice), antisymmetric (sign(cmp(a,b)) == -sign(cmp(b,a)), which at a == b forces cmp(a,a) == 0), ' +
      'transitive (a < b and b < c implies a < c), and equivalence_transitive (a == b and b == c implies ' +
      'a == c — the law that tolerance comparators like abs(a-b) < eps break). ' +
      'READ THE VERDICT, NOT JUST THE BOOLEANS. verdict is one of: "refuted" — a counterexample was found, ' +
      'trustworthy at any size; "proven" — every distinct value in the dataset was covered and nothing was ' +
      'found, which means sorting THIS dataset is well-defined (it does NOT mean the comparator is correct for ' +
      'values outside it); "unrefuted" — the dataset had more distinct values than value_budget, so the rest ' +
      'went unchecked and nothing is proven. Do not report "unrefuted" as valid. ' +
      'The verdict and counterexample also appear on the page the user is looking at.',
    inputSchema: {
      type: 'object',
      properties: {
        problem_id: { type: 'string' },
        value_budget: {
          type: 'integer',
          description:
            'Maximum distinct values to check (default 60, max 300 -- the same ceiling as sort_author_dataset\'s ' +
            'size, so any dataset this app can create can be checked in full). The triple sweep is cubic in this, so ' +
            'raising it can turn an "unrefuted" verdict into "proven" at the cost of a much longer run.',
        },
      },
      required: ['problem_id'],
    },
    execute: logged('sort_verify_comparator', async (args: { problem_id: string; value_budget?: number }) => {
      const problem = getProblem(args.problem_id);
      const result = await verifyComparator(problem, args.value_budget);
      if (!result.ok) {
        return JSON.stringify({
          ok: false,
          kind: result.kind,
          friendly_error: result.friendly_error,
          raw_traceback: result.raw_traceback,
        });
      }
      const report = result.report!;
      setVerification({ problem_id: problem.problem_id, report, at: Date.now() });
      return JSON.stringify({ ok: true, summary: summarizeComparatorVerdict(report), ...report });
    }),
  },
];
