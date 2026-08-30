// Custom (student-authored) StateSpaceProblem: author (validate+discard) and
// run (rebuild from stored source, execute a trusted built-in algorithm
// against it). Mirrors sort/runPythonProblem.ts's pattern exactly -- both go
// through the untrusted-code worker via workerBridge, never the trusted
// main-thread bridge.ts, even for "trusted algorithm + custom problem",
// since the algorithm calls back into the untrusted problem's own methods
// and a bug there can hang exactly as easily as a bug in a full custom
// algorithm would.
import { runUntrusted } from '../pyodide/workerBridge';
import { makeCollector, newTraceId } from '../pyodide/traceCollector';
import { ALGORITHM_MODULE, ALGORITHM_FUNC, PY_SUMMARY_HELPER, DEFAULT_MAX_DEPTH } from './runAlgorithm';
import type { AuthoredProblem, SearchAlgorithm, RunSummary, SearchTrace } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';

// Same compile-under-a-distinct-filename preamble as the sort version --
// keeps traceback line numbers meaningful and avoids ever embedding student
// text in a Python string literal (source arrives via extraGlobals, a live
// string value via pyodide.globals.set).
export const EXEC_STUDENT_SOURCE = `
_student_globals = {}
exec(compile(_student_source, '<your code>', 'exec'), _student_globals)
if 'Problem' not in _student_globals:
    raise NameError("name 'Problem' is not defined")
_ProblemClass = _student_globals['Problem']
`;

export const CHECK_STATESPACEPROBLEM_SUBCLASS = `
from polysearch.interfaces import StateSpaceProblem
if not (isinstance(_ProblemClass, type) and issubclass(_ProblemClass, StateSpaceProblem)):
    raise TypeError('Your class \`Problem\` must inherit from polysearch.interfaces.StateSpaceProblem (from polysearch.interfaces import StateSpaceProblem).')
`;

export interface AuthorPythonSearchProblemResult {
  valid: boolean;
  initial_state?: unknown;
  operator_count?: number;
  goal_check_on_initial?: boolean;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function authorPythonSearchProblem(sourceCode: string): Promise<AuthorPythonSearchProblemResult> {
  // Smoke test exercises all 5 abstractmethods: initial_state, goal_check,
  // operators, apply_operator (on the first operator against the initial
  // state), and cost (only if that first operator produced a real
  // successor -- a problem with zero valid moves from its own start state is
  // unusual but not itself a validation failure, so this doesn't force a
  // cost() call on a None successor).
  const python = `
${EXEC_STUDENT_SOURCE}
${CHECK_STATESPACEPROBLEM_SUBCLASS}
_instance = _ProblemClass()
_initial = _instance.initial_state()
_goal_on_initial = bool(_instance.goal_check(_initial))
_ops = _instance.operators()
_op_count = len(_ops)
if _op_count > 0:
    _successor = _instance.apply_operator(_ops[0], _initial)
    if _successor is not None:
        _instance.cost(_initial, _successor)
import json
json.dumps({'initial_state': _initial, 'operator_count': _op_count, 'goal_check_on_initial': _goal_on_initial})
`;

  const result = await runUntrusted(python, { _student_source: sourceCode });
  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { valid: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }
  const parsed = JSON.parse(result.result ?? '{}') as {
    initial_state: unknown;
    operator_count: number;
    goal_check_on_initial: boolean;
  };
  return { valid: true, ...parsed };
}

export interface RunOnPythonSearchProblemResult {
  trace?: SearchTrace;
  ok: boolean;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function runAlgorithmOnPythonSearchProblem(
  problem: AuthoredProblem,
  algorithm: SearchAlgorithm
): Promise<RunOnPythonSearchProblemResult> {
  if (!problem.source_code) {
    return { ok: false, kind: 'internal', friendly_error: 'This problem has no stored Python source to re-run.' };
  }

  const collector = makeCollector();
  const traceId = newTraceId(`search-python-${algorithm}`);
  const func = ALGORITHM_FUNC[algorithm];
  const moduleName = ALGORITHM_MODULE[algorithm];

  // No heuristic kwarg at all for tier 1 -- every heuristic-taking algorithm
  // (a_star/best_first/hill_climbing) already defaults heuristic=None to
  // `lambda state: 0` internally (confirmed by reading all three source
  // files directly), so omitting it entirely is the correct, safe choice
  // rather than special-casing a zero-heuristic. iterative_deepening is the
  // one algorithm that genuinely needs an explicit guardrail here: its own
  // max_depth=None default is truly unbounded (confirmed from the trusted
  // path's own comment + source), so it gets the same DEFAULT_MAX_DEPTH cap
  // the trusted path already uses -- this isn't optional/copied blindly from
  // the sort mirror, sort has no equivalent unbounded-default algorithm.
  const kwargs = ['statistics=True', 'on_step=_json_bridge'];
  if (algorithm === 'iterative_deepening') kwargs.push(`max_depth=${DEFAULT_MAX_DEPTH}`);

  const python = `
import json
from polysearch.algorithms.${moduleName} import ${func}
${EXEC_STUDENT_SOURCE}
${CHECK_STATESPACEPROBLEM_SUBCLASS}
problem = _ProblemClass()
${PY_SUMMARY_HELPER}
def _json_bridge(event_dict):
    _polyraptor_worker_on_step(json.dumps(event_dict))
_result = ${func}(problem, ${kwargs.join(', ')})
json.dumps(_polyraptor_make_summary(_result))
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
