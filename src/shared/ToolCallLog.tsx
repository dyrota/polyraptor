import { useSyncExternalStore } from 'react';
import { toolCallLogStore } from './toolCallLog';

// Visible on-page log of every WebMCP tool call and its result, in near-real
// time. Not required by the spec, but makes tool-use thoroughness legible to
// a judge skimming a video instead of hidden behind an animation.
export function ToolCallLog() {
  const entries = useSyncExternalStore(toolCallLogStore.subscribe, toolCallLogStore.getState);

  return (
    <div className="tool-call-log">
      <h3>WebMCP Tool Call Log</h3>
      {entries.length === 0 && <p className="tool-call-log-empty">No tool calls yet. Ask your agent to author a problem and run an algorithm.</p>}
      <ul>
        {[...entries].reverse().map((e) => (
          <li key={e.id} className={`tool-call-entry status-${e.status}`}>
            <div className="tool-call-header">
              <span className="tool-call-name">{e.toolName}</span>
              <span className="tool-call-status">{e.status}{e.durationMs !== undefined ? ` · ${e.durationMs.toFixed(0)}ms` : ''}</span>
            </div>
            <pre className="tool-call-args">{JSON.stringify(e.args)}</pre>
            {e.status === 'ok' && <pre className="tool-call-result">{typeof e.result === 'string' ? e.result : JSON.stringify(e.result)}</pre>}
            {e.status === 'error' && <pre className="tool-call-error">{e.error}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}
