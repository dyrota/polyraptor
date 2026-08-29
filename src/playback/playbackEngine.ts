import { getTrace, updateTrace } from '../search/state';

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
  updateTrace(traceId, (t) => ({ ...t, playing: true, speed: clampedSpeed }));

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
