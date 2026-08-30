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
export function GenericTraceLog({ traceId }: { traceId: string }) {
  const traces = useSyncExternalStore(tracesStore.subscribe, tracesStore.getState);
  const trace = traces[traceId];
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [trace?.currentSeq]);

  if (!trace) return null;

  return (
    <div className="generic-trace-log">
      {trace.entries.length === 0 && <div className="generic-trace-empty">No events recorded.</div>}
      {trace.entries.map((entry) => {
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
