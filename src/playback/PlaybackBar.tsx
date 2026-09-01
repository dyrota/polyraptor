import { useSyncExternalStore } from 'react';
import { tracesStore } from '../shared/traceStore';
import { play, pause, step, jumpTo, setSpeed } from './playbackEngine';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

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
      {/* aria-label as well as title: the glyph alone is the entire label
          otherwise, and "⏮" is not a word. */}
      <button onClick={() => step(traceId, 'backward')} disabled={trace.currentSeq <= -1} title="Step back" aria-label="Step back one event">⏮</button>
      <button onClick={() => (trace.playing ? pause(traceId) : play(traceId, trace.speed))}>
        {trace.playing ? '⏸ Pause' : '▶ Play'}
      </button>
      <button onClick={() => step(traceId, 'forward')} disabled={trace.currentSeq >= maxSeq} title="Step forward" aria-label="Step forward one event">⏭</button>
      <input
        type="range"
        min={-1}
        max={maxSeq}
        value={trace.currentSeq}
        onChange={(e) => jumpTo(traceId, Number(e.target.value))}
        aria-label="Playback position"
        // The raw value is a seq index counting from -1, which is meaningless
        // read aloud; this is the same "n of m" the readout beside it shows.
        aria-valuetext={`event ${trace.currentSeq + 1} of ${trace.entries.length}`}
      />
      <span className="playback-position">
        {trace.currentSeq + 1} / {trace.entries.length}
      </span>
      {/* setSpeed, not play: picking a speed while paused should not start the
          animation. The option list also includes any speed an agent set via
          playback_play that isn't one of the presets (the engine accepts
          0.25-8), so the control never renders blank on a value it can't show. */}
      <select value={trace.speed} onChange={(e) => setSpeed(traceId, Number(e.target.value))} aria-label="Playback speed">
        {(SPEEDS.includes(trace.speed) ? SPEEDS : [...SPEEDS, trace.speed].sort((a, b) => a - b)).map((s) => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </div>
  );
}
