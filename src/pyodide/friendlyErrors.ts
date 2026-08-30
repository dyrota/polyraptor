// Translates raw Python exception text into pedagogically useful messages.
// Shared by every custom-code runner (search + sort, problems + algorithms +
// heuristics/comparators) -- one table, not one per family, since the same
// Python exception shapes show up regardless of which slot the student was
// filling in. Never leads with the raw traceback; that's always available
// separately for a "show details" disclosure, never the first thing shown.

export interface FriendlyError {
  friendly_message: string;
  raw_message: string;
  raw_traceback: string;
  kind: string;
}

// The worker sends back { rawMessage, rawTraceback } captured via Python's
// own traceback module (see worker.ts) -- this runs on the main thread,
// translating that into something to show a human.
export function translateError(rawMessage: string, rawTraceback: string): FriendlyError {
  const base = { raw_message: rawMessage, raw_traceback: rawTraceback };

  // SyntaxError: Python's own message already names the line -- use it
  // directly rather than reimplementing syntax checking.
  const syntaxMatch = rawMessage.match(/^(?:invalid syntax|.*SyntaxError.*)/i);
  const lineMatch = rawTraceback.match(/File "<your code>", line (\d+)/);
  if (rawMessage.toLowerCase().includes('syntaxerror') || (syntaxMatch && lineMatch)) {
    const line = lineMatch ? lineMatch[1] : null;
    return {
      ...base,
      kind: 'syntax_error',
      friendly_message: line
        ? `Syntax error on line ${line}: ${rawMessage.replace(/^SyntaxError:\s*/i, '')}`
        : `Syntax error: ${rawMessage}`,
    };
  }

  // Python's exact wording has changed across versions -- confirmed by
  // actually triggering this in Python 3.14 (via Pyodide), not assumed:
  // "Can't instantiate abstract class Problem without an implementation for
  // abstract method 'comparator'" (older Python versions said "with
  // abstract method(s) a, b" instead). Match both so this doesn't silently
  // fall through to the generic fallback on a version bump either way.
  const abstractMatch = rawMessage.match(
    /Can't instantiate abstract class (\w+) (?:with (?:abstract )?methods?|without an implementation for abstract methods?)\s+(.+)/i
  );
  if (abstractMatch) {
    const [, className, methods] = abstractMatch;
    return {
      ...base,
      kind: 'missing_methods',
      friendly_message: `Your class \`${className}\` is missing required method(s): ${methods.trim()}.`,
    };
  }

  // AttributeError: 'X' object has no attribute 'y'
  const attrMatch = rawMessage.match(/'(\w+)' object has no attribute '(\w+)'/);
  if (attrMatch) {
    const [, , attr] = attrMatch;
    return {
      ...base,
      kind: 'attribute_error',
      friendly_message: `Your code uses \`${attr}\`, which isn't defined there — check for a typo or a missing method.`,
    };
  }

  // NameError: name 'y' is not defined
  const nameMatch = rawMessage.match(/name '(\w+)' is not defined/);
  if (nameMatch) {
    const [, name] = nameMatch;
    return {
      ...base,
      kind: 'name_error',
      friendly_message: `\`${name}\` is not defined — check for a typo, or a variable used before it's set.`,
    };
  }

  if (rawMessage.toLowerCase().includes('recursionerror') || rawMessage.toLowerCase().includes('maximum recursion depth')) {
    return {
      ...base,
      kind: 'recursion_error',
      friendly_message: 'Your code recursed too deeply — this usually means a recursive function that never reaches its base case.',
    };
  }

  // Fallback: keep the real exception type + message, just don't lead with
  // the full traceback.
  return {
    ...base,
    kind: 'other',
    friendly_message: rawMessage,
  };
}

export function timeoutError(timeoutMs: number): FriendlyError {
  return {
    kind: 'timeout',
    friendly_message: `Your code didn't finish within ${(timeoutMs / 1000).toFixed(0)} seconds. This usually means an infinite loop (a while condition that's never False) or unbounded recursion.`,
    raw_message: '(no Python exception -- execution was forcibly stopped)',
    raw_traceback: '',
  };
}

export function stoppedByUserError(): FriendlyError {
  return {
    kind: 'stopped',
    friendly_message: 'Stopped.',
    raw_message: '(no Python exception -- execution was stopped by the user)',
    raw_traceback: '',
  };
}
