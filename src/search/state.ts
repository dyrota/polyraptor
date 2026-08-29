import { createStore } from '../shared/store';
import type { AuthoredProblem, SearchTrace } from './types';

export const problemsStore = createStore<Record<string, AuthoredProblem>>({});
export const tracesStore = createStore<Record<string, SearchTrace>>({});
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
  tracesStore.setState((prev) => ({ ...prev, [trace.trace_id]: trace }));
  activeTraceIdStore.setState(trace.trace_id);
}

export function updateTrace(traceId: string, updater: (t: SearchTrace) => SearchTrace) {
  tracesStore.setState((prev) => {
    const existing = prev[traceId];
    if (!existing) return prev;
    return { ...prev, [traceId]: updater(existing) };
  });
}

export function getProblem(problemId: string): AuthoredProblem {
  const p = problemsStore.getState()[problemId];
  if (!p) throw new Error(`Unknown problem_id: ${problemId}`);
  return p;
}

export function getTrace(traceId: string): SearchTrace {
  const t = tracesStore.getState()[traceId];
  if (!t) throw new Error(`Unknown trace_id: ${traceId}`);
  return t;
}
