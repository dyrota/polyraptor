import { useEffect, useState } from 'react';
import { initWebMcp } from './webmcp';
import { getPyodide } from './pyodide/bridge';
import { SearchPanel } from './search/SearchPanel';
import { SortPanel } from './sort/SortPanel';
import { ToolCallLog } from './shared/ToolCallLog';
import { decodeSharedFromLocation, SHARE_KIND_TAB } from './shared/shareLink';

type Tab = 'search' | 'sort';

export default function App() {
  // Read once, at mount, and never again -- a shared link is a one-time
  // "arrive here with this pre-populated" affordance, not a live prop. Both
  // panels get the same object; each ignores it unless its kind belongs to
  // that family.
  const [sharedPayload] = useState(() => decodeSharedFromLocation());
  const [tab, setTab] = useState<Tab>(() => (sharedPayload ? SHARE_KIND_TAB[sharedPayload.kind] : 'search'));
  const [webMcpStatus, setWebMcpStatus] = useState<{ available: boolean; toolCount: number } | null>(null);
  const [pyodideStatus, setPyodideStatus] = useState('Not loaded yet (loads on first algorithm run, or pre-warming now)...');

  useEffect(() => {
    setWebMcpStatus(initWebMcp());
    // Pre-warm Pyodide + both wheels on mount so the first tool call doesn't
    // eat a multi-second cold-start delay in the middle of a demo.
    getPyodide((msg) => setPyodideStatus(msg)).catch((err) => setPyodideStatus(`Failed to load Pyodide: ${err}`));
  }, []);

  useEffect(() => {
    // Strip `?shared=...` from the visible URL once consumed -- reloading
    // shouldn't keep re-populating over a human's subsequent edits, and a
    // later "Copy share link" click should produce a clean new URL rather
    // than accumulating query params.
    if (sharedPayload) {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState(null, '', url);
    }
  }, [sharedPayload]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>
          <span className="brand-mark" aria-hidden="true">🦖</span>
          poly<span className="brand-name-accent">raptor</span>
        </h1>
        <p className="app-subtitle">Algorithms you can watch — and that an agent can drive, live, on the exact page you're looking at.</p>
        <div className="status-bar">
          <span className={webMcpStatus?.available ? 'status-ok' : 'status-warn'}>
            WebMCP: {webMcpStatus === null ? 'checking...' : webMcpStatus.available ? `${webMcpStatus.toolCount} tools registered` : 'not available in this browser'}
          </span>
          <span className="status-neutral">Pyodide: {pyodideStatus}</span>
        </div>
      </header>

      <nav className="app-tabs">
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Search</button>
        <button className={tab === 'sort' ? 'active' : ''} onClick={() => setTab('sort')}>Sort</button>
      </nav>

      <main className="app-main">
        <div className="app-content">
          {tab === 'search' && <SearchPanel sharedPayload={sharedPayload} />}
          {tab === 'sort' && <SortPanel sharedPayload={sharedPayload} />}
        </div>
        <aside className="app-sidebar">
          <ToolCallLog />
        </aside>
      </main>
    </div>
  );
}
