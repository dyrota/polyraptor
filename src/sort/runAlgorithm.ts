import { runPythonWithOnStep } from '../pyodide/bridge';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import type { AuthoredSortProblem, SortAlgorithm, SortRunSummary, SortTrace, SortDatasetType } from './types';

// ---- Safe interpolation into generated Python source -----------------------
// Same discipline as search/runAlgorithm.ts: every value that reaches the
// generated Python source is either numerically validated or looked up
// through a fixed allowlist — never an agent-supplied raw string.

export function pyInt(x: unknown, min: number, max: number): number {
  const n = Math.floor(Number(x));
  if (!Number.isFinite(n)) throw new Error(`Expected a finite number, got: ${JSON.stringify(x)}`);
  return Math.max(min, Math.min(max, n));
}

// Numbers are preserved as given, not truncated. This used to Math.trunc()
// every value, so a tool call or comparator box saying [3.7, 1.2] silently
// became [3, 1] -- while both the schema and the UI label said "numbers".
// Floats are safe here: 8 of polysort's 10 algorithms are comparison-based and
// handle them, and the two that don't (counting_sort/radix_sort, integer-only
// by nature) raise their own explicit TypeError, which the friendly-error path
// already turns into a readable message. A wrong answer quietly is worse than
// a clear error loudly.
export function pyIntListLiteral(values: unknown): string {
  if (!Array.isArray(values) || values.length === 0 || !values.every((v) => Number.isFinite(Number(v)))) {
    throw new Error('Invalid values: expected a non-empty array of numbers.');
  }
  const nums = values.map((v) => Number(v));
  return JSON.stringify(nums); // valid Python list literal syntax too
}

export const ALGORITHM_MODULE: Record<SortAlgorithm, string> = {
  bubble_sort: 'bubble_sort',
  selection_sort: 'selection_sort',
  insertion_sort: 'insertion_sort',
  merge_sort: 'merge_sort',
  quick_sort: 'quick_sort',
  heap_sort: 'heap_sort',
  counting_sort: 'counting_sort',
  radix_sort: 'radix_sort',
  shell_sort: 'shell_sort',
  tim_sort: 'tim_sort',
};

// All 10 functions are named identically to their module (verified directly
// against source, not assumed — unlike search where function names differ
// from module names, e.g. a_star.py -> a_star_search).
export function algorithmFunctionName(algorithm: SortAlgorithm): string {
  return algorithm;
}

// Verified directly against source: all 10 algorithms uniformly return
// (data, {comparisons, swaps, time}) when statistics=True — no None-shape or
// inf-cost inconsistencies like search had. Simpler defensive helper needed.
export const PY_SORT_SUMMARY_HELPER = `
def _polyraptor_sort_summary(problem, data, stats):
    # Sortedness must be judged by the problem's OWN comparator, not a
    # hardcoded ascending "<=" -- a custom comparator (tier 1's Problem class
    # or tier 3's bare comparator function) may legitimately define a
    # different order (e.g. descending), and correctly-sorted-by-that-order
    # output must not be flagged as buggy.
    is_sorted = all(problem.comparator(data[i], data[i + 1]) <= 0 for i in range(len(data) - 1))
    return {
        'comparisons': stats.get('comparisons', 0),
        'swaps': stats.get('swaps', 0),
        'elapsed_ms': (stats.get('time', 0) or 0) * 1000,
        'is_sorted': is_sorted,
        'final_values': data,
    }
`;

export function buildDatasetConstructionCode(
  problem: Omit<AuthoredSortProblem, 'problem_id' | 'values'>,
  varName: string
): string {
  switch (problem.dataset_type) {
    case 'random_integers': {
      const size = pyInt(problem.size, 5, 300);
      const seedKw = problem.seed !== undefined ? `, seed=${pyInt(problem.seed, 0, 2 ** 31 - 1)}` : '';
      return (
        `from polysort.datasets.random_integers import RandomIntegers\n` +
        `${varName} = RandomIntegers(size=${size}${seedKw})`
      );
    }
    case 'nearly_sorted': {
      const size = pyInt(problem.size, 5, 300);
      const swaps = pyInt(problem.swaps ?? Math.max(1, Math.round(size * 0.05)), 0, size);
      const seedKw = problem.seed !== undefined ? `, seed=${pyInt(problem.seed, 0, 2 ** 31 - 1)}` : '';
      return (
        `from polysort.datasets.nearly_sorted import NearlySorted\n` +
        `${varName} = NearlySorted(size=${size}, swaps=${swaps}${seedKw})`
      );
    }
    case 'reverse_sorted': {
      const size = pyInt(problem.size, 5, 300);
      return (
        `from polysort.datasets.reverse_sorted import ReverseSorted\n` + `${varName} = ReverseSorted(size=${size})`
      );
    }
    case 'many_duplicates': {
      const size = pyInt(problem.size, 5, 300);
      const distinct = pyInt(problem.distinct ?? Math.max(2, Math.round(size / 10)), 1, size);
      const seedKw = problem.seed !== undefined ? `, seed=${pyInt(problem.seed, 0, 2 ** 31 - 1)}` : '';
      return (
        `from polysort.datasets.many_duplicates import ManyDuplicates\n` +
        `${varName} = ManyDuplicates(size=${size}, distinct=${distinct}${seedKw})`
      );
    }
    default:
      throw new Error(`Unknown dataset_type: ${problem.dataset_type}`);
  }
}

// No library change needed for a literal-values dataset: a plain duck-typed
// class satisfies SortProblem's two-method contract at runtime (Python type
// hints aren't enforced), so there's no need to import or subclass the
// SortProblem ABC just for this.
export const CUSTOM_PROBLEM_CLASS = `
class _PolyraptorCustomSortProblem:
    def __init__(self, values):
        self._values = values
    def data(self):
        return list(self._values)
    def comparator(self, a, b):
        if a < b:
            return -1
        if a > b:
            return 1
        return 0
`;

export interface AuthorDatasetOptions {
  dataset_type: SortDatasetType;
  size?: number;
  seed?: number;
  swaps?: number;
  distinct?: number;
  values?: number[]; // for dataset_type === 'custom'
}

export interface AuthoredDatasetResult {
  values: number[];
  size: number;
}

export async function authorSortDataset(options: AuthorDatasetOptions): Promise<AuthoredDatasetResult> {
  let code: string;
  if (options.dataset_type === 'custom') {
    const literal = pyIntListLiteral(options.values);
    code = `${CUSTOM_PROBLEM_CLASS}\nproblem = _PolyraptorCustomSortProblem(${literal})\nimport json\njson.dumps(problem.data())`;
  } else {
    const problemCode = buildDatasetConstructionCode(
      { dataset_type: options.dataset_type, size: options.size ?? 30, seed: options.seed, swaps: options.swaps, distinct: options.distinct },
      'problem'
    );
    code = `${problemCode}\nimport json\njson.dumps(problem.data())`;
  }
  const jsonResult = (await runPythonWithOnStep(() => code, () => {})) as string;
  const values: number[] = JSON.parse(jsonResult);
  return { values, size: values.length };
}

export async function runSortAlgorithm(problem: AuthoredSortProblem, algorithm: SortAlgorithm): Promise<SortTrace> {
  const collector = makeCollector();
  const traceId = newTraceId(`sort-${algorithm}`);

  const func = algorithmFunctionName(algorithm);
  const moduleName = ALGORITHM_MODULE[algorithm];
  const valuesLiteral = pyIntListLiteral(problem.values);

  const codeTemplate = `
import json
from polysort.algorithms.${moduleName} import ${func}
${CUSTOM_PROBLEM_CLASS}
problem = _PolyraptorCustomSortProblem(${valuesLiteral})
${PY_SORT_SUMMARY_HELPER}
def _json_bridge(event_dict):
    on_step_placeholder(json.dumps(event_dict))

_result = ${func}(problem, statistics=True, on_step=_json_bridge)
_data, _stats = _result
json.dumps(_polyraptor_sort_summary(problem, _data, _stats))
`;

  const jsonResult = (await runPythonWithOnStep(
    (onStepGlobalName) => codeTemplate.replace(/on_step_placeholder/g, onStepGlobalName),
    collector.collect
  )) as string;

  const summary: SortRunSummary = JSON.parse(jsonResult);

  return {
    trace_id: traceId,
    problem_id: problem.problem_id,
    algorithm,
    entries: collector.entries as unknown as SortTrace['entries'],
    summary,
    currentSeq: -1,
    playing: false,
    speed: 1,
  };
}

export interface SortBenchmarkResult {
  algorithm: SortAlgorithm;
  summary: SortRunSummary;
}

export async function benchmarkCompareSort(
  problem: AuthoredSortProblem,
  algorithms: SortAlgorithm[]
): Promise<SortBenchmarkResult[]> {
  const valuesLiteral = pyIntListLiteral(problem.values);

  const perAlgoBlocks = algorithms
    .map((algo, i) => {
      const func = algorithmFunctionName(algo);
      const moduleName = ALGORITHM_MODULE[algo];
      return `
from polysort.algorithms.${moduleName} import ${func} as _algo_${i}
_p${i} = _PolyraptorCustomSortProblem(${valuesLiteral})
_r${i}, _stats${i} = _algo_${i}(_p${i}, statistics=True)
_results.append(('${algo}', _polyraptor_sort_summary(_p${i}, _r${i}, _stats${i})))
`;
    })
    .join('\n');

  const code = `
import json
${CUSTOM_PROBLEM_CLASS}
${PY_SORT_SUMMARY_HELPER}
_results = []
${perAlgoBlocks}
json.dumps(_results)
`;

  const jsonResult = (await runPythonWithOnStep(() => code, () => {})) as string;
  const raw: [SortAlgorithm, SortRunSummary][] = JSON.parse(jsonResult);
  return raw.map(([algorithm, summary]) => ({ algorithm, summary }));
}
