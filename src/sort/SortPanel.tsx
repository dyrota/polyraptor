import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { problemsStore, activeProblemIdStore, activeTraceIdStore, putProblem, putTrace, newProblemId } from './state';
import { tracesStore } from '../shared/traceStore';
import { authorSortDataset, runSortAlgorithm } from './runAlgorithm';
import { authorPythonSortProblem, runAlgorithmOnPythonSortProblem } from './runPythonProblem';
import { authorPythonSortAlgorithm, runPythonAlgorithmOnProblem } from './runPythonAlgorithm';
import { forceStop } from '../pyodide/workerBridge';
import { BarArrayCanvas } from './BarArrayCanvas';
import { PlaybackBar } from '../playback/PlaybackBar';
import { PythonEditor } from '../shared/PythonEditor';
import { SORT_PROBLEM_TEMPLATE, SORT_ALGORITHM_TEMPLATE } from './pythonTemplates';
import type { SortAlgorithm, SortDatasetType, SortTrace } from './types';

const ALGORITHMS: SortAlgorithm[] = [
  'bubble_sort',
  'selection_sort',
  'insertion_sort',
  'merge_sort',
  'quick_sort',
  'heap_sort',
  'counting_sort',
  'radix_sort',
  'shell_sort',
  'tim_sort',
];

const DATASETS: SortDatasetType[] = ['random_integers', 'nearly_sorted', 'reverse_sorted', 'many_duplicates'];

// Mirrors SearchPanel.tsx exactly — human buttons and the sort_* WebMCP tools
// read/write the same store, same "shared live state" point as search.
export function SortPanel() {
  const problems = useSyncExternalStore(problemsStore.subscribe, problemsStore.getState);
  const traces = useSyncExternalStore(tracesStore.subscribe, tracesStore.getState);
  const activeProblemId = useSyncExternalStore(activeProblemIdStore.subscribe, activeProblemIdStore.getState);
  const activeTraceId = useSyncExternalStore(activeTraceIdStore.subscribe, activeTraceIdStore.getState);
  const [datasetType, setDatasetType] = useState<SortDatasetType>('random_integers');
  const [size, setSize] = useState(30);
  const [algorithm, setAlgorithm] = useState<SortAlgorithm>('bubble_sort');
  const [running, setRunning] = useState(false);

  // Mode toggle: local UI state only. It controls WHICH INPUT CONTROLS are
  // shown -- it must never gate the result area below (canvas/log/playback/
  // summary), which stays driven unconditionally by the real store state. If
  // an agent authors and runs Python code while a human's toggle happens to
  // sit on "Built-in", the human must still see it happen immediately.
  const [mode, setMode] = useState<'builtin' | 'python'>('builtin');
  // Sub-mode within "write your own": author a Problem, or author an
  // Algorithm to run against whatever problem is currently active.
  const [pythonSubMode, setPythonSubMode] = useState<'problem' | 'algorithm'>('problem');
  const [pythonSource, setPythonSource] = useState(SORT_PROBLEM_TEMPLATE);
  const [pythonAlgorithmSource, setPythonAlgorithmSource] = useState(SORT_ALGORITHM_TEMPLATE);
  const [pythonError, setPythonError] = useState<{ friendly_error: string; raw_traceback?: string } | null>(null);
  const [showRawTraceback, setShowRawTraceback] = useState(false);
  const [pythonRunning, setPythonRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const runStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pythonRunning) return;
    runStartRef.current = performance.now();
    const interval = setInterval(() => {
      if (runStartRef.current !== null) setElapsedMs(performance.now() - runStartRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [pythonRunning]);

  const activeTrace = (activeTraceId ? traces[activeTraceId] : null) as SortTrace | null;
  // Always show the problem the active trace actually ran on, not just
  // whatever was last authored — sort_run_algorithm takes an explicit
  // problem_id and can target an older problem than the most recently
  // authored one, which would otherwise show a mismatched array. Falls back
  // to the last-authored problem when nothing has been run yet.
  const activeProblem = activeTrace ? problems[activeTrace.problem_id] : activeProblemId ? problems[activeProblemId] : null;

  async function handleNewDataset() {
    const { values } = await authorSortDataset({ dataset_type: datasetType, size });
    putProblem({ problem_id: newProblemId('sort'), dataset_type: datasetType, size: values.length, values });
  }

  async function handleRun() {
    if (!activeProblem) return;
    setRunning(true);
    try {
      const trace = await runSortAlgorithm(activeProblem, algorithm);
      putTrace(trace);
    } finally {
      setRunning(false);
    }
  }

  // Human "Run" does validate-then-run as one click -- same two underlying
  // calls the separate WebMCP tools perform, just sequenced smoother for a
  // person than making them click twice.
  async function handlePythonRun() {
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      const authored = await authorPythonSortProblem(pythonSource);
      if (!authored.valid) {
        setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
        return;
      }
      const problemId = newProblemId('sort-py');
      const problem = {
        problem_id: problemId,
        dataset_type: 'python_problem' as const,
        size: authored.size!,
        values: authored.values!,
        source_code: pythonSource,
      };
      putProblem(problem);
      const result = await runAlgorithmOnPythonSortProblem(problem, algorithm);
      if (!result.ok) {
        setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
        return;
      }
      putTrace(result.trace!);
    } finally {
      setPythonRunning(false);
    }
  }

  async function handlePythonAlgorithmRun() {
    if (!activeProblem) return;
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      const authored = await authorPythonSortAlgorithm(pythonAlgorithmSource);
      if (!authored.valid) {
        setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
        return;
      }
      const result = await runPythonAlgorithmOnProblem(activeProblem, pythonAlgorithmSource);
      if (!result.ok) {
        setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
        if (result.trace) putTrace(result.trace);
        return;
      }
      putTrace(result.trace!);
    } finally {
      setPythonRunning(false);
    }
  }

  function handleStop() {
    forceStop();
    setPythonRunning(false);
  }

  return (
    <div className="sort-panel">
      <div className="mode-toggle">
        <button className={mode === 'builtin' ? 'active' : ''} onClick={() => setMode('builtin')}>Built-in</button>
        <button className={mode === 'python' ? 'active' : ''} onClick={() => setMode('python')}>Write your own</button>
      </div>

      {mode === 'builtin' && (
        <div className="search-controls">
          <select value={datasetType} onChange={(e) => setDatasetType(e.target.value as SortDatasetType)}>
            {DATASETS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <input
            type="number"
            min={5}
            max={300}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={{ width: '4.5rem' }}
          />
          <button onClick={handleNewDataset}>New Dataset</button>
          <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as SortAlgorithm)}>
            {ALGORITHMS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button onClick={handleRun} disabled={!activeProblem || running}>
            {running ? 'Running...' : 'Run'}
          </button>
        </div>
      )}

      {mode === 'python' && (
        <div className="python-authoring">
          <div className="mode-toggle sub-toggle">
            <button className={pythonSubMode === 'problem' ? 'active' : ''} onClick={() => setPythonSubMode('problem')}>Problem</button>
            <button className={pythonSubMode === 'algorithm' ? 'active' : ''} onClick={() => setPythonSubMode('algorithm')}>Algorithm</button>
          </div>

          {pythonSubMode === 'problem' && (
            <>
              <PythonEditor value={pythonSource} onChange={setPythonSource} readOnly={pythonRunning} />
              <div className="search-controls">
                <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as SortAlgorithm)}>
                  {ALGORITHMS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <button onClick={handlePythonRun} disabled={pythonRunning}>
                  {pythonRunning ? `Running... (${(elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run'}
                </button>
                {pythonRunning && <button onClick={handleStop}>Stop</button>}
              </div>
            </>
          )}

          {pythonSubMode === 'algorithm' && (
            <>
              <PythonEditor value={pythonAlgorithmSource} onChange={setPythonAlgorithmSource} readOnly={pythonRunning} />
              <div className="search-controls">
                <button onClick={handlePythonAlgorithmRun} disabled={pythonRunning || !activeProblem}>
                  {pythonRunning ? `Running... (${(elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run against active problem'}
                </button>
                {pythonRunning && <button onClick={handleStop}>Stop</button>}
                {!activeProblem && <span className="search-empty">Author or select a problem first.</span>}
              </div>
            </>
          )}

          {pythonError && (
            <div className="python-error">
              <div className="python-error-message">{pythonError.friendly_error}</div>
              {pythonError.raw_traceback && (
                <>
                  <button className="python-error-toggle" onClick={() => setShowRawTraceback((s) => !s)}>
                    {showRawTraceback ? 'Hide details' : 'Show details'}
                  </button>
                  {showRawTraceback && <pre className="python-error-traceback">{pythonError.raw_traceback}</pre>}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!activeProblem && (
        <p className="search-empty">
          Click "New Dataset" or write your own Problem class, or ask your agent to author one
          (sort_author_dataset / sort_author_custom / sort_author_python_problem).
        </p>
      )}

      {activeProblem && <BarArrayCanvas problem={activeProblem} trace={activeTrace} />}

      {activeTrace && (
        <>
          <PlaybackBar traceId={activeTrace.trace_id} />
          <div className="search-summary">
            <strong>{activeTrace.algorithm}</strong> —{' '}
            {activeTrace.summary.is_sorted !== undefined ? (
              <>{activeTrace.summary.comparisons} comparisons, {activeTrace.summary.swaps} swaps, {activeTrace.summary.is_sorted ? 'sorted correctly' : 'NOT sorted (bug?)'}</>
            ) : (
              <>returned {JSON.stringify(activeTrace.summary.raw_return_value)}, events: {Object.entries(activeTrace.summary.event_type_counts ?? {}).map(([t, c]) => `${t}:${c}`).join(', ') || 'none'}</>
            )}
          </div>
        </>
      )}
    </div>
  );
}
