import { createStore } from './store';

// The interleaved record of everything that happened to this page, from either
// side.
//
// This started as an agent-only tool-call log, which quietly undercut the
// thing the app exists to demonstrate. Every panel's buttons write to the same
// stores the WebMCP tools do, and the README calls that two-way sharing "the
// actual thesis of the project" -- but the one surface where that would be
// most legible showed only half of it. A human clicking "New Dataset" and an
// agent calling sort_author_dataset do the same thing to the same state, and
// until now only the second one left a trace. Interleaving both is what makes
// "a human and an agent can touch the same state at the same time" something
// you can watch rather than something the README claims.
export type Actor = 'agent' | 'human';
export type Family = 'search' | 'sort';

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  actor: Actor;
  // For an agent entry this is the WebMCP tool name; for a human entry, the
  // button they pressed. One field rather than two because the log's whole
  // point is that these are the same kind of event.
  label: string;
  // Human entries only. Every tool name already carries its family as a
  // prefix (sort_run_algorithm), but a button just says "Run" -- and with both
  // panels writing to one timeline, "Run" alone does not say which array or
  // maze moved.
  family?: Family;
  detail?: unknown;
  status: 'running' | 'ok' | 'error';
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export const activityLogStore = createStore<ActivityLogEntry[]>([]);

// The log is unbounded in principle and the playback_* tools make that real:
// an agent scrubbing a trace can call playback_step hundreds of times in a few
// seconds, each entry retaining its full result string. Capping keeps a long
// session from growing a list nobody scrolls to the bottom of anyway. Oldest
// go first, which is the right end to lose -- the interleaving being
// demonstrated is always the recent kind.
const MAX_ENTRIES = 300;

let counter = 0;

function start(actor: Actor, label: string, detail: unknown, family?: Family): { id: string; began: number } {
  const id = `${label}-${++counter}`;
  activityLogStore.setState((prev) => {
    const next = [...prev, { id, timestamp: Date.now(), actor, label, family, detail, status: 'running' as const }];
    return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  });
  return { id, began: performance.now() };
}

function finish(id: string, began: number, patch: Partial<ActivityLogEntry>) {
  activityLogStore.setState((prev) =>
    prev.map((e) => (e.id === id ? { ...e, ...patch, durationMs: performance.now() - began } : e))
  );
}

// Wraps a tool's execute() to log its call/result, without changing its
// contract. Every registered tool should be wrapped with this — it's what
// makes tool-use thoroughness visible on-page instead of hidden behind an
// animation (plan doc's "WebMCP Tool Call Log" addition).
// Result is always `string` in practice -- every real tool's execute()
// resolves with JSON.stringify(...), matching ToolDefinition['execute'].
export function logged<Args>(
  toolName: string,
  fn: (args: Args) => Promise<string>
): (args: Args) => Promise<string> {
  return async (args: Args) => {
    const { id, began } = start('agent', toolName, args);
    try {
      const result = await fn(args);
      finish(id, began, { status: 'ok', result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finish(id, began, { status: 'error', error: message });
      // Resolve rather than reject. Confirmed empirically: a thrown error
      // here is captured correctly in the human-facing log above, but by the
      // time a rejected promise reaches the calling agent it collapses to a
      // generic "invocation failed" with the specific message lost. Every
      // real tool needs the agent to actually read what went wrong (e.g.
      // "call search_author_maze first") so it can recover, not just learn
      // that something broke.
      return JSON.stringify({ error: true, message });
    }
  };
}

// Both of this codebase's result conventions for "the call completed but the
// thing failed": {ok: false, friendly_error} from the run/verify paths and
// {valid: false, friendly_error} from the author paths. A panel handler
// returns early on these rather than throwing, so without checking for them
// the log would cheerfully record a failed authoring attempt as 'ok' -- the
// one kind of dishonesty this log cannot afford, since a human debugging
// their own Python is exactly who it is for.
function failureMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (o.ok === false || o.valid === false) {
    return typeof o.friendly_error === 'string' ? o.friendly_error : 'failed';
  }
  return null;
}

// Records a human's click with the same lifecycle an agent's tool call gets --
// running, then ok/error with a duration -- so a long Pyodide run looks the
// same from either side. Rethrows rather than swallowing, unlike logged():
// panel handlers have their own catch and their own error UI, and swallowing
// here would break them.
export async function humanAction<T>(family: Family, label: string, detail: unknown, fn: () => Promise<T>): Promise<T> {
  const { id, began } = start('human', label, detail, family);
  try {
    const result = await fn();
    const failed = failureMessage(result);
    finish(id, began, failed ? { status: 'error', error: failed } : { status: 'ok' });
    return result;
  } catch (err) {
    finish(id, began, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// For a human action that completes instantly and so has no meaningful
// running state.
export function noteHumanAction(family: Family, label: string, detail?: unknown) {
  const { id, began } = start('human', label, detail, family);
  finish(id, began, { status: 'ok' });
}
