import type { SearchEvent, SearchTraceEntry } from '../search/types';

// Keeps trace-management (seq stamping, storage keyed by trace_id) entirely in
// app code — per the plan doc, the libraries' on_step contract stays a plain
// "call this callback with a dict, or don't," with no seq/bookkeeping baked
// into polysearch/polysort themselves.

let traceCounter = 0;

export function newTraceId(prefix: string): string {
  return `${prefix}-${++traceCounter}-${Date.now()}`;
}

export function makeCollector(): {
  entries: SearchTraceEntry[];
  collect: (eventDict: Record<string, unknown>) => void;
} {
  const entries: SearchTraceEntry[] = [];
  let seq = 0;
  return {
    entries,
    collect: (eventDict: Record<string, unknown>) => {
      entries.push({ seq: seq++, event: eventDict as unknown as SearchEvent });
    },
  };
}
