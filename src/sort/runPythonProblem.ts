// Custom (student-authored) SortProblem: author (validate+discard) and run
// (rebuild from stored source, execute a trusted built-in algorithm against
// it). Both go through the untrusted-code worker via workerBridge, never the
// trusted main-thread bridge.ts — even "trusted algorithm + custom problem"
// must run there, since the algorithm calls the untrusted problem's own
// methods (comparator/data) and a buggy one can hang exactly as easily as a
// buggy custom algorithm would.
//
// No separate source-tracking map here: the stored AuthoredSortProblem's own
// source_code field is the single source of truth (set by the caller when it
// calls putProblem), consistent with every other problem type in this app.
import { runUntrusted } from '../pyodide/workerBridge';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import { ALGORITHM_MODULE, algorithmFunctionName, PY_SORT_SUMMARY_HELPER } from './runAlgorithm';
import type { AuthoredSortProblem, SortAlgorithm, SortRunSummary, SortTrace } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';

// Shared preamble for every operation touching student source: compile it
// under a distinct filename (so tracebacks say "<your code>", line N — not
// internal wiring line numbers) into its own fresh globals dict, then pull
// out the required `Problem` class. Source arrives via extraGlobals (a live
// Python string value via pyodide.globals.set), never embedded in a string
// literal — avoids any escaping of whatever the student happened to type.
const EXEC_STUDENT_SOURCE = `
_student_globals = {}
exec(compile(_student_source, '<your code>', 'exec'), _student_globals)
if 'Problem' not in _student_globals:
    raise NameError("name 'Problem' is not defined")
_ProblemClass = _student_globals['Problem']
`;

const CHECK_SORTPROBLEM_SUBCLASS = `
from polysort.interfaces import SortProblem
if not (isinstance(_ProblemClass, type) and issubclass(_ProblemClass, SortProblem)):
    raise TypeError('Your class \`Problem\` must inherit from polysort.interfaces.SortProblem (from polysort.interfaces import SortProblem).')
`;

export interface AuthorPythonProblemResult {
  valid: boolean;
  size?: number;
  values?: number[];
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function authorPythonSortProblem(sourceCode: string): Promise<AuthorPythonProblemResult> {
  const python = `
${EXEC_STUDENT_SOURCE}
${CHECK_SORTPROBLEM_SUBCLASS}
_instance = _ProblemClass()
_data = _instance.data()
if not isinstance(_data, list) or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in _data):
    raise TypeError('\`data()\` must return a list of numbers -- this is what makes the bar visualization work.')
if len(_data) < 1:
    raise ValueError('\`data()\` must return a non-empty list.')
_probe_b = _data[1] if len(_data) >= 2 else _data[0]
_instance.comparator(_data[0], _probe_b)
import json
json.dumps({'size': len(_data), 'values': _data})
`;

  const result = await runUntrusted(python, { _student_source: sourceCode });
  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { valid: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }
  const { size, values } = JSON.parse(result.result ?? '{}') as { size: number; values: number[] };
  return { valid: true, size, values };
}

export interface RunOnPythonProblemResult {
  trace?: SortTrace;
  ok: boolean;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function runAlgorithmOnPythonSortProblem(
  problem: AuthoredSortProblem,
  algorithm: SortAlgorithm
): Promise<RunOnPythonProblemResult> {
  if (!problem.source_code) {
    return { ok: false, kind: 'internal', friendly_error: 'This problem has no stored Python source to re-run.' };
  }

  const collector = makeCollector();
  const traceId = newTraceId(`sort-python-${algorithm}`);
  const func = algorithmFunctionName(algorithm);
  const moduleName = ALGORITHM_MODULE[algorithm];

  const python = `
import json
from polysort.algorithms.${moduleName} import ${func}
${EXEC_STUDENT_SOURCE}
${CHECK_SORTPROBLEM_SUBCLASS}
problem = _ProblemClass()
${PY_SORT_SUMMARY_HELPER}
def _json_bridge(event_dict):
    _polyraptor_worker_on_step(json.dumps(event_dict))
_result = ${func}(problem, statistics=True, on_step=_json_bridge)
_data, _stats = _result
json.dumps(_polyraptor_sort_summary(_data, _stats))
`;

  const result = await runUntrusted(python, { _student_source: problem.source_code });
  for (const payload of result.events) {
    try {
      collector.collect(JSON.parse(payload));
    } catch {
      // malformed event from student code path -- skip, don't break replay
    }
  }

  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { ok: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }

  const summary: SortRunSummary = JSON.parse(result.result ?? '{}');
  const trace: SortTrace = {
    trace_id: traceId,
    problem_id: problem.problem_id,
    algorithm,
    entries: collector.entries as unknown as SortTrace['entries'],
    summary,
    currentSeq: -1,
    playing: false,
    speed: 1,
  };
  return { ok: true, trace };
}
