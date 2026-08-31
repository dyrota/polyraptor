import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './shared/ErrorBoundary';
import './index.css';

// Root-level boundary as a genuine last resort. The panels each wrap their own
// result areas, so anything reaching here is a bug outside those -- but the
// alternative is React unmounting the entire tree and leaving a blank white
// page with the failure visible only in the console, which for a live demo is
// the worst possible way to fail.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary
      fallback={
        <div className="error-boundary-fallback">
          Something went wrong. Reload the page to start over — nothing here is saved to a server.
        </div>
      }
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
