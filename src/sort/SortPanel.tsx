import { useState, useSyncExternalStore } from 'react';
import { problemsStore, activeProblemIdStore, activeTraceIdStore, putProblem, putTrace, newProblemId } from './state';
import { tracesStore } from '../shared/traceStore';
import { authorSortDataset, runSortAlgorithm } from './runAlgorithm';
import { BarArrayCanvas } from './BarArrayCanvas';
import { PlaybackBar } from '../playback/PlaybackBar';
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

  return (
    <div className="sort-panel">
      <div className="search-controls">
        <select value={datasetType} onChange={(e) => setDatasetType(e.target.value as SortDatasetType)}>
          {DATASETS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
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
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button onClick={handleRun} disabled={!activeProblem || running}>
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      {!activeProblem && (
        <p className="search-empty">
          Click "New Dataset", or ask your agent to author one (sort_author_dataset / sort_author_custom).
        </p>
      )}

      {activeProblem && <BarArrayCanvas problem={activeProblem} trace={activeTrace} />}

      {activeTrace && (
        <>
          <PlaybackBar traceId={activeTrace.trace_id} />
          <div className="search-summary">
            <strong>{activeTrace.algorithm}</strong> — {activeTrace.summary.comparisons} comparisons,{' '}
            {activeTrace.summary.swaps} swaps, {activeTrace.summary.is_sorted ? 'sorted correctly' : 'NOT sorted (bug?)'}
          </div>
        </>
      )}
    </div>
  );
}
