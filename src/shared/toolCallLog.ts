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
export function logged<Args, Result>(
  toolName: string,
  fn: (args: Args) => Promise<Result>
): (args: Args) => Promise<Result> {
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
      toolCallLogStore.setState((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
                durationMs: performance.now() - start,
              }
            : e
        )
      );
      throw err;
    }
  };
}
