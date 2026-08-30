// Keeps trace-management (seq stamping, storage keyed by trace_id) entirely in
// app code — per the plan doc, the libraries' on_step contract stays a plain
// "call this callback with a dict, or don't," with no seq/bookkeeping baked
// into polysearch/polysort themselves. Family-agnostic: each family narrows
// the loosely-typed event to its own discriminated union at the point of use
// (e.g. `as unknown as SearchEvent` / `as unknown as SortEvent`) — the same
// "unknown at the boundary" principle already used for the Pyodide boundary.

let traceCounter = 0;

export function newTraceId(prefix: string): string {
  return `${prefix}-${++traceCounter}-${Date.now()}`;
}

export interface RawTraceEntry {
  seq: number;
  event: Record<string, unknown> & { type: string };
}

export function makeCollector(): {
  entries: RawTraceEntry[];
  collect: (eventDict: Record<string, unknown>) => void;
} {
  const entries: RawTraceEntry[] = [];
  let seq = 0;
  return {
    entries,
    collect: (eventDict: Record<string, unknown>) => {
      entries.push({ seq: seq++, event: eventDict as Record<string, unknown> & { type: string } });
    },
  };
}
