// Empirical verification of an authored heuristic against ground truth.
//
// This generalizes what search_propose_heuristic did for exactly one case
// (maze problems, weighted manhattan+euclidean) to any heuristic against any
// problem -- built-in or student-authored. Three properties, each with a
// concrete counterexample rather than a boolean:
//
//   admissible   h(n) <= h*(n)                 never overestimates
//   consistent   h(n) <= c(n,n') + h(n')       strictly stronger; with
//                                              h(goal)=0 it implies
//                                              admissibility
//   goal-zero    h(goal) == 0                  the mistake students make most
//
// SOUNDNESS -- the reason the result is a verdict and not a boolean.
// Ground truth comes from exhaustively exploring the reachable state space,
// which an arbitrary student problem can blow past. Under a truncated
// exploration the backward cost map is computed over a SUBGRAPH, so
// dist_partial(n) >= dist_true(n). That asymmetry is what makes the tiering
// honest:
//   - a violation found against dist_partial is also a violation against
//     dist_true, so REFUTATION IS ALWAYS SOUND, at any problem size;
//   - the absence of a violation only certifies anything when the exploration
//     actually completed.
// Hence three verdicts: 'refuted' (counterexample, trustworthy), 'proven'
// (exhaustive, nothing found), 'unrefuted' (budget hit, nothing found among
// what was checked). Reporting 'unrefuted' as "admissible" would be a lie,
// and the difference between "I found no bug" and "there is no bug" is
// exactly the thing this feature exists to teach.
//
// Consistency needs no ground truth at all -- it is a local property of each
// edge -- so it stays fully meaningful even when exploration was truncated.
import { runUntrusted } from '../pyodide/workerBridge';
import { buildAnyProblemConstructionPython } from './runPythonHeuristic';
import { PY_SAFE_JSON_HELPER } from '../pyodide/pySafeJson';
import type { AuthoredProblem } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';

// Exploration ceiling. Teaching-scale problems sit far below this (missionaries
// is ~30 states, 8-queens' partial-assignment tree a few thousand, a 30x30
// maze at most 900), so hitting it means the problem is genuinely large rather
// than that the limit is stingy.
export const DEFAULT_STATE_BUDGET = 20000;

// Verification is a deliberate, user-initiated action rather than something on
// the animation path, so it gets a longer leash than the 8s default -- but
// still a bounded one, and the existing Stop button interrupts it.
const VERIFY_TIMEOUT_MS = 20000;

const PY_VERIFY_HELPER = `
import heapq
from collections import deque
from itertools import count

_POLYRAPTOR_EPS = 1e-9

def _polyraptor_explore(problem, budget):
    """Forward BFS over the reachable state space.

    Goal states are expanded like any other rather than short-circuited: h* at
    a goal is 0 either way, and stopping there would leave the reachable set
    incomplete for the admissibility sweep.
    """
    initial = problem.initial_state()
    adj = {}
    goals = []
    seen = {initial}
    q = deque([initial])
    truncated = False
    while q:
        if len(seen) > budget:
            truncated = True
            break
        s = q.popleft()
        if problem.goal_check(s):
            goals.append(s)
        succs = []
        for op in problem.operators():
            nxt = problem.apply_operator(op, s)
            if nxt is None:
                continue
            c = problem.cost(s, nxt)
            if not isinstance(c, (int, float)) or isinstance(c, bool):
                raise TypeError('\`cost(state1, state2)\` must return a number.')
            succs.append((nxt, c))
            if nxt not in seen:
                seen.add(nxt)
                q.append(nxt)
        adj[s] = succs
    return adj, goals, truncated

def _polyraptor_backward_costs(adj, goals):
    """Multi-source Dijkstra backward from every goal state -> h*(n).

    Multi-source rather than single-source because N-Queens (and any custom
    problem defining goal_check by a predicate rather than one target state)
    has many goals -- the maze-only backward-BFS this replaces could not
    express that. The monotonic counter is a tie-break so heapq never has to
    order two states against each other: states are only required to be
    hashable, not comparable, and a frozenset state would otherwise raise.
    """
    rev = {}
    for s, succs in adj.items():
        for (t, c) in succs:
            rev.setdefault(t, []).append((s, c))
    tie = count()
    dist = {}
    pq = []
    for g in goals:
        if g not in dist:
            dist[g] = 0
            heapq.heappush(pq, (0, next(tie), g))
    while pq:
        d, _, s = heapq.heappop(pq)
        if d > dist.get(s, float('inf')):
            continue
        for (p, c) in rev.get(s, ()):
            nd = d + c
            if nd < dist.get(p, float('inf')):
                dist[p] = nd
                heapq.heappush(pq, (nd, next(tie), p))
    return dist

def _polyraptor_verify(problem, h, budget):
    adj, goals, truncated = _polyraptor_explore(problem, budget)
    dist = _polyraptor_backward_costs(adj, goals)

    _hcache = {}
    def H(s):
        if s not in _hcache:
            v = h(s)
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise TypeError('\`heuristic(state)\` must return a number.')
            _hcache[s] = v
        return _hcache[s]

    goal_zero_ce = None
    for g in goals:
        v = H(g)
        if abs(v) > _POLYRAPTOR_EPS:
            goal_zero_ce = {'state': g, 'h_value': v}
            break

    # A state with no path to any goal has h* = infinity, so every finite h is
    # admissible there -- those are skipped rather than counted as passes.
    adm_ce = None
    adm_checked = 0
    worst_over = 0.0
    for s in adj:
        true_cost = dist.get(s)
        if true_cost is None:
            continue
        adm_checked += 1
        v = H(s)
        over = v - true_cost
        if over > _POLYRAPTOR_EPS and over > worst_over:
            worst_over = over
            adm_ce = {'state': s, 'h_value': v, 'true_cost': true_cost, 'overestimate_by': over}

    con_ce = None
    con_checked = 0
    worst_viol = 0.0
    for s, succs in adj.items():
        hs = H(s)
        for (t, c) in succs:
            con_checked += 1
            viol = hs - (c + H(t))
            if viol > _POLYRAPTOR_EPS and viol > worst_viol:
                worst_viol = viol
                con_ce = {'state': s, 'h_value': hs, 'successor': t,
                          'successor_h': H(t), 'edge_cost': c, 'violation_by': viol}

    refuted = adm_ce is not None or con_ce is not None or goal_zero_ce is not None
    verdict = 'refuted' if refuted else ('unrefuted' if truncated else 'proven')
    return {
        'verdict': verdict,
        'states_explored': len(adj),
        'budget_exceeded': truncated,
        'goal_states_found': len(goals),
        'optimal_cost_from_initial': dist.get(problem.initial_state()),
        'admissible': {'holds': adm_ce is None, 'checked': adm_checked, 'counterexample': adm_ce},
        'consistent': {'holds': con_ce is None, 'checked': con_checked, 'counterexample': con_ce},
        'goal_zero': {'holds': goal_zero_ce is None, 'checked': len(goals), 'counterexample': goal_zero_ce},
    }
`;

const EXEC_STUDENT_HEURISTIC = `
_student_heuristic_globals = {}
exec(compile(_student_heuristic_source, '<your code>', 'exec'), _student_heuristic_globals)
if 'heuristic' not in _student_heuristic_globals:
    raise NameError("name 'heuristic' is not defined")
_HeuristicFn = _student_heuristic_globals['heuristic']
if not callable(_HeuristicFn):
    raise TypeError('\`heuristic\` must be a function.')
`;

// The verdict vocabulary and the counterexample-carrying property shape are
// shared with the sort family's comparator verification -- see
// shared/verification.ts for why they live in one place. Re-exported so this
// module stays the single import for everything about a heuristic verdict.
export type { VerificationVerdict, PropertyResult } from '../shared/verification';
import type { VerificationVerdict, PropertyResult } from '../shared/verification';

export interface AdmissibilityCounterexample {
  state: unknown;
  h_value: number;
  true_cost: number;
  overestimate_by: number;
}

export interface ConsistencyCounterexample {
  state: unknown;
  h_value: number;
  successor: unknown;
  successor_h: number;
  edge_cost: number;
  violation_by: number;
}

export interface GoalZeroCounterexample {
  state: unknown;
  h_value: number;
}

export interface VerificationReport {
  verdict: VerificationVerdict;
  states_explored: number;
  budget_exceeded: boolean;
  goal_states_found: number;
  optimal_cost_from_initial: number | null;
  admissible: PropertyResult<AdmissibilityCounterexample>;
  consistent: PropertyResult<ConsistencyCounterexample>;
  goal_zero: PropertyResult<GoalZeroCounterexample>;
}

export interface VerifyHeuristicResult {
  ok: boolean;
  report?: VerificationReport;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function verifyHeuristic(
  problem: AuthoredProblem,
  heuristicSource: string,
  budget: number = DEFAULT_STATE_BUDGET
): Promise<VerifyHeuristicResult> {
  const extraGlobals: Record<string, string> = { _student_heuristic_source: heuristicSource };
  let problemConstructionPython: string;
  try {
    problemConstructionPython = buildAnyProblemConstructionPython(problem, extraGlobals);
  } catch (err) {
    return { ok: false, kind: 'internal', friendly_error: err instanceof Error ? err.message : String(err) };
  }

  const safeBudget = Math.max(1, Math.min(200000, Math.floor(budget)));

  const python = `
import json
${problemConstructionPython}
${EXEC_STUDENT_HEURISTIC}
${PY_VERIFY_HELPER}
${PY_SAFE_JSON_HELPER}
_report = _polyraptor_verify(problem, _HeuristicFn, ${safeBudget})
json.dumps(_polyraptor_json_safe(_report))
`;

  // Untrusted path, always: both the heuristic and (for a python_problem) the
  // problem itself are student code, and exhaustive exploration calls into
  // operators()/apply_operator()/cost() a great many times -- exactly where a
  // bug turns into a hang.
  const result = await runUntrusted(python, extraGlobals, VERIFY_TIMEOUT_MS);
  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { ok: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }
  return { ok: true, report: JSON.parse(result.result ?? '{}') as VerificationReport };
}

// Turns a report into the one sentence a human (or an agent narrating to one)
// should lead with. Kept next to the types it reads so the UI and the tool
// description can never drift into describing the same verdict differently.
export function summarizeVerdict(report: VerificationReport): string {
  const failed: string[] = [];
  if (!report.goal_zero.holds) failed.push('h(goal) is not 0');
  if (!report.admissible.holds) failed.push('it overestimates the true remaining cost');
  if (!report.consistent.holds) failed.push('it is not consistent');

  if (report.verdict === 'refuted') {
    return `Refuted — ${failed.join('; ')}.`;
  }
  if (report.verdict === 'proven') {
    return `Proven admissible and consistent across all ${report.states_explored} reachable states.`;
  }
  // A truncated exploration that never reached a goal state checked admissibility
  // against nothing at all, so `admissible.holds` is vacuously true. Saying "no
  // counterexample found" there would imply a check that never happened -- name
  // it instead, since it's usually a signal the budget is the problem, not the
  // heuristic.
  if (report.goal_states_found === 0) {
    return (
      `Inconclusive — no goal state was reached within the ${report.states_explored}-state budget, so ` +
      `admissibility could not be checked at all. Consistency was checked on ${report.consistent.checked} edges. ` +
      `Try a smaller problem or a larger state_budget.`
    );
  }
  return (
    `No counterexample found in ${report.states_explored} states (${report.admissible.checked} checked for ` +
    `admissibility), but the state space exceeded the budget — this does NOT prove the heuristic is admissible.`
  );
}
