import { getTrace, updateTrace } from '../shared/traceStore';

const timers = new Map<string, ReturnType<typeof setInterval>>();
const BASE_INTERVAL_MS = 220; // per-step delay at speed=1

function clampSeq(seq: number, maxSeq: number): number {
  return Math.max(-1, Math.min(maxSeq, seq));
}

function stopTimer(traceId: string) {
  const handle = timers.get(traceId);
  if (handle) {
    clearInterval(handle);
    timers.delete(traceId);
  }
}

export function play(traceId: string, speed = 1): void {
  stopTimer(traceId);
  const clampedSpeed = Math.max(0.25, Math.min(8, speed));
  // Pressing play at the end of a finished trace used to set playing=true and
  // then pause on the very next tick, so the button visibly did nothing --
  // the one moment a viewer is most likely to press it. Rewind instead: "play
  // again" is the only sensible reading of play-at-the-end.
  const atEnd = getTrace(traceId).currentSeq >= getTrace(traceId).entries.length - 1;
  updateTrace(traceId, (t) => ({ ...t, playing: true, speed: clampedSpeed, currentSeq: atEnd ? -1 : t.currentSeq }));

  const interval = Math.max(15, BASE_INTERVAL_MS / clampedSpeed);
  const handle = setInterval(() => {
    const trace = getTrace(traceId);
    const maxSeq = trace.entries.length - 1;
    if (trace.currentSeq >= maxSeq) {
      pause(traceId);
      return;
    }
    updateTrace(traceId, (t) => ({ ...t, currentSeq: clampSeq(t.currentSeq + 1, maxSeq) }));
  }, interval);
  timers.set(traceId, handle);
}

export function pause(traceId: string): void {
  stopTimer(traceId);
  updateTrace(traceId, (t) => ({ ...t, playing: false }));
}

// Changing speed is not the same action as pressing play. The speed <select>
// called play() directly, so picking a new speed while paused silently
// started the animation running -- and picking one mid-play restarted the
// interval, which is right. This preserves whichever state the trace is
// already in.
export function setSpeed(traceId: string, speed: number): void {
  const clampedSpeed = Math.max(0.25, Math.min(8, speed));
  if (getTrace(traceId).playing) {
    play(traceId, clampedSpeed);
    return;
  }
  updateTrace(traceId, (t) => ({ ...t, speed: clampedSpeed }));
}

export function step(traceId: string, direction: 'forward' | 'backward' = 'forward', count = 1): void {
  stopTimer(traceId);
  const trace = getTrace(traceId);
  const maxSeq = trace.entries.length - 1;
  const delta = (direction === 'backward' ? -1 : 1) * Math.max(1, Math.floor(count));
  updateTrace(traceId, (t) => ({ ...t, playing: false, currentSeq: clampSeq(t.currentSeq + delta, maxSeq) }));
}

export function jumpTo(traceId: string, seq: number): void {
  stopTimer(traceId);
  const trace = getTrace(traceId);
  const maxSeq = trace.entries.length - 1;
  updateTrace(traceId, (t) => ({ ...t, playing: false, currentSeq: clampSeq(Math.floor(seq), maxSeq) }));
}

export interface PlaybackStateSummary {
  trace_id: string;
  current_seq: number;
  total_length: number;
  playing: boolean;
  speed: number;
  current_event: unknown;
}

export function getPlaybackState(traceId: string): PlaybackStateSummary {
  const trace = getTrace(traceId);
  const current = trace.currentSeq >= 0 ? trace.entries[trace.currentSeq]?.event ?? null : null;
  return {
    trace_id: traceId,
    current_seq: trace.currentSeq,
    total_length: trace.entries.length,
    playing: trace.playing,
    speed: trace.speed,
    current_event: current,
  };
}
