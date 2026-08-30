// Main-thread controller for the untrusted-code worker (worker.ts). Separate
// from bridge.ts's trusted, unbounded main-thread path on purpose -- see the
// plan doc's "two execution paths" decision. Handles lifecycle (lazy
// singleton, reused across calls), a FIFO queue for overlapping calls
// (Pyodide execution is single-threaded per instance regardless, so this
// matches reality rather than fighting it), the 8-second timeout with clean
// terminate()+respawn (proven safe by the phase0-check5 spike), and a race
// guard against stale messages from an already-terminated worker.
import { translateError, timeoutError, stoppedByUserError, type FriendlyError } from './friendlyErrors';

const DEFAULT_TIMEOUT_MS = 8000;

export interface WorkerRunResult {
  ok: boolean;
  result?: string;
  events: string[]; // JSON-string on_step payloads, in order
  error?: FriendlyError;
}

let worker: Worker | null = null;
let activeRunId: string | null = null;
let runCounter = 0;
let queue: Promise<unknown> = Promise.resolve();
// Set by whichever runOnce() call is currently in flight, so forceStop() can
// settle *that specific call's* promise immediately. Without this, an early
// forceStop only killed the worker -- the pending promise still didn't
// resolve until the original timer eventually fired on its own schedule, so
// a human's "Stop" click wouldn't visibly do anything until up to 8s later.
let stopCurrentRun: (() => void) | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function respawnWorker() {
  worker?.terminate();
  worker = null;
}

// Exposed so a human can kill their own visible infinite loop immediately
// rather than waiting out the full timeout.
export function forceStop(): void {
  stopCurrentRun?.();
}

function runOnce(python: string, extraGlobals: Record<string, string> | undefined, timeoutMs: number): Promise<WorkerRunResult> {
  return new Promise((resolve) => {
    const id = `run-${++runCounter}`;
    activeRunId = id;
    const events: string[] = [];
    const w = getWorker();

    let settled = false;
    const finish = (result: WorkerRunResult) => {
      if (settled || activeRunId !== id) return; // stale -- already timed out/stopped and moved on
      settled = true;
      stopCurrentRun = null;
      w.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.id !== id) return; // stale message from a prior run
      if (data.type === 'on_step') {
        events.push(data.payload);
      } else if (data.type === 'result') {
        finish({ ok: true, result: data.payload, events });
      } else if (data.type === 'error') {
        finish({ ok: false, error: translateError(data.payload.rawMessage, data.payload.rawTraceback), events });
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      activeRunId = null;
      stopCurrentRun = null;
      respawnWorker(); // fresh worker for next call; this one may still be looping
      resolve({ ok: false, error: timeoutError(timeoutMs), events });
    }, timeoutMs);

    // Distinct from `finish`: this is an authoritative "stop THIS run now"
    // action, not a message that might be stale, so it settles directly
    // rather than going through finish()'s activeRunId-match check (which
    // would otherwise bail once forceStop has already cleared activeRunId).
    stopCurrentRun = () => {
      if (settled) return;
      settled = true;
      activeRunId = null;
      stopCurrentRun = null;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      respawnWorker();
      resolve({ ok: false, error: stoppedByUserError(), events });
    };

    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'run', id, python, extraGlobals });
  });
}

// Queues so a human clicking "Run" at the same moment an agent calls a
// custom-run tool serializes rather than fails -- the worker can only run
// one thing at a time anyway.
export function runUntrusted(
  python: string,
  extraGlobals?: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<WorkerRunResult> {
  const result = queue.then(() => runOnce(python, extraGlobals, timeoutMs));
  queue = result.catch(() => {});
  return result;
}
