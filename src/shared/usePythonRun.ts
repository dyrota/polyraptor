import { useEffect, useRef, useState } from 'react';
import { forceStop } from '../pyodide/workerBridge';
import { humanAction, asFailure, type FailureDetail, type Family } from './activityLog';

// Everything both panels need in order to run untrusted Python on a human's
// click: the in-flight flag, the elapsed-time readout, the error to display,
// and the wrapper that keeps all three honest.
//
// This existed ten times before, once per handler across the two panels, as
// the same shape copied out by hand:
//
//   setPythonError(null); setPythonRunning(true); setElapsedMs(0);
//   try { await humanAction(...) }
//   catch (err) { setPythonError({ friendly_error: ... }) }
//   finally { setPythonRunning(false) }
//
// The catch arm carried a five-line comment about why it must exist -- "a bad
// values list, a Pyodide load failure, or a JSON parse error on the way back
// all throw... without this the button just stopped spinning and said nothing"
// -- repeated verbatim five times, which is the codebase saying out loud that
// this was one idea wearing ten costumes. Ten copies is also ten chances to
// omit the catch again, which is the exact bug that comment commemorates.
//
// The failure-to-display step is folded in too. These paths mostly fail by
// RETURNING {ok:false} or {valid:false} rather than throwing, so every handler
// body also had to call setPythonError itself at each early return -- eight
// more copies, and the same shape the activity log already tests for. A body
// now just returns the failed result: it lands in the log as an error and on
// screen as one, from a single place.
export function usePythonRun() {
  const [error, setError] = useState<FailureDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    startedAt.current = performance.now();
    const interval = setInterval(() => {
      if (startedAt.current !== null) setElapsedMs(performance.now() - startedAt.current);
    }, 100);
    return () => clearInterval(interval);
  }, [running]);

  return {
    error,
    running,
    elapsedMs,

    /** Show an error without running anything -- for input a handler rejects
     *  before it has any Python to run (an empty values list, say). */
    fail: (friendly_error: string) => setError({ friendly_error }),
    clear: () => setError(null),

    /** Kill a visible infinite loop rather than waiting out the timeout. */
    stop: () => {
      forceStop();
      setRunning(false);
    },

    /** Run `body` as a logged human action, surfacing whatever goes wrong --
     *  whether it throws or returns one of the two failure conventions. */
    run: async (family: Family, label: string, detail: unknown, body: () => Promise<unknown>) => {
      setError(null);
      setRunning(true);
      setElapsedMs(0);
      try {
        setError(asFailure(await humanAction(family, label, detail, body)));
      } catch (err) {
        setError({ friendly_error: err instanceof Error ? err.message : String(err) });
      } finally {
        setRunning(false);
      }
    },
  };
}
