import { createStore } from '../shared/store';
import { storeTrace, type Trace } from '../shared/traceStore';
import type { AuthoredProblem, SearchTrace } from './types';
import type { VerificationReport } from './verifyHeuristic';

// Problems and "which trace is currently active" are inherently per-family —
// two families' panels are never both visible at once, but each needs its
// own notion of "active" so switching tabs and back doesn't leak one
// family's selection into another's. The underlying trace *data* is the
// shared concern (see ../shared/traceStore) since trace_ids are unique
// across families and playback doesn't care which family a trace came from.
export const problemsStore = createStore<Record<string, AuthoredProblem>>({});
export const activeProblemIdStore = createStore<string | null>(null);
export const activeTraceIdStore = createStore<string | null>(null);

let problemCounter = 0;
export function newProblemId(prefix: string): string {
  return `${prefix}-${++problemCounter}-${Date.now()}`;
}

export function putProblem(problem: AuthoredProblem) {
  problemsStore.setState((prev) => ({ ...prev, [problem.problem_id]: problem }));
  activeProblemIdStore.setState(problem.problem_id);
}

export function putTrace(trace: SearchTrace) {
  storeTrace(trace as unknown as Trace);
  activeTraceIdStore.setState(trace.trace_id);
}

export function getProblem(problemId: string): AuthoredProblem {
  const p = problemsStore.getState()[problemId];
  if (!p)
    throw new Error(
      `Unknown problem_id: ${problemId}. Call search_get_state to see which problems exist (the human may have created one), or author a new one.`
    );
  return p;
}

// Custom algorithms: no "active id" concept needed, unlike problems/traces —
// an algorithm has nothing to render standalone, it's only ever referenced
// by id when running it against some problem.
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
  if (!a)
    throw new Error(
      `Unknown algorithm_id: ${id}. Call search_get_state to list authored algorithm_ids and heuristic_ids.`
    );
  return a;
}

// The most recent heuristic verification, held in a store rather than merely
// returned to the caller so that an agent calling search_verify_heuristic
// paints the verdict -- and the counterexample state -- onto the board the
// human is already looking at. A tool that only answered the agent would make
// this the one feature in the app that DOESN'T demonstrate the shared-live-
// state thesis, which would be a strange thing for its best feature to do.
//
// `problem_id` is carried so a stale verdict from an earlier problem can be
// suppressed rather than shown against a board it doesn't describe -- the same
// hazard both panels already guard against for traces.
export interface StoredVerification {
  problem_id: string;
  heuristic_id: string | null;
  source_code: string;
  report: VerificationReport;
  at: number;
}

export const verificationStore = createStore<StoredVerification | null>(null);

export function setVerification(v: StoredVerification | null) {
  verificationStore.setState(v);
  // Bring the verified problem into view, the same way every authoring tool
  // already activates what it just created. Without this an agent could verify
  // problem X while the panel still displayed problem Y, and the verdict would
  // be correctly suppressed as stale -- so the agent would answer and the human
  // would see nothing at all, which is the exact failure this feature exists to
  // avoid. (Display still follows an active trace when there is one, per the
  // precedence established in 5de2f58.)
  if (v) activeProblemIdStore.setState(v.problem_id);
}
