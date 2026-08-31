// One Python-side helper for the last hop of every custom-code path: turning
// a value that came out of student code into something JS's strict JSON.parse
// will actually accept.
//
// Two distinct failures this exists for, both reachable from ordinary,
// correct-looking student code:
//
//  1. Python's json.dumps emits the bare tokens `Infinity`/`-Infinity`/`NaN`
//     for non-finite floats. Python's own json.loads round-trips them happily;
//     JS's JSON.parse throws a SyntaxError. `return float('inf')` is the
//     idiomatic way to write "this state is unreachable" in a heuristic, so
//     this was not a corner case — it was the textbook answer failing with a
//     JSON parse error that named nothing the student had written.
//     (search/runAlgorithm.ts's _polyraptor_sanitize already guarded the
//     built-in algorithms' cost field against exactly this; the custom-code
//     paths had no equivalent.)
//
//  2. json.dumps raises TypeError on anything it doesn't know — and a
//     StateSpaceProblem's states only have to be *hashable*, not
//     JSON-serializable. A frozenset or a small custom State class is a
//     perfectly good state representation, and authoring such a problem used
//     to fail with "Object of type frozenset is not JSON serializable",
//     translated into a friendly error blaming code that was fine.
//
// Falls back to repr() rather than dropping a value: for a preview/summary
// field, "the agent sees `frozenset({1, 2})` as a string" is strictly better
// than "the whole call fails".
export const PY_SAFE_JSON_HELPER = `
def _polyraptor_json_safe(v, _depth=0):
    if _depth > 20:
        return repr(v)
    if v is None or isinstance(v, (str, bool)):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        # NaN is the only value not equal to itself; inf/-inf compare directly.
        return None if (v != v or v in (float('inf'), float('-inf'))) else v
    if isinstance(v, dict):
        return {str(_k): _polyraptor_json_safe(_x, _depth + 1) for _k, _x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [_polyraptor_json_safe(_x, _depth + 1) for _x in v]
    return repr(v)
`;
