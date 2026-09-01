import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { problemsStore, activeProblemIdStore, activeTraceIdStore, putProblem, putTrace, newProblemId, verificationStore, setVerification } from './state';
import { tracesStore } from '../shared/traceStore';
import { authorSortDataset, runSortAlgorithm } from './runAlgorithm';
import { authorPythonSortProblem, runAlgorithmOnPythonSortProblem } from './runPythonProblem';
import { authorPythonSortAlgorithm, runPythonAlgorithmOnProblem } from './runPythonAlgorithm';
import { authorPythonSortComparator } from './runPythonComparator';
import { verifyComparator } from './verifyComparator';
import { ComparatorVerificationCard } from './ComparatorVerificationCard';
import { forceStop } from '../pyodide/workerBridge';
import { BarArrayCanvas } from './BarArrayCanvas';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { PlaybackBar } from '../playback/PlaybackBar';
import { PythonEditor } from '../shared/PythonEditor';
import { CopyShareLinkButton } from '../shared/CopyShareLinkButton';
import { usePersistedSource } from '../shared/persistentState';
import { humanAction } from '../shared/activityLog';
import type { SharedPayload } from '../shared/shareLink';
import { SORT_PROBLEM_TEMPLATE, SORT_ALGORITHM_TEMPLATE, SORT_COMPARATOR_TEMPLATE } from './pythonTemplates';
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

function parseComparatorValues(text: string): number[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

// Mirrors SearchPanel.tsx exactly — human buttons and the sort_* WebMCP tools
// read/write the same store, same "shared live state" point as search.
export function SortPanel({ sharedPayload }: { sharedPayload: SharedPayload | null }) {
  const shared = sharedPayload?.kind.startsWith('sort-') ? sharedPayload : null;
  const problems = useSyncExternalStore(problemsStore.subscribe, problemsStore.getState);
  const traces = useSyncExternalStore(tracesStore.subscribe, tracesStore.getState);
  const activeProblemId = useSyncExternalStore(activeProblemIdStore.subscribe, activeProblemIdStore.getState);
  const activeTraceId = useSyncExternalStore(activeTraceIdStore.subscribe, activeTraceIdStore.getState);
  // Subscribed, not local state: an agent calling sort_verify_comparator must
  // paint its verdict onto the panel the human is already looking at, exactly
  // as search does with search_verify_heuristic.
  const verification = useSyncExternalStore(verificationStore.subscribe, verificationStore.getState);
  const [datasetType, setDatasetType] = useState<SortDatasetType>('random_integers');
  const [size, setSize] = useState(30);
  const [algorithm, setAlgorithm] = useState<SortAlgorithm>('bubble_sort');
  const [running, setRunning] = useState(false);

  // Mode toggle: local UI state only. It controls WHICH INPUT CONTROLS are
  // shown -- it must never gate the result area below (canvas/log/playback/
  // summary), which stays driven unconditionally by the real store state. If
  // an agent authors and runs Python code while a human's toggle happens to
  // sit on "Built-in", the human must still see it happen immediately.
  const [mode, setMode] = useState<'builtin' | 'python'>(() => (shared ? 'python' : 'builtin'));
  // Sub-mode within "write your own": author a Problem, or author an
  // Algorithm to run against whatever problem is currently active.
  const [pythonSubMode, setPythonSubMode] = useState<'problem' | 'algorithm' | 'comparator'>(() => {
    if (shared?.kind === 'sort-algorithm') return 'algorithm';
    if (shared?.kind === 'sort-comparator') return 'comparator';
    return 'problem';
  });
  const [pythonSource, setPythonSource, resetPythonSource] = usePersistedSource(
    'sort-problem',
    shared?.kind === 'sort-problem' ? shared.source : undefined,
    SORT_PROBLEM_TEMPLATE
  );
  const [pythonAlgorithmSource, setPythonAlgorithmSource, resetPythonAlgorithmSource] = usePersistedSource(
    'sort-algorithm',
    shared?.kind === 'sort-algorithm' ? shared.source : undefined,
    SORT_ALGORITHM_TEMPLATE
  );
  const [pythonComparatorValuesText, setPythonComparatorValuesText] = usePersistedSource(
    'sort-comparator-values',
    shared?.kind === 'sort-comparator' && shared.values ? shared.values.join(', ') : undefined,
    '5, 3, 8, 1, 9, 2'
  );
  const [pythonComparatorSource, setPythonComparatorSource, resetPythonComparatorSource] = usePersistedSource(
    'sort-comparator',
    shared?.kind === 'sort-comparator' ? shared.source : undefined,
    SORT_COMPARATOR_TEMPLATE
  );
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
    setPythonError(null);
    try {
      await humanAction('New Dataset', { dataset_type: datasetType, size }, async () => {
        const { values } = await authorSortDataset({ dataset_type: datasetType, size });
        putProblem({ problem_id: newProblemId('sort'), dataset_type: datasetType, size: values.length, values });
      });
    } catch (err) {
      // Generating a dataset runs Python, so this fails if Pyodide never
      // loaded -- previously an unhandled rejection and a button that
      // appeared to do nothing.
      setPythonError({ friendly_error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleRun() {
    if (!activeProblem) return;
    setPythonError(null);
    setRunning(true);
    try {
      // runSortAlgorithm rewraps the problem's `values` in the trusted
      // ascending _PolyraptorCustomSortProblem. For a python_problem that
      // silently DISCARDED the student's own comparator: a descending-order
      // problem got sorted ascending and then reported "sorted correctly",
      // because the summary's is_sorted check asks the same substituted
      // comparator. Unlike search's equivalent this never threw, so nothing
      // surfaced -- it just quietly answered the wrong question. Route custom
      // problems to the runner that actually re-execs their source.
      await humanAction('Run', { algorithm, problem_id: activeProblem.problem_id }, async () => {
        const trace =
          activeProblem.dataset_type === 'python_problem'
            ? await (async () => {
                const result = await runAlgorithmOnPythonSortProblem(activeProblem, algorithm);
                if (!result.ok) throw new Error(result.friendly_error ?? 'Run failed.');
                return result.trace!;
              })()
            : await runSortAlgorithm(activeProblem, algorithm);
        putTrace(trace);
      });
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
      // Returning the failed result rather than bare `return` is what lets
      // humanAction log it as an error: these paths fail by returning
      // {valid:false}/{ok:false}, not by throwing, and a silent `return` would
      // be recorded as a success.
      await humanAction('Validate & Run (Problem)', { algorithm }, async () => {
        const authored = await authorPythonSortProblem(pythonSource);
        if (!authored.valid) {
          setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
          return authored;
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
          return result;
        }
        putTrace(result.trace!);
        return result;
      });
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

  async function handlePythonAlgorithmRun() {
    if (!activeProblem) return;
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      await humanAction('Validate & Run (Algorithm)', { problem_id: activeProblem.problem_id }, async () => {
        const authored = await authorPythonSortAlgorithm(pythonAlgorithmSource);
        if (!authored.valid) {
          setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
          return authored;
        }
        const result = await runPythonAlgorithmOnProblem(activeProblem, pythonAlgorithmSource);
        if (!result.ok) {
          setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
          if (result.trace) putTrace(result.trace);
          return result;
        }
        putTrace(result.trace!);
        return result;
      });
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

  // Lowest-risk on-ramp: no Problem class at all, just a trusted literal
  // values array + a single comparator(a, b) function. Delegates entirely to
  // authorPythonSortComparator, which wraps both into a synthetic Problem
  // source and validates it the exact same way as a full custom problem --
  // the result is a normal python_problem, run the same way handlePythonRun
  // runs one.
  async function handlePythonComparatorRun() {
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      const values = parseComparatorValues(pythonComparatorValuesText);
      // Empty or all-garbage input reaches pyIntListLiteral and throws from
      // inside the author call; catching it here names the actual problem.
      if (values.length === 0) {
        setPythonError({ friendly_error: 'Enter at least one number to sort, separated by commas.' });
        return;
      }
      await humanAction('Validate & Run (Comparator)', { algorithm, value_count: values.length }, async () => {
        const authored = await authorPythonSortComparator(values, pythonComparatorSource);
        if (!authored.valid) {
          setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
          return authored;
        }
        const problemId = newProblemId('sort-cmp-py');
        const problem = {
          problem_id: problemId,
          dataset_type: 'python_problem' as const,
          size: authored.size!,
          values: authored.values!,
          source_code: authored.synthetic_source!,
        };
        putProblem(problem);
        const result = await runAlgorithmOnPythonSortProblem(problem, algorithm);
        if (!result.ok) {
          setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
          return result;
        }
        putTrace(result.trace!);
        return result;
      });
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

  // Verification is a separate action from running, for a sharper reason than
  // on the search side: running a sort with a broken comparator produces a
  // perfectly smooth animation and an is_sorted: true summary, because
  // sortedness is judged by that same comparator. The animation cannot show
  // you this bug; only the laws can.
  //
  // Verifies whatever problem is ACTIVE rather than the comparator editor's
  // contents, so it works on a built-in dataset and on a full authored Problem
  // too -- every SortProblem has a comparator, and the interesting ones are
  // often not the ones typed into the comparator box. The Verify button
  // therefore sits with the run controls, not inside the comparator sub-mode.
  async function handleVerifyComparator() {
    if (!activeProblem) return;
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      await humanAction('Verify comparator', { problem_id: activeProblem.problem_id }, async () => {
        const result = await verifyComparator(activeProblem);
        if (!result.ok) {
          setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
          return result;
        }
        setVerification({ problem_id: activeProblem.problem_id, report: result.report!, at: Date.now() });
        return result;
      });
    } catch (err) {
      setPythonError({ friendly_error: err instanceof Error ? err.message : String(err) });
    } finally {
      setPythonRunning(false);
    }
  }

  // The comparator sub-mode's own verify path: authors what is in the editor
  // into a problem first, so a comparator can be checked WITHOUT running a
  // sort against it. That ordering matters pedagogically -- "run it, watch it
  // look fine, then find out it was never a valid ordering" is the lesson, and
  // it only lands if verifying is reachable as its own step.
  async function handleVerifyAuthoredComparator() {
    setPythonError(null);
    setPythonRunning(true);
    setElapsedMs(0);
    try {
      const values = parseComparatorValues(pythonComparatorValuesText);
      if (values.length === 0) {
        setPythonError({ friendly_error: 'Enter at least one number to sort, separated by commas.' });
        return;
      }
      await humanAction('Validate & Verify', { value_count: values.length }, async () => {
        const authored = await authorPythonSortComparator(values, pythonComparatorSource);
        if (!authored.valid) {
          setPythonError({ friendly_error: authored.friendly_error!, raw_traceback: authored.raw_traceback });
          return authored;
        }
        const problem = {
          problem_id: newProblemId('sort-cmp-py'),
          dataset_type: 'python_problem' as const,
          size: authored.size!,
          values: authored.values!,
          source_code: authored.synthetic_source!,
        };
        putProblem(problem);
        const result = await verifyComparator(problem);
        if (!result.ok) {
          setPythonError({ friendly_error: result.friendly_error!, raw_traceback: result.raw_traceback });
          return result;
        }
        setVerification({ problem_id: problem.problem_id, report: result.report!, at: Date.now() });
        return result;
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
          <button
            onClick={handleVerifyComparator}
            disabled={!activeProblem || running || pythonRunning}
            title="Check that this problem's comparator is a valid ordering — a broken one makes a correct sort return a wrong answer with no error"
          >
            Verify comparator
          </button>
        </div>
      )}

      {mode === 'python' && (
        <div className="python-authoring">
          <div className="mode-toggle sub-toggle">
            <button className={pythonSubMode === 'problem' ? 'active' : ''} onClick={() => setPythonSubMode('problem')}>Problem</button>
            <button className={pythonSubMode === 'algorithm' ? 'active' : ''} onClick={() => setPythonSubMode('algorithm')}>Algorithm</button>
            <button className={pythonSubMode === 'comparator' ? 'active' : ''} onClick={() => setPythonSubMode('comparator')}>Comparator</button>
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
                <CopyShareLinkButton payload={{ kind: 'sort-problem', source: pythonSource }} />
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
                <CopyShareLinkButton payload={{ kind: 'sort-algorithm', source: pythonAlgorithmSource }} />
                <button className="link-button" onClick={resetPythonAlgorithmSource} disabled={pythonRunning}>Reset to template</button>
                {!activeProblem && <span className="search-empty">Author or select a problem first.</span>}
              </div>
            </>
          )}

          {pythonSubMode === 'comparator' && (
            <>
              <div className="search-controls">
                <label>
                  Values (comma-separated):{' '}
                  <input
                    type="text"
                    value={pythonComparatorValuesText}
                    onChange={(e) => setPythonComparatorValuesText(e.target.value)}
                    style={{ width: '16rem' }}
                  />
                </label>
              </div>
              <PythonEditor value={pythonComparatorSource} onChange={setPythonComparatorSource} readOnly={pythonRunning} />
              <div className="search-controls">
                <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as SortAlgorithm)}>
                  {ALGORITHMS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <button onClick={handlePythonComparatorRun} disabled={pythonRunning}>
                  {pythonRunning ? `Running... (${(elapsedMs / 1000).toFixed(1)}s)` : 'Validate & Run'}
                </button>
                <button
                  onClick={handleVerifyAuthoredComparator}
                  disabled={pythonRunning}
                  title="Check the laws a sort depends on — a comparator can animate beautifully and still be an invalid ordering"
                >
                  Validate &amp; Verify
                </button>
                {pythonRunning && <button onClick={handleStop}>Stop</button>}
                <CopyShareLinkButton
                  payload={{ kind: 'sort-comparator', source: pythonComparatorSource, values: parseComparatorValues(pythonComparatorValuesText) }}
                />
                <button className="link-button" onClick={resetPythonComparatorSource} disabled={pythonRunning}>Reset to template</button>
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
          Click "New Dataset" or write your own Problem class, or ask your agent to author one
          (sort_author_dataset / sort_author_custom / sort_author_python_problem).
        </p>
      )}

      {/* Matches SearchPanel, which has wrapped its canvases since custom code
          was introduced. A tier-2 custom algorithm's trace is genuinely
          unpredictable data, and this canvas was the one result surface still
          rendering it unguarded. */}
      {activeProblem && (
        <ErrorBoundary>
          <BarArrayCanvas problem={activeProblem} trace={activeTrace} />
        </ErrorBoundary>
      )}

      {/* Suppressed unless the verdict describes the problem on screen -- the
          same staleness guard SearchPanel applies to its own card. */}
      {verification && activeProblem && verification.problem_id === activeProblem.problem_id && (
        <ErrorBoundary>
          <ComparatorVerificationCard report={verification.report} />
        </ErrorBoundary>
      )}

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
