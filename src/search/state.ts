import { createStore } from '../shared/store';
import { storeTrace, type Trace } from '../shared/traceStore';
import type { AuthoredProblem, SearchTrace } from './types';

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
  if (!p) throw new Error(`Unknown problem_id: ${problemId}`);
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
  if (!a) throw new Error(`Unknown algorithm_id: ${id}`);
  return a;
}
