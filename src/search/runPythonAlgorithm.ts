// Custom (student-authored) algorithm: author (validate signature via
// inspect, discard -- no problem to run against yet) and run (rebuild fresh
// from stored source every time, against a problem that may itself be
// built-in or custom). Mirrors runPythonProblem.ts's core discipline: never
// cache a live Python object, only the source string.
import { runUntrusted } from '../pyodide/workerBridge';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import { buildProblemConstructionCode } from './runAlgorithm';
import { EXEC_STUDENT_SOURCE as EXEC_STUDENT_PROBLEM_SOURCE, CHECK_STATESPACEPROBLEM_SUBCLASS } from './runPythonProblem';
import type { AuthoredProblem, SearchTrace } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';

// Distinct global name from runPythonProblem.ts's `_student_source` (used for
// the problem side below) -- both can be bound as extraGlobals in the same
// call without colliding.
const EXEC_STUDENT_ALGORITHM = `
_student_algo_globals = {}
exec(compile(_student_algorithm_source, '<your code>', 'exec'), _student_algo_globals)
if 'algorithm' not in _student_algo_globals:
    raise NameError("name 'algorithm' is not defined")
_AlgorithmFn = _student_algo_globals['algorithm']
if not callable(_AlgorithmFn):
    raise TypeError('\`algorithm\` must be a function.')
`;

export interface AuthorPythonAlgorithmResult {
  valid: boolean;
  accepts_on_step?: boolean;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

// Lighter-weight than problem authoring: no problem exists yet to run
// against, so this only execs the source (still through the worker+timeout --
// module-level code runs on exec() regardless of whether the function is
// ever called) and inspects the function's signature, never calling it.
export async function authorPythonSearchAlgorithm(sourceCode: string): Promise<AuthorPythonAlgorithmResult> {
  const python = `
${EXEC_STUDENT_ALGORITHM}
import inspect
_sig = inspect.signature(_AlgorithmFn)
if len(_sig.parameters) < 1:
    raise TypeError('\`algorithm\` must accept at least one parameter (the problem).')
import json
json.dumps({'accepts_on_step': 'on_step' in _sig.parameters})
`;
  const result = await runUntrusted(python, { _student_algorithm_source: sourceCode });
  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { valid: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }
  const { accepts_on_step } = JSON.parse(result.result ?? '{}') as { accepts_on_step: boolean };
  return { valid: true, accepts_on_step };
}

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
_sig = inspect.signature(_AlgorithmFn)
def _json_bridge(event_dict):
    _polyraptor_worker_on_step(json.dumps(event_dict))
if 'on_step' in _sig.parameters:
    _raw_result = _AlgorithmFn(problem, on_step=_json_bridge)
else:
    _raw_result = _AlgorithmFn(problem)
try:
    _raw_json = json.dumps(_raw_result)
except (TypeError, ValueError):
    _raw_json = json.dumps(str(_raw_result))
json.dumps({'raw_return_value': json.loads(_raw_json)})
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
