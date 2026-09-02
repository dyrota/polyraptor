import { runUntrusted } from '../pyodide/workerBridge';
import type { FriendlyError } from '../pyodide/friendlyErrors';

// Validating a student-authored `algorithm` function, for either family.
//
// The two families' versions of this were byte-identical apart from the name
// they were exported under -- which makes sense, because nothing here is
// family-specific: at author time there is no problem bound yet, so all this
// can do is exec the source and read the signature. The differences between
// search and sort only appear at RUN time, where the problem has to be
// constructed, and that half stays in each family's own runPythonAlgorithm.ts.

// Distinct global name from runPythonProblem.ts's `_student_source` (used for
// the problem side), so both can be bound as extraGlobals in the same call
// without colliding.
export const EXEC_STUDENT_ALGORITHM = `
_student_algo_globals = {}
exec(compile(_student_algorithm_source, '<your code>', 'exec'), _student_algo_globals)
if 'algorithm' not in _student_algo_globals:
    raise NameError("name 'algorithm' is not defined")
_AlgorithmFn = _student_algo_globals['algorithm']
if not callable(_AlgorithmFn):
    raise TypeError('\`algorithm\` must be a function.')
`;

export interface AuthorPythonAlgorithmResult {
  valid: boolean;
  accepts_on_step?: boolean;
  kind?: string;
  friendly_error?: string;
  raw_traceback?: string;
}

// Lighter-weight than problem authoring: no problem exists yet to run against,
// so this only execs the source (still through the worker+timeout --
// module-level code runs on exec() regardless of whether the function is ever
// called) and inspects the function's signature, never calling it.
export async function authorPythonAlgorithm(sourceCode: string): Promise<AuthorPythonAlgorithmResult> {
  const python = `
${EXEC_STUDENT_ALGORITHM}
import inspect
_sig = inspect.signature(_AlgorithmFn)
if len(_sig.parameters) < 1:
    raise TypeError('\`algorithm\` must accept at least one parameter (the problem).')
import json
json.dumps({'accepts_on_step': 'on_step' in _sig.parameters})
`;
  const result = await runUntrusted(python, { _student_algorithm_source: sourceCode });
  if (!result.ok) {
    const err = result.error as FriendlyError;
    return { valid: false, kind: err.kind, friendly_error: err.friendly_message, raw_traceback: err.raw_traceback };
  }
  const { accepts_on_step } = JSON.parse(result.result ?? '{}') as { accepts_on_step: boolean };
  return { valid: true, accepts_on_step };
}
