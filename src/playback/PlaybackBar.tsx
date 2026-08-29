import { useSyncExternalStore } from 'react';
import { tracesStore } from '../search/state';
import { play, pause, step, jumpTo } from './playbackEngine';

// Human-facing controls over the same trace state the WebMCP playback_* tools
// drive — this is the "human and agent touch the same live state" surface:
// a human can drag this slider mid-animation while the agent is also calling
// playback_step, and both see the same result immediately.
export function PlaybackBar({ traceId }: { traceId: string }) {
  const traces = useSyncExternalStore(tracesStore.subscribe, tracesStore.getState);
  const trace = traces[traceId];
  if (!trace) return null;

  const maxSeq = trace.entries.length - 1;

  return (
    <div className="playback-bar">
      <button onClick={() => step(traceId, 'backward')} disabled={trace.currentSeq <= -1} title="Step back">⏮</button>
      <button onClick={() => (trace.playing ? pause(traceId) : play(traceId, trace.speed))}>
        {trace.playing ? '⏸ Pause' : '▶ Play'}
      </button>
      <button onClick={() => step(traceId, 'forward')} disabled={trace.currentSeq >= maxSeq} title="Step forward">⏭</button>
      <input
        type="range"
        min={-1}
        max={maxSeq}
        value={trace.currentSeq}
        onChange={(e) => jumpTo(traceId, Number(e.target.value))}
      />
      <span className="playback-position">
        {trace.currentSeq + 1} / {trace.entries.length}
      </span>
      <select value={trace.speed} onChange={(e) => play(traceId, Number(e.target.value))}>
        {[0.5, 1, 2, 4, 8].map((s) => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </div>
  );
}
