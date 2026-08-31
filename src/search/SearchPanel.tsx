import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { problemsStore, activeProblemIdStore, activeTraceIdStore, putProblem, putTrace, newProblemId, verificationStore, setVerification } from './state';
import { tracesStore } from '../shared/traceStore';
import { generateMaze } from './mazeGenerator';
import { runSearchAlgorithm } from './runAlgorithm';
import { authorPythonSearchProblem, runAlgorithmOnPythonSearchProblem } from './runPythonProblem';
import { authorPythonSearchAlgorithm, runPythonAlgorithmOnProblem } from './runPythonAlgorithm';
import { authorPythonSearchHeuristic, runPythonHeuristicOnProblem } from './runPythonHeuristic';
import { verifyHeuristic } from './verifyHeuristic';
import { VerificationCard } from './VerificationCard';
import { forceStop } from '../pyodide/workerBridge';
import { MazeCanvas } from './MazeCanvas';
import { NQueensBoard } from './NQueensBoard';
import { MissionariesView } from './MissionariesView';
import { PlaybackBar } from '../playback/PlaybackBar';
import { PythonEditor } from '../shared/PythonEditor';
import { GenericTraceLog } from '../shared/GenericTraceLog';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { CopyShareLinkButton } from '../shared/CopyShareLinkButton';
import { usePersistedSource } from '../shared/persistentState';
import type { SharedPayload } from '../shared/shareLink';
import { SEARCH_PROBLEM_TEMPLATE, SEARCH_ALGORITHM_TEMPLATE, SEARCH_HEURISTIC_TEMPLATE } from './pythonTemplates';
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

// Only these three built-in algorithms accept a heuristic at all -- a custom
// heuristic is meaningless against breadth_first/depth_first/etc.
const HEURISTIC_ALGORITHMS: Array<'a_star' | 'best_first' | 'hill_climbing'> = ['a_star', 'best_first', 'hill_climbing'];

// This panel is deliberately usable by a human directly (New Maze / Run
// buttons) AND by an agent via the search_*/playback_* WebMCP tools, both
// reading and writing the exact same store -- that shared-live-state loop is
// the point of the whole project, not just an agent-does-it-for-you demo.
export function SearchPanel({ sharedPayload }: { sharedPayload: SharedPayload | null }) {
  const shared = sharedPayload?.kind.startsWith('search-') ? sharedPayload : null;
  const problems = useSyncExternalStore(problemsStore.subscribe, problemsStore.getState);
  const traces = useSyncExternalStore(tracesStore.subscribe, tracesStore.getState);
  const activeProblemId = useSyncExternalStore(activeProblemIdStore.subscribe, activeProblemIdStore.getState);
  const activeTraceId = useSyncExternalStore(activeTraceIdStore.subscribe, activeTraceIdStore.getState);
  // Subscribed, not local state: an agent calling search_verify_heuristic
  // must paint its verdict onto this panel, exactly like its authoring and
  // run tools already do.
  const verification = useSyncExternalStore(verificationStore.subscribe, verificationStore.getState);
  const [algorithm, setAlgorithm] = useState<SearchAlgorithm>('a_star');
  const [heuristic, setHeuristic] = useState('manhattan_distance');
  const [running, setRunning] = useState(false);

  // Mode toggle: local UI state only. It controls WHICH INPUT CONTROLS are
  // shown -- it must never gate the result area below (canvas/log/playback/
  // summary), which stays driven unconditionally by the real store state. If
  // an agent authors and runs Python code while a human's toggle happens to
  // sit on "Built-in", the human must still see it happen immediately.
  const [mode, setMode] = useState<'builtin' | 'python'>(() => (shared ? 'python' : 'builtin'));
  // Sub-mode within "write your own": author a Problem, or author an
  // Algorithm to run against whatever problem is currently active (built-in
  // or custom) -- reuses the existing activeProblem rather than adding a
  // separate problem-picker UI.
  const [pythonSubMode, setPythonSubMode] = useState<'problem' | 'algorithm' | 'heuristic'>(() => {
    if (shared?.kind === 'search-algorithm') return 'algorithm';
    if (shared?.kind === 'search-heuristic') return 'heuristic';
    return 'problem';
  });
  const [pythonSource, setPythonSource, resetPythonSource] = usePersistedSource(
    'search-problem',
    shared?.kind === 'search-problem' ? shared.source : undefined,
    SEARCH_PROBLEM_TEMPLATE
  );
  const [pythonAlgorithm, setPythonAlgorithm] = useState<SearchAlgorithm>('a_star');
  const [pythonAlgorithmSource, setPythonAlgorithmSource, resetPythonAlgorithmSource] = usePersistedSource(
    'search-algorithm',
    shared?.kind === 'search-algorithm' ? shared.source : undefined,
    SEARCH_ALGORITHM_TEMPLATE
  );
  const [pythonHeuristicSource, setPythonHeuristicSource, resetPythonHeuristicSource] = usePersistedSource(
    'search-heuristic',
    shared?.kind === 'search-heuristic' ? shared.source : undefined,
    SEARCH_HEURISTIC_TEMPLATE
  );
  const [pythonHeuristicAlgorithm, setPythonHeuristicAlgorithm] = useState<'a_star' | 'best_first' | 'hill_climbing'>('a_star');
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

  // Cast at the boundary: the shared trace store is family-agnostic (generic
  // `algorithm: string`/`summary: unknown`), search code needs its own
  // concrete SearchTrace shape from here on — same "unknown at the boundary,
  // narrow immediately" principle already used for the Pyodide boundary.
  const activeTrace = (activeTraceId ? traces[activeTraceId] : null) as SearchTrace | null;
  // Always show the problem the active trace actually ran on, not just
  // whatever was last authored — same reasoning as sort/SortPanel.tsx.
  const activeProblem = activeTrace ? problems[activeTrace.problem_id] : activeProblemId ? problems[activeProblemId] : null;

  function handleNewMaze() {
    const generated = generateMaze({ rows: 12, cols: 16, wallDensity: 0.3 });
    putProblem({ problem_id: newProblemId('maze'), type: 'maze', maze: generated.maze, start: generated.start, goal: generated.goal });
  }

  // Each built-in problem type has exactly one applicable heuristic family
  // (verified against the wheels: MazeProblem defines manhattan/euclidean,
  // NQueensProblem only attacking_queen_pairs, Missionaries only trips).
  // Returning undefined rather than falling through to 'trips' matters: a
  // python_problem has no built-in heuristic at all, and the old chained
  // ternary silently handed it 'trips'.
  function builtinHeuristicFor(problemType: string): string | undefined {
    if (problemType === 'maze') return heuristic || undefined;
    if (problemType === 'n_queens') return 'attacking_queen_pairs';
    if (problemType === 'missionaries_and_cannibals') return 'trips';
    return undefined;
  }

  async function handleRun() {
    if (!activeProblem) return;
    setPythonError(null);
    setRunning(true);
    try {
      // A python_problem cannot go through runSearchAlgorithm at all -- it
      // builds Python source from a known problem shape and throws "Unknown
      // problem type" for a custom one. That throw used to escape an
      // uncaught try/finally, so clicking Run on an agent-authored Python
      // problem did nothing at all, with no message anywhere. Route it to the
      // sandboxed runner the agent's own tool would have used instead.
      const trace =
        activeProblem.type === 'python_problem'
          ? await (async () => {
              const result = await runAlgorithmOnPythonSearchProblem(activeProblem, algorithm);
              if (!result.ok) throw new Error(result.friendly_error ?? 'Run failed.');
              return result.trace!;
            })()
          : await runSearchAlgorithm(activeProblem, algorithm, {
              heuristic: builtinHeuristicFor(activeProblem.type),
            });
      putTrace(trace);
    } catch (err) {
      setPythonError({ friendly_error: err instanceof Error ? err.message : String(err) });
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
      const authored = await authorPythonSearchProblem(pythonSource);
      if (!authored.valid) {
        setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
        return;
      }
      const problemId = newProblemId('search-py');
      const problem = {
        problem_id: problemId,
        type: 'python_problem' as const,
        source_code: pythonSource,
        preview: {
          initial_state: authored.initial_state,
          operator_count: authored.operator_count,
          goal_check_on_initial: authored.goal_check_on_initial,
        },
      };
      putProblem(problem);
      const result = await runAlgorithmOnPythonSearchProblem(problem, pythonAlgorithm);
      if (!result.ok) {
        setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
        return;
      }
      putTrace(result.trace!);
    } catch (err) {
      // Not every failure arrives as a validated {ok:false} result -- a bad
      // values list, a Pyodide load failure, or a JSON parse error on the way
      // back all throw. Without this these handlers had try/finally and no
      // catch, so the button just stopped spinning and said nothing.
      setPythonError({ friendly_error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPythonRunning(false);
    }
  }

  // Runs a custom algorithm against whatever problem is currently active
  // (built-in or a previously-authored custom one) -- same validate-then-run
  // one-click pattern as handlePythonRun.
  async function handlePythonAlgorithmRun() {
    if (!activeProblem) return;
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      const authored = await authorPythonSearchAlgorithm(pythonAlgorithmSource);
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
    } catch (err) {
      // Not every failure arrives as a validated {ok:false} result -- a bad
      // values list, a Pyodide load failure, or a JSON parse error on the way
      // back all throw. Without this these handlers had try/finally and no
      // catch, so the button just stopped spinning and said nothing.
      setPythonError({ friendly_error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPythonRunning(false);
    }
  }

  // Narrowest-risk slot: only the heuristic is untrusted, called from inside
  // a fully trusted a_star/best_first/hill_climbing loop -- validated against
  // whatever problem is currently active (built-in or custom), same
  // "reuse activeProblem, no separate picker" pattern as handlePythonAlgorithmRun.
  async function handlePythonHeuristicRun() {
    if (!activeProblem) return;
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      const authored = await authorPythonSearchHeuristic(pythonHeuristicSource, activeProblem);
      if (!authored.valid) {
        setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
        return;
      }
      const result = await runPythonHeuristicOnProblem(activeProblem, pythonHeuristicSource, pythonHeuristicAlgorithm);
      if (!result.ok) {
        setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
        return;
      }
      putTrace(result.trace!);
    } catch (err) {
      // Not every failure arrives as a validated {ok:false} result -- a bad
      // values list, a Pyodide load failure, or a JSON parse error on the way
      // back all throw. Without this these handlers had try/finally and no
      // catch, so the button just stopped spinning and said nothing.
      setPythonError({ friendly_error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPythonRunning(false);
    }
  }

  // Verification is a separate action from running: running shows you WHAT the
  // heuristic did, verifying tells you whether it was allowed to. Both are
  // offered because a heuristic that produces a nice-looking animation can
  // still be silently inadmissible, which is the entire point of the feature.
  async function handleVerifyHeuristic() {
    if (!activeProblem) return;
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      const authored = await authorPythonSearchHeuristic(pythonHeuristicSource, activeProblem);
      if (!authored.valid) {
        setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
        return;
      }
      const result = await verifyHeuristic(activeProblem, pythonHeuristicSource);
      if (!result.ok) {
        setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
        return;
      }
      setVerification({
        problem_id: activeProblem.problem_id,
        heuristic_id: null,
        source_code: pythonHeuristicSource,
        report: result.report!,
        at: Date.now(),
      });
    } catch (err) {
      setPythonError({ friendly_error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPythonRunning(false);
    }
  }

  function handleStop() {
    forceStop();
    setPythonRunning(false);
  }

  return (
    <div className="search-panel">
      <div className="mode-toggle">
        <button className={mode === 'builtin' ? 'active' : ''} onClick={() => setMode('builtin')}>Built-in</button>
        <button className={mode === 'python' ? 'active' : ''} onClick={() => setMode('python')}>Write your own</button>
      </div>

      {mode === 'builtin' && (
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
      )}

      {mode === 'python' && (
        <div className="python-authoring">
          <div className="mode-toggle sub-toggle">
            <button className={pythonSubMode === 'problem' ? 'active' : ''} onClick={() => setPythonSubMode('problem')}>Problem</button>
            <button className={pythonSubMode === 'algorithm' ? 'active' : ''} onClick={() => setPythonSubMode('algorithm')}>Algorithm</button>
            <button className={pythonSubMode === 'heuristic' ? 'active' : ''} onClick={() => setPythonSubMode('heuristic')}>Heuristic</button>
          </div>

          {pythonSubMode === 'problem' && (
            <>
              <PythonEditor value={pythonSource} onChange={setPythonSource} readOnly={pythonRunning} />
              <div className="search-controls">
                <select value={pythonAlgorithm} onChange={(e) => setPythonAlgorithm(e.target.value as SearchAlgorithm)}>
                  {ALGORITHMS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <button onClick={handlePythonRun} disabled={pythonRunning}>
                  {pythonRunning ? `Running... (${(elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run'}
                </button>
                {pythonRunning && <button onClick={handleStop}>Stop</button>}
                <CopyShareLinkButton payload={{ kind: 'search-problem', source: pythonSource }} />
                <button className="link-button" onClick={resetPythonSource} disabled={pythonRunning}>Reset to template</button>
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
                <CopyShareLinkButton payload={{ kind: 'search-algorithm', source: pythonAlgorithmSource }} />
                <button className="link-button" onClick={resetPythonAlgorithmSource} disabled={pythonRunning}>Reset to template</button>
                {!activeProblem && <span className="search-empty">Author or select a problem first (Built-in or Problem sub-tab).</span>}
              </div>
            </>
          )}

          {pythonSubMode === 'heuristic' && (
            <>
              <PythonEditor value={pythonHeuristicSource} onChange={setPythonHeuristicSource} readOnly={pythonRunning} />
              <div className="search-controls">
                <select
                  value={pythonHeuristicAlgorithm}
                  onChange={(e) => setPythonHeuristicAlgorithm(e.target.value as 'a_star' | 'best_first' | 'hill_climbing')}
                >
                  {HEURISTIC_ALGORITHMS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <button onClick={handlePythonHeuristicRun} disabled={pythonRunning || !activeProblem}>
                  {pythonRunning ? `Running... (${(elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run against active problem'}
                </button>
                <button onClick={handleVerifyHeuristic} disabled={pythonRunning || !activeProblem} title="Check admissibility and consistency against exhaustively computed ground truth">
                  Verify
                </button>
                {pythonRunning && <button onClick={handleStop}>Stop</button>}
                <CopyShareLinkButton payload={{ kind: 'search-heuristic', source: pythonHeuristicSource }} />
                <button className="link-button" onClick={resetPythonHeuristicSource} disabled={pythonRunning}>Reset to template</button>
                {!activeProblem && <span className="search-empty">Author or select a problem first (Built-in or Problem sub-tab).</span>}
              </div>
            </>
          )}

        </div>
      )}

      {/* Outside the mode === 'python' block on purpose: built-in Run/New
          Dataset can fail too (a rejected custom problem, a Pyodide load
          failure), and while this lived inside that block those errors had
          nowhere to render at all. */}
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

      {!activeProblem && (
        <p className="search-empty">
          Click "New Maze" or write your own Problem class, or ask your agent to author one (search_author_maze /
          search_author_n_queens / search_author_missionaries_and_cannibals / search_author_python_problem).
        </p>
      )}

      {/* A custom (tier-2) algorithm's events have no guaranteed shape even
          against a built-in problem, so GenericTraceLog is the right view
          whenever the trace itself came from custom code -- not just when
          the problem did. */}
      {(() => {
        const useGenericLog = activeProblem?.type === 'python_problem' || activeTrace?.algorithm === 'custom';
        // Only surface a verdict that describes the problem currently on screen
        // -- the same staleness guard the panel already applies to traces.
        const liveVerification =
          verification && activeProblem && verification.problem_id === activeProblem.problem_id ? verification : null;
        const ce =
          (liveVerification?.report.admissible.counterexample?.state ??
            liveVerification?.report.consistent.counterexample?.state ??
            liveVerification?.report.goal_zero.counterexample?.state) as [number, number] | undefined;
        const mazeCe = Array.isArray(ce) && ce.length === 2 && ce.every((n) => typeof n === 'number') ? ce : null;
        return (
          <ErrorBoundary>
            {!useGenericLog && activeProblem?.type === 'maze' && (
              <MazeCanvas problem={activeProblem} trace={activeTrace} counterexample={mazeCe} />
            )}
            {!useGenericLog && activeProblem?.type === 'n_queens' && <NQueensBoard problem={activeProblem} trace={activeTrace} />}
            {!useGenericLog && activeProblem?.type === 'missionaries_and_cannibals' && <MissionariesView trace={activeTrace} />}
            {useGenericLog && activeTrace && <GenericTraceLog traceId={activeTrace.trace_id} />}
            {useGenericLog && !activeTrace && (
              <p className="search-empty">Problem authored -- run an algorithm against it to see a trace.</p>
            )}
          </ErrorBoundary>
        );
      })()}

      {verification && activeProblem && verification.problem_id === activeProblem.problem_id && (
        <ErrorBoundary>
          <VerificationCard report={verification.report} />
        </ErrorBoundary>
      )}

      {activeTrace && (
        <>
          <PlaybackBar traceId={activeTrace.trace_id} />
          <div className="search-summary">
            <strong>{activeTrace.algorithm}</strong> —{' '}
            {activeTrace.summary.path_found !== undefined ? (
              activeTrace.summary.path_found ? (
                <>path length {activeTrace.summary.path_length}, cost {activeTrace.summary.cost}, {activeTrace.summary.inferences} states expanded</>
              ) : (
                <>no path found ({activeTrace.summary.inferences ?? 0} states expanded)</>
              )
            ) : (
              <>returned {JSON.stringify(activeTrace.summary.raw_return_value)}, events: {Object.entries(activeTrace.summary.event_type_counts ?? {}).map(([t, c]) => `${t}:${c}`).join(', ') || 'none'}</>
            )}
          </div>
        </>
      )}
    </div>
  );
}
