import { useState, useSyncExternalStore } from 'react';
import { problemsStore, activeProblemIdStore, activeTraceIdStore, putProblem, putTrace, newProblemId, verificationStore, setVerification } from './state';
import { tracesStore } from '../shared/traceStore';
import { generateMaze } from './mazeGenerator';
import { runSearchAlgorithm } from './runAlgorithm';
import { authorPythonSearchProblem, runAlgorithmOnPythonSearchProblem } from './runPythonProblem';
import { authorPythonSearchAlgorithm, runPythonAlgorithmOnProblem } from './runPythonAlgorithm';
import { authorPythonSearchHeuristic, runPythonHeuristicOnProblem } from './runPythonHeuristic';
import { verifyHeuristic, verifyBuiltinHeuristic } from './verifyHeuristic';
import { VerificationCard } from './VerificationCard';
import { ActiveProblemBar } from '../shared/ActiveProblemBar';
import { MazeCanvas } from './MazeCanvas';
import { NQueensBoard } from './NQueensBoard';
import { MissionariesView } from './MissionariesView';
import { PlaybackBar } from '../playback/PlaybackBar';
import { PythonEditor } from '../shared/PythonEditor';
import { GenericTraceLog } from '../shared/GenericTraceLog';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { CopyShareLinkButton } from '../shared/CopyShareLinkButton';
import { usePersistedSource } from '../shared/persistentState';
import { DisplacedDraftNotice } from '../shared/DisplacedDraftNotice';
import { humanAction, noteHumanAction } from '../shared/activityLog';
import { usePythonRun } from '../shared/usePythonRun';
import { PythonErrorBlock } from '../shared/PythonErrorBlock';
import type { SharedPayload } from '../shared/shareLink';
import { SEARCH_PROBLEM_TEMPLATE, SEARCH_ALGORITHM_TEMPLATE, SEARCH_HEURISTIC_TEMPLATE } from './pythonTemplates';
import { SEARCH_ALGORITHMS, HEURISTIC_ALGORITHMS } from './types';
import type { AuthoredProblem, HeuristicAlgorithm, SearchAlgorithm, SearchTrace } from './types';

// What the ActiveProblemBar says about a search problem. Kept beside the panel
// that renders it rather than on the type, because it is presentation: the
// point is a human reading "Maze · 12 × 16 · start (0,0) → goal (11,15)" and
// knowing at a glance that the canvas below is not the built-in dataset the
// controls above happen to be set to.
function describeProblem(problem: AuthoredProblem): { kind: string; detail?: string } {
  switch (problem.type) {
    case 'maze':
      return {
        kind: 'Maze',
        detail:
          problem.maze && problem.start && problem.goal
            ? `${problem.maze.length} × ${problem.maze[0].length} · start (${problem.start.join(', ')}) → goal (${problem.goal.join(', ')})`
            : undefined,
      };
    case 'n_queens':
      return { kind: 'N-Queens', detail: `${problem.n} queens on a ${problem.n} × ${problem.n} board` };
    case 'missionaries_and_cannibals':
      return { kind: 'Missionaries & cannibals', detail: '3 missionaries, 3 cannibals, one boat' };
    case 'python_problem': {
      const ops = problem.preview?.operator_count;
      return {
        kind: 'Your Python problem',
        detail: ops === undefined ? undefined : `${ops} operator${ops === 1 ? '' : 's'}`,
      };
    }
  }
}

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
  const [pythonSource, setPythonSource, resetPythonSource, displacedProblem] = usePersistedSource(
    'search-problem',
    shared?.kind === 'search-problem' ? shared.source : undefined,
    SEARCH_PROBLEM_TEMPLATE
  );
  const [pythonAlgorithm, setPythonAlgorithm] = useState<SearchAlgorithm>('a_star');
  const [pythonAlgorithmSource, setPythonAlgorithmSource, resetPythonAlgorithmSource, displacedAlgorithm] =
    usePersistedSource(
    'search-algorithm',
    shared?.kind === 'search-algorithm' ? shared.source : undefined,
    SEARCH_ALGORITHM_TEMPLATE
  );
  const [pythonHeuristicSource, setPythonHeuristicSource, resetPythonHeuristicSource, displacedHeuristic] =
    usePersistedSource(
    'search-heuristic',
    shared?.kind === 'search-heuristic' ? shared.source : undefined,
    SEARCH_HEURISTIC_TEMPLATE
  );
  const [pythonHeuristicAlgorithm, setPythonHeuristicAlgorithm] = useState<HeuristicAlgorithm>('a_star');
  // Owns the in-flight flag, the elapsed readout, and the error to show --
  // see shared/usePythonRun.ts.
  const py = usePythonRun();

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
    putProblem({
      problem_id: newProblemId('maze'),
      type: 'maze',
      origin: 'human',
      maze: generated.maze,
      start: generated.start,
      goal: generated.goal,
    });
    // Synchronous: maze generation is pure JS, so there is no running state to
    // show -- unlike every other action here, which goes through Pyodide.
    noteHumanAction('search', 'New Maze', { rows: 12, cols: 16, wall_density: 0.3 });
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

  // Deliberately NOT on usePythonRun's flag: a built-in run goes through
  // bridge.ts's main-thread Pyodide while authored code goes through the
  // worker's own separate instance, so the two genuinely can be in flight at
  // once and must gate different buttons.
  async function handleRun() {
    if (!activeProblem) return;
    py.clear();
    setRunning(true);
    try {
      // A python_problem cannot go through runSearchAlgorithm at all -- it
      // builds Python source from a known problem shape and throws "Unknown
      // problem type" for a custom one. That throw used to escape an
      // uncaught try/finally, so clicking Run on an agent-authored Python
      // problem did nothing at all, with no message anywhere. Route it to the
      // sandboxed runner the agent's own tool would have used instead.
      await humanAction('search', 'Run', { algorithm, problem_id: activeProblem.problem_id }, async () => {
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
      });
    } catch (err) {
      py.fail(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  // Human "Run" does validate-then-run as one click -- same two underlying
  // calls the separate WebMCP tools perform, just sequenced smoother for a
  // person than making them click twice.
  async function handlePythonRun() {
    // Returning the failed result rather than a bare `return` is what surfaces
    // it: these paths fail by returning {valid:false}/{ok:false} rather than
    // throwing, and py.run reads that convention to both log and display the
    // error. A silent `return` would be recorded as a success.
    await py.run('search', 'Validate & Run (Problem)', { algorithm: pythonAlgorithm }, async () => {
      const authored = await authorPythonSearchProblem(pythonSource);
      if (!authored.valid) return authored;
      const problem = {
        problem_id: newProblemId('search-py'),
        type: 'python_problem' as const,
        origin: 'human' as const,
        source_code: pythonSource,
        preview: {
          initial_state: authored.initial_state,
          operator_count: authored.operator_count,
          goal_check_on_initial: authored.goal_check_on_initial,
        },
      };
      putProblem(problem);
      const result = await runAlgorithmOnPythonSearchProblem(problem, pythonAlgorithm);
      if (!result.ok) return result;
      putTrace(result.trace!);
      return result;
    });
  }

  // Runs a custom algorithm against whatever problem is currently active
  // (built-in or a previously-authored custom one) -- same validate-then-run
  // one-click pattern as handlePythonRun.
  async function handlePythonAlgorithmRun() {
    if (!activeProblem) return;
    await py.run('search', 'Validate & Run (Algorithm)', { problem_id: activeProblem.problem_id }, async () => {
      const authored = await authorPythonSearchAlgorithm(pythonAlgorithmSource);
      if (!authored.valid) return authored;
      const result = await runPythonAlgorithmOnProblem(activeProblem, pythonAlgorithmSource);
      // A run that crashed partway still has a partial trace worth showing.
      if (result.trace) putTrace(result.trace);
      return result;
    });
  }

  // Narrowest-risk slot: only the heuristic is untrusted, called from inside
  // a fully trusted a_star/best_first/hill_climbing loop -- validated against
  // whatever problem is currently active (built-in or custom), same
  // "reuse activeProblem, no separate picker" pattern as handlePythonAlgorithmRun.
  async function handlePythonHeuristicRun() {
    if (!activeProblem) return;
    const detail = { algorithm: pythonHeuristicAlgorithm, problem_id: activeProblem.problem_id };
    await py.run('search', 'Validate & Run (Heuristic)', detail, async () => {
      const authored = await authorPythonSearchHeuristic(pythonHeuristicSource, activeProblem);
      if (!authored.valid) return authored;
      const result = await runPythonHeuristicOnProblem(activeProblem, pythonHeuristicSource, pythonHeuristicAlgorithm);
      if (!result.ok) return result;
      putTrace(result.trace!);
      return result;
    });
  }

  // Verification is a separate action from running: running shows you WHAT the
  // heuristic did, verifying tells you whether it was allowed to. Both are
  // offered because a heuristic that produces a nice-looking animation can
  // still be silently inadmissible, which is the entire point of the feature.
  async function handleVerifyHeuristic() {
    if (!activeProblem) return;
    await py.run('search', 'Verify heuristic', { problem_id: activeProblem.problem_id }, async () => {
      const authored = await authorPythonSearchHeuristic(pythonHeuristicSource, activeProblem);
      if (!authored.valid) return authored;
      const result = await verifyHeuristic(activeProblem, pythonHeuristicSource);
      if (!result.ok) return result;
      setVerification({
        problem_id: activeProblem.problem_id,
        heuristic_id: null,
        source_code: pythonHeuristicSource,
        report: result.report!,
        at: Date.now(),
      });
      return result;
    });
  }

  // The built-in counterpart to handleVerifyHeuristic, and the reason
  // verifyBuiltinHeuristic exists: "is manhattan_distance actually admissible
  // on this maze?" is the question a newcomer is most likely to have, and it
  // was previously unaskable without first retyping the heuristic into the
  // Python tab. Mirrors the sort family, where Verify has always sat directly
  // in the built-in controls.
  async function handleVerifyBuiltinHeuristic() {
    if (!activeProblem) return;
    const builtin = builtinHeuristicFor(activeProblem.type);
    if (!builtin) return;
    const detail = { heuristic: builtin, problem_id: activeProblem.problem_id };
    await py.run('search', 'Verify heuristic', detail, async () => {
      const result = await verifyBuiltinHeuristic(activeProblem, builtin);
      if (!result.ok) return result;
      setVerification({
        problem_id: activeProblem.problem_id,
        heuristic_id: null,
        source_code: `# built-in: ${builtin}`,
        report: result.report!,
        at: Date.now(),
      });
      return result;
    });
  }

  const builtinHeuristic = activeProblem ? builtinHeuristicFor(activeProblem.type) : undefined;

  return (
    <div className="search-panel">
      <div className="mode-toggle">
        <button aria-pressed={mode === 'builtin'} className={mode === 'builtin' ? 'active' : ''} onClick={() => setMode('builtin')}>Built-in</button>
        <button aria-pressed={mode === 'python'} className={mode === 'python' ? 'active' : ''} onClick={() => setMode('python')}>Write your own</button>
      </div>

      {mode === 'builtin' && (
        <div className="search-controls">
          <button onClick={handleNewMaze}>New Maze</button>
          {/* Wrapped in a <label> rather than given a bare aria-label: an
              unlabelled dropdown reading "a_star" is as opaque to a sighted
              newcomer as it is to a screen reader, and the row already wraps. */}
          <label className="control-label">
            Algorithm
            <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as SearchAlgorithm)}>
              {SEARCH_ALGORITHMS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          {activeProblem?.type === 'maze' && (
            <label className="control-label">
              Heuristic
              <select value={heuristic} onChange={(e) => setHeuristic(e.target.value)}>
                <option value="">no heuristic</option>
                <option value="manhattan_distance">manhattan_distance</option>
                <option value="euclidean_distance">euclidean_distance</option>
              </select>
            </label>
          )}
          <button onClick={handleRun} disabled={!activeProblem || running}>
            {running ? 'Running...' : 'Run'}
          </button>
          <button
            onClick={handleVerifyBuiltinHeuristic}
            disabled={!activeProblem || !builtinHeuristic || running || py.running}
            title={
              builtinHeuristic
                ? `Check whether ${builtinHeuristic} is admissible and consistent on this problem, against exhaustively computed ground truth`
                : 'Pick a heuristic first — there is nothing to verify without one'
            }
          >
            {py.running ? `Verifying... (${(py.elapsedMs / 1000).toFixed(1)}s)` : 'Verify heuristic'}
          </button>
        </div>
      )}

      {mode === 'python' && (
        <div className="python-authoring">
          <div className="mode-toggle sub-toggle">
            <button aria-pressed={pythonSubMode === 'problem'} className={pythonSubMode === 'problem' ? 'active' : ''} onClick={() => setPythonSubMode('problem')}>Problem</button>
            <button aria-pressed={pythonSubMode === 'algorithm'} className={pythonSubMode === 'algorithm' ? 'active' : ''} onClick={() => setPythonSubMode('algorithm')}>Algorithm</button>
            <button aria-pressed={pythonSubMode === 'heuristic'} className={pythonSubMode === 'heuristic' ? 'active' : ''} onClick={() => setPythonSubMode('heuristic')}>Heuristic</button>
          </div>

          {pythonSubMode === 'problem' && (
            <>
              <DisplacedDraftNotice
                label="problem"
                entries={[{ slot: 'search-problem', displaced: displacedProblem, onRestore: setPythonSource }]}
              />
              <PythonEditor value={pythonSource} onChange={setPythonSource} readOnly={py.running} />
              <div className="search-controls">
                <label className="control-label">
                  Algorithm
                  <select value={pythonAlgorithm} onChange={(e) => setPythonAlgorithm(e.target.value as SearchAlgorithm)}>
                    {SEARCH_ALGORITHMS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <button onClick={handlePythonRun} disabled={py.running}>
                  {py.running ? `Running... (${(py.elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run'}
                </button>
                {py.running && <button onClick={py.stop}>Stop</button>}
                <CopyShareLinkButton payload={{ kind: 'search-problem', source: pythonSource }} />
                <button className="link-button" onClick={resetPythonSource} disabled={py.running}>Reset to template</button>
              </div>
            </>
          )}

          {pythonSubMode === 'algorithm' && (
            <>
              <DisplacedDraftNotice
                label="algorithm"
                entries={[{ slot: 'search-algorithm', displaced: displacedAlgorithm, onRestore: setPythonAlgorithmSource }]}
              />
              <PythonEditor value={pythonAlgorithmSource} onChange={setPythonAlgorithmSource} readOnly={py.running} />
              <div className="search-controls">
                <button onClick={handlePythonAlgorithmRun} disabled={py.running || !activeProblem}>
                  {py.running ? `Running... (${(py.elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run against active problem'}
                </button>
                {py.running && <button onClick={py.stop}>Stop</button>}
                <CopyShareLinkButton payload={{ kind: 'search-algorithm', source: pythonAlgorithmSource }} />
                <button className="link-button" onClick={resetPythonAlgorithmSource} disabled={py.running}>Reset to template</button>
                {!activeProblem && <span className="search-empty">Author or select a problem first (Built-in or Problem sub-tab).</span>}
              </div>
            </>
          )}

          {pythonSubMode === 'heuristic' && (
            <>
              <DisplacedDraftNotice
                label="heuristic"
                entries={[{ slot: 'search-heuristic', displaced: displacedHeuristic, onRestore: setPythonHeuristicSource }]}
              />
              <PythonEditor value={pythonHeuristicSource} onChange={setPythonHeuristicSource} readOnly={py.running} />
              <div className="search-controls">
                <label className="control-label">
                  Algorithm
                  <select
                    value={pythonHeuristicAlgorithm}
                    onChange={(e) => setPythonHeuristicAlgorithm(e.target.value as HeuristicAlgorithm)}
                  >
                    {HEURISTIC_ALGORITHMS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <button onClick={handlePythonHeuristicRun} disabled={py.running || !activeProblem}>
                  {py.running ? `Running... (${(py.elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run against active problem'}
                </button>
                <button onClick={handleVerifyHeuristic} disabled={py.running || !activeProblem} title="Check admissibility and consistency against exhaustively computed ground truth">
                  Verify
                </button>
                {py.running && <button onClick={py.stop}>Stop</button>}
                <CopyShareLinkButton payload={{ kind: 'search-heuristic', source: pythonHeuristicSource }} />
                <button className="link-button" onClick={resetPythonHeuristicSource} disabled={py.running}>Reset to template</button>
                {!activeProblem && <span className="search-empty">Author or select a problem first (Built-in or Problem sub-tab).</span>}
              </div>
            </>
          )}

        </div>
      )}

      <PythonErrorBlock error={py.error} />

      {!activeProblem && (
        <p className="search-empty">
          Click "New Maze" or write your own Problem class, or ask your agent to author one (search_author_maze /
          search_author_n_queens / search_author_missionaries_and_cannibals / search_author_python_problem).
        </p>
      )}

      {/* Immediately above the result area, because it labels what is drawn
          there -- and outside the mode blocks, for the same reason the result
          area is: an agent can replace the active problem while the human's
          toggle sits anywhere. */}
      {activeProblem && (
        <ActiveProblemBar
          {...describeProblem(activeProblem)}
          problemId={activeProblem.problem_id}
          origin={activeProblem.origin}
        />
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
