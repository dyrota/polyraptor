// Tier 3, narrowest-risk custom-code slot in the project: only a single pure
// function is untrusted, called from inside a fully trusted, well-understood
// algorithm loop (a_star/best_first/hill_climbing) -- the plan doc's own
// flagged "good, low-risk starting point" if this needs to be built under
// time pressure. Mirrors runPythonAlgorithm.ts's problem-source-agnostic
// branching (built-in vs python_problem) exactly.
import { runUntrusted } from '../pyodide/workerBridge';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import { ALGORITHM_MODULE, ALGORITHM_FUNC, PY_SUMMARY_HELPER, buildProblemConstructionCode } from './runAlgorithm';
import { PY_SAFE_JSON_HELPER } from '../pyodide/pySafeJson';
import { EXEC_STUDENT_SOURCE as EXEC_STUDENT_PROBLEM_SOURCE, CHECK_STATESPACEPROBLEM_SUBCLASS } from './runPythonProblem';
import type { AuthoredProblem, SearchTrace, RunSummary } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';

const EXEC_STUDENT_HEURISTIC = `
_student_heuristic_globals = {}
exec(compile(_student_heuristic_source, '<your code>', 'exec'), _student_heuristic_globals)
if 'heuristic' not in _student_heuristic_globals:
    raise NameError("name 'heuristic' is not defined")
_HeuristicFn = _student_heuristic_globals['heuristic']
if not callable(_HeuristicFn):
    raise TypeError('\`heuristic\` must be a function.')
`;

// Mutates extraGlobals in place (adds _student_source when the problem is
// itself custom) -- side effect is fine at this scope. Exported because
// verifyHeuristic.ts needs the identical built-in-vs-custom branching: any
// problem you can run a heuristic against is one you should be able to verify
// it against, and the two must construct the problem the same way or the
// verdict wouldn't describe the run.
export function buildAnyProblemConstructionPython(problem: AuthoredProblem, extraGlobals: Record<string, string>): string {
  if (problem.type === 'python_problem') {
    if (!problem.source_code) throw new Error('This problem has no stored Python source to re-run.');
    extraGlobals._student_source = problem.source_code;
    return `${EXEC_STUDENT_PROBLEM_SOURCE}\n${CHECK_STATESPACEPROBLEM_SUBCLASS}\nproblem = _ProblemClass()`;
  }
  return buildProblemConstructionCode(problem, 'problem');
}

export interface AuthorPythonHeuristicResult {
  valid: boolean;
  sample_value?: number;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

// Validated against the real problem's actual initial_state, per the plan --
// unlike algorithm authoring, a heuristic is meaningless without a problem to
// probe (a heuristic take a state, and the only state we know exists is
// initial_state()).
export async function authorPythonSearchHeuristic(
  sourceCode: string,
  problem: AuthoredProblem
): Promise<AuthorPythonHeuristicResult> {
  const extraGlobals: Record<string, string> = { _student_heuristic_source: sourceCode };
  const problemConstructionPython = buildAnyProblemConstructionPython(problem, extraGlobals);
  const python = `
${problemConstructionPython}
${EXEC_STUDENT_HEURISTIC}
${PY_SAFE_JSON_HELPER}
_sample = _HeuristicFn(problem.initial_state())
if not isinstance(_sample, (int, float)) or isinstance(_sample, bool):
    raise TypeError('\`heuristic\` must return a number.')
import json
# float('inf') passes the isinstance check above and is the idiomatic way to
# say "unreachable" in a heuristic -- but json.dumps would emit a bare
# Infinity token that JS's JSON.parse rejects outright.
json.dumps({'sample_value': _polyraptor_json_safe(_sample)})
`;
  const result = await runUntrusted(python, extraGlobals);
  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { valid: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }
  const { sample_value } = JSON.parse(result.result ?? '{}') as { sample_value: number };
  return { valid: true, sample_value };
}

export interface RunPythonHeuristicResult {
  trace?: SearchTrace;
  ok: boolean;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function runPythonHeuristicOnProblem(
  problem: AuthoredProblem,
  heuristicSource: string,
  algorithm: 'a_star' | 'best_first' | 'hill_climbing'
): Promise<RunPythonHeuristicResult> {
  const collector = makeCollector();
  const traceId = newTraceId(`search-python-heuristic-${algorithm}`);
  const func = ALGORITHM_FUNC[algorithm];
  const moduleName = ALGORITHM_MODULE[algorithm];

  const extraGlobals: Record<string, string> = { _student_heuristic_source: heuristicSource };
  const problemConstructionPython = buildAnyProblemConstructionPython(problem, extraGlobals);

  // Only the heuristic is untrusted here -- the algorithm loop is the same
  // trusted a_star_search/best_first_search/hill_climbing_search called
  // everywhere else in the app, so the full, rich, guaranteed-shape
  // RunSummary applies (unlike tier 2's loose raw_return_value shape).
  const python = `
import json
from polysearch.algorithms.${moduleName} import ${func}
${problemConstructionPython}
${EXEC_STUDENT_HEURISTIC}
def _heuristic(state):
    return _HeuristicFn(state)
${PY_SUMMARY_HELPER}
def _json_bridge(event_dict):
    _polyraptor_worker_on_step(json.dumps(event_dict))
_result = ${func}(problem, heuristic=_heuristic, statistics=True, on_step=_json_bridge)
json.dumps(_polyraptor_make_summary(problem, _result))
`;

  const result = await runUntrusted(python, extraGlobals);
  for (const payload of result.events) {
    try {
      collector.collect(JSON.parse(payload));
    } catch {
      // malformed event -- skip, don't break replay
    }
  }

  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { ok: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }

  const summary: RunSummary = JSON.parse(result.result ?? '{}');
  const trace: SearchTrace = {
    trace_id: traceId,
    problem_id: problem.problem_id,
    algorithm,
    entries: collector.entries as unknown as SearchTrace['entries'],
    summary,
    currentSeq: -1,
    playing: false,
    speed: 1,
  };
  return { ok: true, trace };
}
