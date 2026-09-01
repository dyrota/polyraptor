import { useState, useSyncExternalStore } from 'react';
import { activityLogStore, type Actor } from './activityLog';

// Visible on-page record of everything that touched this page, from either
// side, in near-real time. Agent tool calls and human clicks are rendered as
// the same kind of event on one timeline, distinguished by a badge rather than
// separated into two lists -- separating them would lose the interleaving,
// which is the only thing here that a screenshot of two independent panels
// could not also show.

type Filter = 'all' | Actor;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'human', label: 'You' },
  { key: 'agent', label: 'Agent' },
];

function fmtDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return text === '{}' ? null : text;
}

// A tool result can be a whole 30x30 maze. Before both actors shared this
// panel that only cost some scrolling; now it pushes the human's own entries
// off the screen, which defeats the point of interleaving them. The agent
// receives the untruncated result through the tool's return value -- this
// panel is for the person watching.
const MAX_RESULT_CHARS = 400;

function fmtResult(result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  if (!text) return '';
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (${text.length.toLocaleString()} chars)` : text;
}

export function ActivityLog() {
  const entries = useSyncExternalStore(activityLogStore.subscribe, activityLogStore.getState);
  const [filter, setFilter] = useState<Filter>('all');

  const shown = filter === 'all' ? entries : entries.filter((e) => e.actor === filter);
  const humanCount = entries.filter((e) => e.actor === 'human').length;
  const agentCount = entries.length - humanCount;

  return (
    <div className="activity-log">
      <h3>Activity</h3>
      <div className="activity-filter">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
            {f.label}
            {f.key === 'human' && humanCount > 0 && ` (${humanCount})`}
            {f.key === 'agent' && agentCount > 0 && ` (${agentCount})`}
          </button>
        ))}
      </div>

      {entries.length === 0 && (
        <p className="activity-log-empty">
          Nothing yet. Click a button, or ask your agent to author a problem and run an algorithm — both land here.
        </p>
      )}
      {entries.length > 0 && shown.length === 0 && (
        <p className="activity-log-empty">Nothing from {filter === 'human' ? 'you' : 'the agent'} yet.</p>
      )}

      <ul>
        {[...shown].reverse().map((e) => {
          const detail = fmtDetail(e.detail);
          return (
            <li key={e.id} className={`activity-entry actor-${e.actor} status-${e.status}`}>
              <div className="activity-header">
                <span className="activity-actor">{e.actor === 'human' ? 'you' : 'agent'}</span>
                <span className="activity-name">{e.label}</span>
                <span className="activity-status">
                  {e.status}
                  {e.durationMs !== undefined ? ` · ${e.durationMs.toFixed(0)}ms` : ''}
                </span>
              </div>
              {detail && <pre className="activity-detail">{detail}</pre>}
              {/* A tool result is what the agent actually saw, so it is worth
                  showing verbatim. A human's result went to the canvas they are
                  already looking at, and repeating it here would just be noise. */}
              {e.actor === 'agent' && e.status === 'ok' && <pre className="activity-result">{fmtResult(e.result)}</pre>}
              {e.status === 'error' && <pre className="activity-error">{e.error}</pre>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
