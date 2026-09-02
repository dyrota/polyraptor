// Custom (student-authored) algorithm: author (validate signature via
// inspect, discard -- no problem to run against yet) and run (rebuild fresh
// from stored source every time, against a problem that may itself be
// built-in or custom). Mirrors runPythonProblem.ts's core discipline: never
// cache a live Python object, only the source string.
import { runUntrusted } from '../pyodide/workerBridge';
import { EXEC_STUDENT_ALGORITHM } from '../shared/authorPythonAlgorithm';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import { buildProblemConstructionCode } from './runAlgorithm';
import { PY_SAFE_JSON_HELPER } from '../pyodide/pySafeJson';
import { EXEC_STUDENT_SOURCE as EXEC_STUDENT_PROBLEM_SOURCE, CHECK_STATESPACEPROBLEM_SUBCLASS } from './runPythonProblem';
import type { AuthoredProblem, SearchTrace } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';

// Author-time validation is entirely family-agnostic, so it lives in
// shared/ and is re-exported here under the name the panel and the tools
// already call it by. Only the RUN half below is family-specific.
export { authorPythonAlgorithm as authorPythonSearchAlgorithm } from '../shared/authorPythonAlgorithm';
export type { AuthorPythonAlgorithmResult } from '../shared/authorPythonAlgorithm';

export interface RunPythonAlgorithmResult {
  trace?: SearchTrace;
  ok: boolean;
  raw_return_value?: unknown;
  event_type_counts?: Record<string, number>;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function runPythonAlgorithmOnProblem(
  problem: AuthoredProblem,
  algorithmSource: string
): Promise<RunPythonAlgorithmResult> {
  const collector = makeCollector();
  const traceId = newTraceId('search-python-algo');

  // Both pieces of untrusted text are bound as live global string values
  // (pyodide.globals.set, via extraGlobals) -- never embedded in a Python
  // string literal, avoiding any escaping of whatever either author typed.
  const extraGlobals: Record<string, string> = { _student_algorithm_source: algorithmSource };
  let problemConstructionPython: string;
  if (problem.type === 'python_problem') {
    if (!problem.source_code) {
      return { ok: false, kind: 'internal', friendly_error: 'This problem has no stored Python source to re-run.' };
    }
    extraGlobals._student_source = problem.source_code;
    problemConstructionPython = `${EXEC_STUDENT_PROBLEM_SOURCE}\n${CHECK_STATESPACEPROBLEM_SUBCLASS}\nproblem = _ProblemClass()`;
  } else {
    problemConstructionPython = buildProblemConstructionCode(problem, 'problem');
  }

  // on_step is only passed if the student's signature actually accepts it --
  // calling with an unexpected keyword argument would raise a TypeError that
  // is avoidable by checking first, rather than something to just let happen.
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
# The old try/except json.dumps caught a non-serializable return value but not
# a non-finite float inside an otherwise fine one: json.dumps SUCCEEDS there,
# emitting a bare Infinity/NaN token that JS's JSON.parse then rejects, failing
# the whole call after the algorithm had already run correctly. _json_safe
# handles both, and covers the event payloads for the same reason.
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

  // A run that crashed partway through still returns whatever partial trace
  // was captured before the failure -- pedagogically useful ("here's exactly
  // how far it got"), and nearly free since the collector already
  // accumulates independent of whether the overall call throws.
  const partialTrace: SearchTrace | undefined =
    collector.entries.length > 0
      ? {
          trace_id: traceId,
          problem_id: problem.problem_id,
          algorithm: 'custom',
          entries: collector.entries as unknown as SearchTrace['entries'],
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
  const trace: SearchTrace = {
    trace_id: traceId,
    problem_id: problem.problem_id,
    algorithm: 'custom',
    entries: collector.entries as unknown as SearchTrace['entries'],
    summary: { raw_return_value, event_type_counts: eventTypeCounts },
    currentSeq: -1,
    playing: false,
    speed: 1,
  };
  return { ok: true, trace, raw_return_value, event_type_counts: eventTypeCounts };
}
