import { useState, useSyncExternalStore } from 'react';
import { problemsStore, activeProblemIdStore, activeTraceIdStore, putProblem, putTrace, newProblemId } from './state';
import { tracesStore } from '../shared/traceStore';
import { generateMaze } from './mazeGenerator';
import { runSearchAlgorithm } from './runAlgorithm';
import { MazeCanvas } from './MazeCanvas';
import { NQueensBoard } from './NQueensBoard';
import { MissionariesView } from './MissionariesView';
import { PlaybackBar } from '../playback/PlaybackBar';
import type { SearchAlgorithm, SearchTrace } from './types';

const ALGORITHMS: SearchAlgorithm[] = [
  'a_star',
  'best_first',
  'branch_and_bound',
  'breadth_first',
  'depth_first',
  'hill_climbing',
  'iterative_deepening',
  'uniform_cost',
];

// This panel is deliberately usable by a human directly (New Maze / Run
// buttons) AND by an agent via the search_*/playback_* WebMCP tools, both
// reading and writing the exact same store -- that shared-live-state loop is
// the point of the whole project, not just an agent-does-it-for-you demo.
export function SearchPanel() {
  const problems = useSyncExternalStore(problemsStore.subscribe, problemsStore.getState);
  const traces = useSyncExternalStore(tracesStore.subscribe, tracesStore.getState);
  const activeProblemId = useSyncExternalStore(activeProblemIdStore.subscribe, activeProblemIdStore.getState);
  const activeTraceId = useSyncExternalStore(activeTraceIdStore.subscribe, activeTraceIdStore.getState);
  const [algorithm, setAlgorithm] = useState<SearchAlgorithm>('a_star');
  const [heuristic, setHeuristic] = useState('manhattan_distance');
  const [running, setRunning] = useState(false);

  // Cast at the boundary: the shared trace store is family-agnostic (generic
  // `algorithm: string`/`summary: unknown`), search code needs its own
  // concrete SearchTrace shape from here on — same "unknown at the boundary,
  // narrow immediately" principle already used for the Pyodide boundary.
  const activeTrace = (activeTraceId ? traces[activeTraceId] : null) as SearchTrace | null;
  // Always show the problem the active trace actually ran on, not just
  // whatever was last authored — same reasoning as sort/SortPanel.tsx.
  const activeProblem = activeTrace ? problems[activeTrace.problem_id] : activeProblemId ? problems[activeProblemId] : null;

  async function handleNewMaze() {
    const generated = generateMaze({ rows: 12, cols: 16, wallDensity: 0.3 });
    putProblem({ problem_id: newProblemId('maze'), type: 'maze', maze: generated.maze, start: generated.start, goal: generated.goal });
  }

  async function handleRun() {
    if (!activeProblem) return;
    setRunning(true);
    try {
      const trace = await runSearchAlgorithm(activeProblem, algorithm, {
        heuristic: activeProblem.type === 'maze' ? heuristic : activeProblem.type === 'n_queens' ? 'attacking_queen_pairs' : 'trips',
      });
      putTrace(trace);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="search-panel">
      <div className="search-controls">
        <button onClick={handleNewMaze}>New Maze</button>
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as SearchAlgorithm)}>
          {ALGORITHMS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {activeProblem?.type === 'maze' && (
          <select value={heuristic} onChange={(e) => setHeuristic(e.target.value)}>
            <option value="">no heuristic</option>
            <option value="manhattan_distance">manhattan_distance</option>
            <option value="euclidean_distance">euclidean_distance</option>
          </select>
        )}
        <button onClick={handleRun} disabled={!activeProblem || running}>
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      {!activeProblem && <p className="search-empty">Click "New Maze", or ask your agent to author a problem (search_author_maze / search_author_n_queens / search_author_missionaries_and_cannibals).</p>}

      {activeProblem?.type === 'maze' && <MazeCanvas problem={activeProblem} trace={activeTrace} />}
      {activeProblem?.type === 'n_queens' && <NQueensBoard problem={activeProblem} trace={activeTrace} />}
      {activeProblem?.type === 'missionaries_and_cannibals' && <MissionariesView trace={activeTrace} />}

      {activeTrace && (
        <>
          <PlaybackBar traceId={activeTrace.trace_id} />
          <div className="search-summary">
            <strong>{activeTrace.algorithm}</strong> — {activeTrace.summary.path_found ? (
              <>path length {activeTrace.summary.path_length}, cost {activeTrace.summary.cost}, {activeTrace.summary.inferences} states expanded</>
            ) : (
              <>no path found ({activeTrace.summary.inferences ?? 0} states expanded)</>
            )}
          </div>
        </>
      )}
    </div>
  );
}
