// Module-type worker (required: pyodide.asm.mjs is an ES module, classic
// workers' importScripts() doesn't support it). Verifies two things before
// any of polyraptor v2's custom-code-authoring UI gets built on top of them:
// (1) can this worker stream progress via postMessage during a synchronous
//     Python computation, or does everything only arrive after it finishes?
// (2) does the worker's own Pyodide/WASM execution actually block only this
//     worker's thread, leaving the page's main thread free?
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.mjs';

const pyodideReadyPromise = loadPyodide();

self.onmessage = async (event) => {
  const pyodide = await pyodideReadyPromise;
  const { type } = event.data;

  if (type === 'stream-test') {
    pyodide.globals.set('on_step_js', (jsonString) => {
      self.postMessage({ type: 'on_step', payload: jsonString });
    });
    // Deliberately a CPU-bound busy loop, not time.sleep -- this is what an
    // actual algorithm's expand loop looks like (real synchronous work
    // between events), and it removes any dependency on how Pyodide handles
    // sleep/threading semantics inside a worker from this specific test.
    await pyodide.runPythonAsync(`
import json
on_step_js(json.dumps({'i': -1, 'note': 'start'}))
for i in range(10):
    total = 0
    for j in range(6_000_000):
        total += j
    on_step_js(json.dumps({'i': i, 'total': total}))
`);
    self.postMessage({ type: 'stream-test-done' });
  } else if (type === 'hang-test') {
    self.postMessage({ type: 'hang-test-started' });
    await pyodide.runPythonAsync('while True:\n    pass\n');
    // never reached if terminate() arrives, which is exactly what's tested
  } else if (type === 'trivial') {
    const result = pyodide.runPython('1 + 1');
    self.postMessage({ type: 'trivial-result', payload: result });
  }
};
