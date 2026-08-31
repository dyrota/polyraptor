import { useEffect, useRef, useSyncExternalStore } from 'react';
import { tracesStore } from './traceStore';

// Family-agnostic fallback view for any trace whose events don't match a
// known vocabulary closely enough for a bespoke canvas. Required for any
// custom search Problem -- a state's shape is opaque to JS (all we ever have
// is the student's source string, never structured spatial data the way a
// maze/board is), so no plumbing trick lets a bespoke canvas render it.
// Also a reasonable fallback for a custom algorithm's trace in any family.
//
// playbackEngine.ts needs zero changes to support this (confirmed by reading
// it directly): it already operates purely on entries.length/currentSeq with
// no awareness of event content, so play/pause/step/jump all keep working
// unchanged on a totally novel problem domain -- only this leaf-level
// rendering concern is new work.
// A trace is routinely far larger than anything worth putting in the DOM:
// bubble sort on 300 elements emits ~45,000 events, and a BFS over a 30x30
// maze is comparable. Rendering one node per entry froze the tab for seconds
// on exactly the traces custom code produces -- and this is the fallback view
// for ALL custom code. Only a window around the playhead is ever mounted,
// which is also all anyone can read while scrubbing; the count above the log
// keeps the true total visible.
const WINDOW_BEFORE = 60;
const WINDOW_AFTER = 40;

export function GenericTraceLog({ traceId }: { traceId: string }) {
  const traces = useSyncExternalStore(tracesStore.subscribe, tracesStore.getState);
  const trace = traces[traceId];
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [trace?.currentSeq]);

  if (!trace) return null;

  const total = trace.entries.length;
  const anchor = trace.currentSeq >= 0 ? trace.currentSeq : 0;
  const from = Math.max(0, anchor - WINDOW_BEFORE);
  const to = Math.min(total, anchor + WINDOW_AFTER);
  const visible = trace.entries.slice(from, to);

  return (
    <div className="generic-trace-log">
      {total === 0 && <div className="generic-trace-empty">No events recorded.</div>}
      {total > visible.length && (
        <div className="generic-trace-empty">
          showing events {from}–{to - 1} of {total}
        </div>
      )}
      {visible.map((entry) => {
        const { type, ...rest } = entry.event;
        const isCurrent = entry.seq === trace.currentSeq;
        return (
          <div
            key={entry.seq}
            ref={isCurrent ? currentRef : undefined}
            className={isCurrent ? 'generic-trace-entry current' : 'generic-trace-entry'}
          >
            <span className="generic-trace-seq">{entry.seq}</span>
            <span className="generic-trace-type">{String(type)}</span>
            <span className="generic-trace-rest">{JSON.stringify(rest)}</span>
          </div>
        );
      })}
    </div>
  );
}
