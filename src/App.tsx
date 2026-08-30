import { useEffect, useState } from 'react';
import { initWebMcp } from './webmcp';
import { getPyodide } from './pyodide/bridge';
import { SearchPanel } from './search/SearchPanel';
import { SortPanel } from './sort/SortPanel';
import { EvolvePanel } from './evolve/EvolvePanel';
import { ToolCallLog } from './shared/ToolCallLog';

type Tab = 'search' | 'sort' | 'evolve';

export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const [webMcpStatus, setWebMcpStatus] = useState<{ available: boolean; toolCount: number } | null>(null);
  const [pyodideStatus, setPyodideStatus] = useState('Not loaded yet (loads on first algorithm run, or pre-warming now)...');

  useEffect(() => {
    setWebMcpStatus(initWebMcp());
    // Pre-warm Pyodide + both wheels on mount so the first tool call doesn't
    // eat a multi-second cold-start delay in the middle of a demo.
    getPyodide((msg) => setPyodideStatus(msg)).catch((err) => setPyodideStatus(`Failed to load Pyodide: ${err}`));
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>polyraptor</h1>
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
        <button className={tab === 'evolve' ? 'active' : ''} onClick={() => setTab('evolve')}>Evolve</button>
      </nav>

      <main className="app-main">
        <div className="app-content">
          {tab === 'search' && <SearchPanel />}
          {tab === 'sort' && <SortPanel />}
          {tab === 'evolve' && <EvolvePanel />}
        </div>
        <aside className="app-sidebar">
          <ToolCallLog />
        </aside>
      </main>
    </div>
  );
}
