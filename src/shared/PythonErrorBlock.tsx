import { useState } from 'react';
import type { FailureDetail } from './activityLog';

// The friendly message, with the raw traceback behind a disclosure.
//
// Identical JSX in both panels before this, along with the showRawTraceback
// state that only this block ever read -- so the state lives here now rather
// than in a panel that has no other use for it.
//
// Rendered by each panel OUTSIDE its mode blocks on purpose: a built-in
// Run/New Dataset can fail too (a rejected custom problem, a Pyodide load
// failure), and while this lived inside the `mode === 'python'` block those
// errors had nowhere to render at all.
export function PythonErrorBlock({ error }: { error: FailureDetail | null }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!error) return null;
  return (
    <div className="python-error">
      <div className="python-error-message">{error.friendly_error}</div>
      {error.raw_traceback && (
        <>
          <button className="python-error-toggle" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? 'Hide details' : 'Show details'}
          </button>
          {showRaw && <pre className="python-error-traceback">{error.raw_traceback}</pre>}
        </>
      )}
    </div>
  );
}
