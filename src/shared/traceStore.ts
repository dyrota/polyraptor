import { createStore } from './store';

// Generic trace store shared by every family — playback only ever needs
// entries/currentSeq/playing/speed, not which family a trace belongs to.
// Each family's own types.ts defines a more specific Trace shape (e.g.
// SearchTrace, with a concrete algorithm union and summary type); those
// stay structurally compatible with this generic shape, so a family's
// putTrace() wrapper can hand its own trace object to storeTrace() here
// without this module needing to know anything family-specific.
export interface TraceEntry {
  seq: number;
  event: Record<string, unknown> & { type: string };
}

export interface Trace<TSummary = unknown> {
  trace_id: string;
  problem_id: string;
  algorithm: string;
  entries: TraceEntry[];
  summary: TSummary;
  currentSeq: number;
  playing: boolean;
  speed: number;
}

export const tracesStore = createStore<Record<string, Trace>>({});

export function storeTrace(trace: Trace): void {
  tracesStore.setState((prev) => ({ ...prev, [trace.trace_id]: trace }));
}

export function updateTrace(traceId: string, updater: (t: Trace) => Trace): void {
  tracesStore.setState((prev) => {
    const existing = prev[traceId];
    if (!existing) return prev;
    return { ...prev, [traceId]: updater(existing) };
  });
}

export function getTrace(traceId: string): Trace {
  const t = tracesStore.getState()[traceId];
  if (!t) throw new Error(`Unknown trace_id: ${traceId}`);
  return t;
}
