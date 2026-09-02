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

// Every run adds a trace and nothing ever removed one, which the activity log
// was already capped against for a much weaker version of the same reason --
// and a trace is orders of magnitude heavier than a log entry. Bubble sort on
// 300 elements emits ~89,700 event objects, so a session that benchmarks
// repeatedly (exactly what an agent driving this page does) grew the tab's
// memory without bound.
//
// Budgeted in EVENTS rather than traces, because the event objects are the
// actual resource and trace counts are a poor proxy for them. The two ends of
// the range are measured, not guessed: a 300-element bubble sort (the largest
// dataset sort_author_dataset will make) is ~89,700 events, so this holds four
// of those, while the 30-element default is ~900 and several hundred of those
// fit -- which is to say a teaching-scale session never evicts anything at
// all, and only the runs big enough to actually threaten the tab are bounded.
// Oldest go first, which is the right end to lose, and an agent holding an
// evicted trace_id gets getTrace's existing "call search_get_state /
// sort_get_state" error -- already the documented recovery path for an id it
// can no longer resolve.
const MAX_RETAINED_EVENTS = 400000;

export function storeTrace(trace: Trace): void {
  tracesStore.setState((prev) => {
    const next = { ...prev, [trace.trace_id]: trace };
    // Insertion order is the age order here: JS string keys iterate in
    // insertion order, and re-storing an existing trace_id keeps its original
    // position rather than moving it to the end -- but trace ids are minted
    // per run and never reused, so that case does not arise.
    let total = 0;
    for (const id of Object.keys(next)) total += next[id].entries.length;
    for (const id of Object.keys(next)) {
      if (total <= MAX_RETAINED_EVENTS) break;
      // The trace just stored is never evicted, however large it is: it is the
      // one about to be rendered, and dropping it would break the run that
      // produced it rather than an old one nobody is looking at.
      if (id === trace.trace_id) continue;
      total -= next[id].entries.length;
      delete next[id];
    }
    return next;
  });
}

export function updateTrace(traceId: string, updater: (t: Trace) => Trace): void {
  tracesStore.setState((prev) => {
    const existing = prev[traceId];
    if (!existing) return prev;
    return { ...prev, [traceId]: updater(existing) };
  });
}

export function getTrace(traceId: string): Trace {
  const t = peekTrace(traceId);
  if (!t)
    throw new Error(
      `Unknown trace_id: ${traceId}. Call search_get_state or sort_get_state to find the active trace_id.`
    );
  return t;
}

// The non-throwing form, for callers that run on a timer rather than on a
// caller's behalf: a playback interval firing against a trace that has since
// been evicted should stop itself, not throw once per tick into nobody's
// catch block. Every user- or agent-initiated lookup still uses getTrace, so
// a bad trace_id in a tool call keeps its explanatory error.
export function peekTrace(traceId: string): Trace | undefined {
  return tracesStore.getState()[traceId];
}
