import { createStore } from '../shared/store';
import { storeTrace, tracesStore, type Trace } from '../shared/traceStore';
import type { AuthoredSortProblem, SortTrace } from './types';
import type { ComparatorVerificationReport } from './verifyComparator';

// Mirrors search/state.ts exactly — see that file's comment for why problems
// and "active" ids are per-family while the underlying trace store is shared.
export const problemsStore = createStore<Record<string, AuthoredSortProblem>>({});
export const activeProblemIdStore = createStore<string | null>(null);
export const activeTraceIdStore = createStore<string | null>(null);

let problemCounter = 0;
export function newProblemId(prefix: string): string {
  return `${prefix}-${++problemCounter}-${Date.now()}`;
}

export function putProblem(problem: AuthoredSortProblem) {
  problemsStore.setState((prev) => ({ ...prev, [problem.problem_id]: problem }));
  activeProblemIdStore.setState(problem.problem_id);
}

export function putTrace(trace: SortTrace) {
  storeTrace(trace as unknown as Trace);
  activeTraceIdStore.setState(trace.trace_id);
}

export function getProblem(problemId: string): AuthoredSortProblem {
  const p = problemsStore.getState()[problemId];
  if (!p)
    throw new Error(
      `Unknown problem_id: ${problemId}. Call sort_get_state to see which problems exist (the human may have created one), or author a new one.`
    );
  return p;
}

// Mirrors search/state.ts's algorithm storage exactly -- no "active id"
// concept needed, an algorithm is only ever referenced by id at run time.
export const algorithmsStore = createStore<Record<string, { source_code: string }>>({});

let algorithmCounter = 0;
export function newAlgorithmId(prefix: string): string {
  return `${prefix}-${++algorithmCounter}-${Date.now()}`;
}

export function putAlgorithm(id: string, sourceCode: string) {
  algorithmsStore.setState((prev) => ({ ...prev, [id]: { source_code: sourceCode } }));
}

export function getAlgorithm(id: string): { source_code: string } {
  const a = algorithmsStore.getState()[id];
  if (!a) throw new Error(`Unknown algorithm_id: ${id}. Call sort_get_state to list authored algorithm_ids.`);
  return a;
}

// The most recent comparator verification. Held in a store rather than merely
// returned to the caller for the same reason search/state.ts holds its own:
// a tool that only answered the agent would make verification the one feature
// in the app that DOESN'T demonstrate the shared-live-state thesis, and the
// human would have no way to see the verdict the agent just obtained about the
// dataset in front of them.
//
// `problem_id` is carried so a stale verdict from an earlier problem can be
// suppressed rather than shown against a dataset it doesn't describe.
export interface StoredComparatorVerification {
  problem_id: string;
  report: ComparatorVerificationReport;
  at: number;
}

export const verificationStore = createStore<StoredComparatorVerification | null>(null);

export function setVerification(v: StoredComparatorVerification | null) {
  verificationStore.setState(v);
  if (!v) return;
  // Bring the verified problem into view -- otherwise an agent could verify
  // problem X while the panel still showed problem Y, the verdict would be
  // correctly suppressed as stale, and the human would see nothing at all.
  activeProblemIdStore.setState(v.problem_id);
  // Setting the id alone is NOT enough, which is subtle enough to be worth
  // spelling out: the panel derives its displayed problem from the active
  // TRACE first (a trace must always be drawn against the values it actually
  // ran on), and only falls back to this id when nothing has been run. So a
  // trace left over from a different problem outranks the line above, the
  // verdict gets suppressed as stale, and the tool call silently paints
  // nothing -- the exact failure this function exists to prevent. A trace of
  // another problem cannot be displayed against this one anyway, so it is
  // dropped rather than left to win.
  const activeTraceId = activeTraceIdStore.getState();
  const activeTrace = activeTraceId ? tracesStore.getState()[activeTraceId] : null;
  if (activeTrace && activeTrace.problem_id !== v.problem_id) activeTraceIdStore.setState(null);
}
