// Empirical verification of a comparator against the algebraic laws a sort
// needs it to obey -- the sort family's counterpart to search's
// verifyHeuristic.ts, and deliberately built to the same shape.
//
// WHY A COMPARATOR IS WORTH VERIFYING. A broken heuristic makes A* return a
// worse path; you can at least see that it finished. A broken comparator makes
// a *correct* sorting algorithm return a wrong answer with no error, no
// exception, and no visible symptom -- `is_sorted` even reports True, because
// sortedness here is judged by the problem's own comparator (see
// PY_SORT_SUMMARY_HELPER), so an inconsistent comparator is asked to grade
// itself and happily agrees. That circularity is exactly why the check has to
// come from outside, against laws rather than against output.
//
// THE LAWS. polysort's contract is `comparator(a, b) -> -1 | 0 | 1`, and every
// comparison algorithm branches only on the sign. For the result to be a
// well-defined order, that sign has to induce a strict weak ordering:
//
//   total          returns a real number for every pair -- no exception, no
//                  None, no NaN. NaN is the quiet one: every comparison
//                  against it is false, so it neither sorts nor errors.
//   deterministic  the same pair compares the same way twice. A comparator
//                  closing over a counter or calling random() makes the sort's
//                  output depend on the algorithm's access pattern.
//   antisymmetric  sign(cmp(a,b)) == -sign(cmp(b,a)), which at a == b forces
//                  cmp(a,a) == 0. Violated, two algorithms disagree on the
//                  same input because they compare the same pair in opposite
//                  orders.
//   transitive     a < b and b < c implies a < c. The classic: a cyclic
//                  comparator makes "sorted" meaningless, and quicksort can
//                  run off the end of its partition.
//   equivalence-   a == b and b == c implies a == c. The subtle one, and the
//   transitive     reason "close enough" comparators are a trap: `-1 if a <
//                  b - 0.5 else (1 if a > b + 0.5 else 0)` calls 1.0 and 1.4
//                  equal, 1.4 and 1.8 equal, and 1.0 and 1.8 different.
//
// SOUNDNESS -- and how it differs from the search side. The check runs over
// the distinct values in the problem's own dataset, capped by a budget:
// O(n^2) pairs and O(n^3) triples grow fast enough that an arbitrary dataset
// can outrun it. The asymmetry that makes the tiering honest is the same one
// as in verifyHeuristic.ts -- a violation found among a subset of values is a
// real violation, while finding none certifies something only if every value
// was covered.
//
// What "proven" means here is worth stating precisely, because it is stronger
// than search's in one way and weaker in another. Stronger: a sort only ever
// compares elements drawn from its own dataset, so a comparator proven a
// strict weak ordering on those values is genuinely enough for THIS sort to be
// well-defined -- there is no gap to close. Weaker: it says nothing about
// values not in the dataset, so a comparator that is proven here can still be
// broken on the next dataset. Both halves are in the summary line, because
// reporting only the first would teach the same wrong lesson that reporting
// 'unrefuted' as 'holds' would.
import { runUntrusted } from '../pyodide/workerBridge';
import { PY_SAFE_JSON_HELPER } from '../pyodide/pySafeJson';
import { CUSTOM_PROBLEM_CLASS, pyIntListLiteral, pyInt } from './runAlgorithm';
import { EXEC_STUDENT_SOURCE, CHECK_SORTPROBLEM_SUBCLASS } from './runPythonProblem';
import type { AuthoredSortProblem } from './types';
import type { FriendlyError } from '../pyodide/friendlyErrors';
import type { VerificationVerdict, PropertyResult } from '../shared/verification';

// Distinct-value ceiling. 60 values is 3,600 ordered pairs and ~205,000
// triples, which is a fraction of a second in Pyodide -- while the datasets
// this app actually produces sit below it (sort_new_dataset defaults to 30
// elements, and a hand-written comparator exercise is smaller still), so the
// common case completes and earns a real 'proven' rather than bottoming out at
// 'unrefuted'.
export const DEFAULT_VALUE_BUDGET = 60;

// Same reasoning as search's VERIFY_TIMEOUT_MS: verification is a deliberate,
// user-initiated action rather than something on the animation path, so it
// gets a longer leash than the 8s default -- but still a bounded one.
const VERIFY_TIMEOUT_MS = 20000;

const PY_VERIFY_COMPARATOR_HELPER = `
def _polyraptor_sign(x):
    if x < 0:
        return -1
    if x > 0:
        return 1
    return 0

def _polyraptor_verify_comparator(problem, budget):
    raw = problem.data()
    # Deduplicated because the comparator is being checked as a pure function
    # of two values: comparing 5 against 5 twice tells us nothing the first
    # comparison didn't, and duplicates would otherwise burn the budget on
    # repeats. Sorted so the sample -- and every counterexample found in it --
    # is the same on every run rather than depending on dict ordering.
    distinct_all = sorted(set(raw))
    truncated = len(distinct_all) > budget
    # Truncation keeps the SMALLEST values rather than a spread sample: they
    # are the most tightly packed values available, and near-equality bugs
    # (tolerance comparators, float rounding) only show up between values close
    # enough together to trip them. A spread sample would look more impartial
    # and find strictly fewer real bugs. Nothing is over-claimed either way --
    # any truncation caps the verdict at 'unrefuted'.
    vals = distinct_all[:budget]
    n = len(vals)

    cmp_fn = problem.comparator
    calls = 0

    # ---- pass 1: every ordered pair, checking totality and determinism ------
    # Filling a sign matrix up front means the two O(n^3) sweeps below read
    # from a list instead of re-entering student code ~200,000 times. That is
    # only sound if the comparator is deterministic, which is precisely why
    # determinism is checked HERE, at fill time, by calling each pair twice --
    # a non-deterministic comparator would otherwise be silently frozen into
    # the cache and reported as consistent.
    signs = [[0] * n for _ in range(n)]
    usable = [[True] * n for _ in range(n)]
    total_ce = None
    det_ce = None
    pairs_checked = 0

    for i in range(n):
        a = vals[i]
        for j in range(n):
            b = vals[j]
            pairs_checked += 1
            try:
                first = cmp_fn(a, b)
                calls += 1
            except Exception as exc:
                usable[i][j] = False
                if total_ce is None:
                    total_ce = {'a': a, 'b': b,
                                'reason': 'raised ' + type(exc).__name__ + ': ' + str(exc)}
                continue
            if isinstance(first, bool) or not isinstance(first, (int, float)):
                usable[i][j] = False
                if total_ce is None:
                    total_ce = {'a': a, 'b': b,
                                'reason': 'returned ' + repr(first) + ', which is not a number'}
                continue
            # NaN != NaN is the only reliable test, and NaN is the value most
            # worth naming: it makes every <, > and == against it false, so a
            # comparator returning it neither orders anything nor raises.
            if first != first:
                usable[i][j] = False
                if total_ce is None:
                    total_ce = {'a': a, 'b': b,
                                'reason': 'returned NaN, so every comparison against it is false'}
                continue
            try:
                second = cmp_fn(a, b)
                calls += 1
            except Exception as exc:
                usable[i][j] = False
                if det_ce is None:
                    det_ce = {'a': a, 'b': b, 'first': first, 'second': None,
                              'reason': 'raised ' + type(exc).__name__ + ' on the second call'}
                continue
            s1 = _polyraptor_sign(first)
            ok_second = (not isinstance(second, bool)) and isinstance(second, (int, float)) and second == second
            if not ok_second or _polyraptor_sign(second) != s1:
                usable[i][j] = False
                if det_ce is None:
                    det_ce = {'a': a, 'b': b, 'first': first,
                              'second': second if ok_second else None,
                              'reason': 'the same pair compared differently on two consecutive calls'}
                continue
            signs[i][j] = s1

    # ---- pass 2: antisymmetry over every unordered pair --------------------
    # i == j is included deliberately: it is the reflexivity case, cmp(a,a)
    # must be 0, and it is the single most common comparator bug -- a body of
    # "return 1 if a >= b else -1" never returns 0 at all. Folding it in here
    # rather than giving it its own row keeps the law count at what the
    # mathematics actually requires.
    anti_ce = None
    anti_checked = 0
    for i in range(n):
        for j in range(i, n):
            if not (usable[i][j] and usable[j][i]):
                continue
            anti_checked += 1
            if signs[i][j] != -signs[j][i]:
                if anti_ce is None:
                    anti_ce = {'a': vals[i], 'b': vals[j],
                               'a_vs_b': signs[i][j], 'b_vs_a': signs[j][i],
                               'reflexive': i == j}
                    break
        if anti_ce is not None:
            break

    # ---- pass 3: both transitivity laws in one triple sweep ----------------
    # One loop rather than two: the triples are the expensive part, and the two
    # laws are independent predicates over the same triple.
    trans_ce = None
    eq_ce = None
    triples_checked = 0
    for i in range(n):
        si = signs[i]
        ui = usable[i]
        for j in range(n):
            if j == i or not ui[j]:
                continue
            sij = si[j]
            # Neither law's premise can hold for a strictly-greater pair, so
            # the whole inner loop is skippable.
            if sij > 0:
                continue
            sj = signs[j]
            uj = usable[j]
            for k in range(n):
                if k == i or k == j or not (uj[k] and ui[k]):
                    continue
                triples_checked += 1
                sjk = sj[k]
                sik = si[k]
                if trans_ce is None and sij < 0 and sjk < 0 and sik >= 0:
                    trans_ce = {'a': vals[i], 'b': vals[j], 'c': vals[k],
                                'a_vs_b': sij, 'b_vs_c': sjk, 'a_vs_c': sik}
                if eq_ce is None and sij == 0 and sjk == 0 and sik != 0:
                    eq_ce = {'a': vals[i], 'b': vals[j], 'c': vals[k],
                             'a_vs_b': sij, 'b_vs_c': sjk, 'a_vs_c': sik}
            if trans_ce is not None and eq_ce is not None:
                break
        if trans_ce is not None and eq_ce is not None:
            break

    refuted = (total_ce is not None or det_ce is not None or anti_ce is not None
               or trans_ce is not None or eq_ce is not None)
    verdict = 'refuted' if refuted else ('unrefuted' if truncated else 'proven')
    return {
        'verdict': verdict,
        'values_checked': n,
        'distinct_values_in_dataset': len(distinct_all),
        'dataset_size': len(raw),
        'budget_exceeded': truncated,
        'comparator_calls': calls,
        'total': {'holds': total_ce is None, 'checked': pairs_checked, 'counterexample': total_ce},
        'deterministic': {'holds': det_ce is None, 'checked': pairs_checked, 'counterexample': det_ce},
        'antisymmetric': {'holds': anti_ce is None, 'checked': anti_checked, 'counterexample': anti_ce},
        'transitive': {'holds': trans_ce is None, 'checked': triples_checked, 'counterexample': trans_ce},
        'equivalence_transitive': {'holds': eq_ce is None, 'checked': triples_checked, 'counterexample': eq_ce},
    }
`;

// Mirrors search's buildAnyProblemConstructionPython: any problem you can run
// an algorithm against is one you should be able to verify the comparator of,
// and the two paths must construct the problem identically or the verdict
// would not describe the run. A built-in dataset goes through the same
// _PolyraptorCustomSortProblem the run path uses (ascending, and a useful
// 'proven' demo); a python_problem is re-exec'd from its stored source, which
// is also how an authored bare comparator arrives here -- it was wrapped into
// a synthetic Problem class at author time (see runPythonComparator.ts).
export function buildAnySortProblemConstructionPython(
  problem: AuthoredSortProblem,
  extraGlobals: Record<string, string>
): string {
  if (problem.dataset_type === 'python_problem') {
    if (!problem.source_code) throw new Error('This problem has no stored Python source to re-run.');
    extraGlobals._student_source = problem.source_code;
    return `${EXEC_STUDENT_SOURCE}\n${CHECK_SORTPROBLEM_SUBCLASS}\nproblem = _ProblemClass()`;
  }
  return `${CUSTOM_PROBLEM_CLASS}\nproblem = _PolyraptorCustomSortProblem(${pyIntListLiteral(problem.values)})`;
}

export interface TotalityCounterexample {
  a: number;
  b: number;
  reason: string;
}

export interface DeterminismCounterexample {
  a: number;
  b: number;
  first: number;
  second: number | null;
  reason: string;
}

export interface AntisymmetryCounterexample {
  a: number;
  b: number;
  a_vs_b: number;
  b_vs_a: number;
  reflexive: boolean;
}

export interface TransitivityCounterexample {
  a: number;
  b: number;
  c: number;
  a_vs_b: number;
  b_vs_c: number;
  a_vs_c: number;
}

export interface ComparatorVerificationReport {
  verdict: VerificationVerdict;
  values_checked: number;
  distinct_values_in_dataset: number;
  dataset_size: number;
  budget_exceeded: boolean;
  comparator_calls: number;
  total: PropertyResult<TotalityCounterexample>;
  deterministic: PropertyResult<DeterminismCounterexample>;
  antisymmetric: PropertyResult<AntisymmetryCounterexample>;
  transitive: PropertyResult<TransitivityCounterexample>;
  equivalence_transitive: PropertyResult<TransitivityCounterexample>;
}

export interface VerifyComparatorResult {
  ok: boolean;
  report?: ComparatorVerificationReport;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

export async function verifyComparator(
  problem: AuthoredSortProblem,
  budget: number = DEFAULT_VALUE_BUDGET
): Promise<VerifyComparatorResult> {
  const extraGlobals: Record<string, string> = {};
  let problemConstructionPython: string;
  try {
    problemConstructionPython = buildAnySortProblemConstructionPython(problem, extraGlobals);
  } catch (err) {
    return { ok: false, kind: 'internal', friendly_error: err instanceof Error ? err.message : String(err) };
  }

  // Clamped rather than trusted: the triple sweep is cubic, so an agent
  // passing 100000 here would hang the worker until the timeout instead of
  // answering. 200 values is ~8M triples -- slow but survivable, and a
  // deliberate ceiling beats an opaque timeout.
  const safeBudget = pyInt(budget, 2, 200);

  const python = `
import json
${problemConstructionPython}
${PY_VERIFY_COMPARATOR_HELPER}
${PY_SAFE_JSON_HELPER}
_report = _polyraptor_verify_comparator(problem, ${safeBudget})
json.dumps(_polyraptor_json_safe(_report))
`;

  // Untrusted path, always -- same reasoning as search's verifier. For a
  // python_problem both the comparator and data() are student code, and even a
  // built-in dataset is swept O(n^3) times, which is exactly where a bug turns
  // into a hang.
  const result = await runUntrusted(python, extraGlobals, VERIFY_TIMEOUT_MS);
  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { ok: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }
  return { ok: true, report: JSON.parse(result.result ?? '{}') as ComparatorVerificationReport };
}

// The values to mark on the bar canvas, tagged with the letters the card uses
// for them. Picks the FIRST violated law in the card's own row order rather
// than the most visually interesting one, so what is outlined always
// corresponds to the first red row a reader's eye lands on -- cherry-picking
// the 3-cycle because it draws better would leave the highlight unexplained by
// the row above it.
export function counterexampleMarks(report: ComparatorVerificationReport): { value: number; role: string }[] {
  const pair = (ce: { a: number; b: number }) => [
    { value: ce.a, role: 'a' },
    { value: ce.b, role: 'b' },
  ];
  const triple = (ce: TransitivityCounterexample) => [
    { value: ce.a, role: 'a' },
    { value: ce.b, role: 'b' },
    { value: ce.c, role: 'c' },
  ];
  if (report.total.counterexample) return pair(report.total.counterexample);
  if (report.deterministic.counterexample) return pair(report.deterministic.counterexample);
  if (report.antisymmetric.counterexample) return pair(report.antisymmetric.counterexample);
  if (report.transitive.counterexample) return triple(report.transitive.counterexample);
  if (report.equivalence_transitive.counterexample) return triple(report.equivalence_transitive.counterexample);
  return [];
}

// The one sentence to lead with. Kept next to the types it reads so the UI and
// the tool description can never drift into describing the same verdict
// differently -- the same reason search's summarizeVerdict lives beside its
// report type.
export function summarizeComparatorVerdict(report: ComparatorVerificationReport): string {
  if (report.verdict === 'refuted') {
    const failed: string[] = [];
    if (!report.total.holds) failed.push('it does not return a usable number for every pair');
    if (!report.deterministic.holds) failed.push('it is not deterministic');
    if (!report.antisymmetric.holds) failed.push('it is not antisymmetric');
    if (!report.transitive.holds) failed.push('it is not transitive');
    if (!report.equivalence_transitive.holds) failed.push('its "equal" relation is not transitive');
    return (
      `Refuted — ${failed.join('; ')}. A sort using this comparator can return a wrong answer ` +
      `without raising anything, and will still report is_sorted: true.`
    );
  }
  if (report.verdict === 'proven') {
    return (
      `Proven a strict weak ordering across all ${report.values_checked} distinct values in this dataset — ` +
      `enough to make sorting THIS dataset well-defined. It says nothing about values not in it.`
    );
  }
  return (
    `No counterexample found among ${report.values_checked} of this dataset's ` +
    `${report.distinct_values_in_dataset.toLocaleString()} distinct values, but the rest went unchecked — ` +
    `this does NOT prove the comparator is a valid ordering. Raise value_budget to close the gap.`
  );
}
