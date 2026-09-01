import { useEffect, useRef, useState } from 'react';
import { initWebMcp } from './webmcp';
import { getPyodide } from './pyodide/bridge';
import { SearchPanel } from './search/SearchPanel';
import { SortPanel } from './sort/SortPanel';
import { ActivityLog } from './shared/ActivityLog';
import { decodeSharedFromLocation, SHARE_KIND_TAB } from './shared/shareLink';

type Tab = 'search' | 'sort';

const TABS: { id: Tab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'sort', label: 'Sort' },
];

export default function App() {
  // Read once, at mount, and never again -- a shared link is a one-time
  // "arrive here with this pre-populated" affordance, not a live prop. Both
  // panels get the same object; each ignores it unless its kind belongs to
  // that family.
  const [sharedPayload] = useState(() => decodeSharedFromLocation());
  const [tab, setTab] = useState<Tab>(() => (sharedPayload ? SHARE_KIND_TAB[sharedPayload.kind] : 'search'));
  const [webMcpStatus, setWebMcpStatus] = useState<{ available: boolean; toolCount: number } | null>(null);
  const [pyodideStatus, setPyodideStatus] = useState('Not loaded yet (loads on first algorithm run, or pre-warming now)...');

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs and Home/End jump to the ends, per the
  // tablist pattern. Focus follows selection (rather than requiring a separate
  // Enter) because there are two tabs and switching is instant -- nothing is
  // lost by previewing a panel you arrowed onto.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const current = TABS.findIndex((t) => t.id === tab);
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

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

      {/* Real tab semantics, not two buttons that happen to look like tabs:
          without role/aria-selected a screen reader announces "Search, button"
          twice with nothing to say which one is showing.
          Declaring role="tablist" is a promise about keyboard behaviour, so
          the arrow/Home/End handling and the roving tabindex below are part of
          the fix, not an extra -- a tablist that announces itself as one and
          then ignores arrow keys leaves a keyboard user worse off than two
          plain buttons would have. */}
      <nav className="app-tabs" role="tablist" aria-label="Algorithm family">
        {TABS.map(({ id, label }, i) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            ref={(el) => { tabRefs.current[i] = el; }}
            aria-selected={tab === id}
            aria-controls="panel-family"
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            onKeyDown={onTabKeyDown}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        <div className="app-content" id="panel-family" role="tabpanel" aria-labelledby={tab === 'search' ? 'tab-search' : 'tab-sort'}>
          {tab === 'search' && <SearchPanel sharedPayload={sharedPayload} />}
          {tab === 'sort' && <SortPanel sharedPayload={sharedPayload} />}
        </div>
        <aside className="app-sidebar">
          <ActivityLog />
        </aside>
      </main>
    </div>
  );
}
