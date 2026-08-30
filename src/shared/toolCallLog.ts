import { createStore } from './store';

export interface ToolCallLogEntry {
  id: string;
  timestamp: number;
  toolName: string;
  args: unknown;
  status: 'running' | 'ok' | 'error';
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export const toolCallLogStore = createStore<ToolCallLogEntry[]>([]);

let counter = 0;

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
    const id = `${toolName}-${++counter}`;
    const start = performance.now();
    toolCallLogStore.setState((prev) => [
      ...prev,
      { id, timestamp: Date.now(), toolName, args, status: 'running' },
    ]);
    try {
      const result = await fn(args);
      toolCallLogStore.setState((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, status: 'ok', result, durationMs: performance.now() - start }
            : e
        )
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolCallLogStore.setState((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, status: 'error', error: message, durationMs: performance.now() - start } : e
        )
      );
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
