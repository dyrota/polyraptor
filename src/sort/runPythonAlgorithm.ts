// Mirrors search/runPythonAlgorithm.ts exactly -- see that file's comments
// for the full reasoning (author is signature-only via inspect, never calls
// the function; run always rebuilds fresh from stored source; on_step is
// only passed if the signature actually accepts it).
//
// Simpler than search for the "built-in problem" branch specifically: the
// existing trusted runSortAlgorithm never re-invokes a dataset's *original*
// generator class at run time -- it always just re-wraps the
// already-resolved `values` array (computed once at author time) in the
// trusted duck-typed _PolyraptorCustomSortProblem via pyIntListLiteral. Every
// non-python_problem dataset_type (including the existing 'custom' literal-
// values case) already has `values` populated, so this same
// wrap-already-known-values approach covers all of them uniformly -- no need
// to re-run a dataset generator here at all.
import { runUntrusted } from '../pyodide/workerBridge';
import { EXEC_STUDENT_ALGORITHM } from '../shared/authorPythonAlgorithm';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import { pyIntListLiteral, CUSTOM_PROBLEM_CLASS } from './runAlgorithm';
import { PY_SAFE_JSON_HELPER } from '../pyodide/pySafeJson';
import { EXEC_STUDENT_SOURCE as EXEC_STUDENT_PROBLEM_SOURCE, CHECK_SORTPROBLEM_SUBCLASS } from './runPythonProblem';
import type { AuthoredSortProblem, SortTrace } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';

// Author-time validation is entirely family-agnostic, so it lives in
// shared/ and is re-exported here under the name the panel and the tools
// already call it by. Only the RUN half below is family-specific.
export { authorPythonAlgorithm as authorPythonSortAlgorithm } from '../shared/authorPythonAlgorithm';
export type { AuthorPythonAlgorithmResult } from '../shared/authorPythonAlgorithm';

export interface RunPythonAlgorithmResult {
  trace?: SortTrace;
  ok: boolean;
  raw_return_value?: unknown;
  event_type_counts?: Record<string, number>;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function runPythonAlgorithmOnProblem(
  problem: AuthoredSortProblem,
  algorithmSource: string
): Promise<RunPythonAlgorithmResult> {
  const collector = makeCollector();
  const traceId = newTraceId('sort-python-algo');

  const extraGlobals: Record<string, string> = { _student_algorithm_source: algorithmSource };
  let problemConstructionPython: string;
  if (problem.dataset_type === 'python_problem') {
    if (!problem.source_code) {
      return { ok: false, kind: 'internal', friendly_error: 'This problem has no stored Python source to re-run.' };
    }
    extraGlobals._student_source = problem.source_code;
    problemConstructionPython = `${EXEC_STUDENT_PROBLEM_SOURCE}\n${CHECK_SORTPROBLEM_SUBCLASS}\nproblem = _ProblemClass()`;
  } else {
    const valuesLiteral = pyIntListLiteral(problem.values);
    problemConstructionPython = `${CUSTOM_PROBLEM_CLASS}\nproblem = _PolyraptorCustomSortProblem(${valuesLiteral})`;
  }

  const python = `
import json, inspect
${problemConstructionPython}
${EXEC_STUDENT_ALGORITHM}
${PY_SAFE_JSON_HELPER}
_sig = inspect.signature(_AlgorithmFn)
def _json_bridge(event_dict):
    _polyraptor_worker_on_step(json.dumps(_polyraptor_json_safe(event_dict)))
if 'on_step' in _sig.parameters:
    _raw_result = _AlgorithmFn(problem, on_step=_json_bridge)
else:
    _raw_result = _AlgorithmFn(problem)
# See the search mirror: json.dumps happily emits Infinity/NaN, which JS's
# JSON.parse rejects -- the old try/except only covered non-serializable types.
json.dumps({'raw_return_value': _polyraptor_json_safe(_raw_result)})
`;

  const result = await runUntrusted(python, extraGlobals);
  for (const payload of result.events) {
    try {
      collector.collect(JSON.parse(payload));
    } catch {
      // malformed event from student code -- skip, don't break replay
    }
  }

  const eventTypeCounts: Record<string, number> = {};
  for (const entry of collector.entries) {
    const t = String((entry.event as { type?: unknown })?.type ?? 'unknown');
    eventTypeCounts[t] = (eventTypeCounts[t] ?? 0) + 1;
  }

  const partialTrace: SortTrace | undefined =
    collector.entries.length > 0
      ? {
          trace_id: traceId,
          problem_id: problem.problem_id,
          algorithm: 'custom',
          entries: collector.entries as unknown as SortTrace['entries'],
          summary: { event_type_counts: eventTypeCounts },
          currentSeq: -1,
          playing: false,
          speed: 1,
        }
      : undefined;

  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { ok: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback, trace: partialTrace };
  }

  const { raw_return_value } = JSON.parse(result.result ?? '{}') as { raw_return_value: unknown };
  const trace: SortTrace = {
    trace_id: traceId,
    problem_id: problem.problem_id,
    algorithm: 'custom',
    entries: collector.entries as unknown as SortTrace['entries'],
    summary: { raw_return_value, event_type_counts: eventTypeCounts },
    currentSeq: -1,
    playing: false,
    speed: 1,
  };
  return { ok: true, trace, raw_return_value, event_type_counts: eventTypeCounts };
}
