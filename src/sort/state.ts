import { createStore } from '../shared/store';
import { storeTrace, type Trace } from '../shared/traceStore';
import type { AuthoredSortProblem, SortTrace } from './types';

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
  if (!p) throw new Error(`Unknown problem_id: ${problemId}`);
  return p;
}
