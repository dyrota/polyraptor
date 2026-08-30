// Tier 3, lower-risk on-ramp: a student writes only a bare `comparator(a, b)`
// function, not a full Problem class -- trusted `values` supply the rest.
// Wraps it into a synthetic, fully self-contained Problem-class source
// (embedding the trusted values literal + the student's comparator verbatim)
// and delegates entirely to the already-tested authorPythonSortProblem for
// validation -- a missing/broken comparator surfaces naturally as a clean
// NameError/TypeError when the wrapper's own comparator() method is called
// during that function's existing smoke test, no separate check needed here.
// The synthetic source is fully self-contained: re-execing it alone (via the
// standard path every other python_problem already uses) reproduces the
// exact same problem forever, with no dependency on anything beyond this
// one string -- so it can be stored and re-run exactly like any other
// custom problem, needing no new "run" tool at all.
import { authorPythonSortProblem, type AuthorPythonProblemResult } from './runPythonProblem';
import { pyIntListLiteral } from './runAlgorithm';

export function buildComparatorProblemSource(values: number[], comparatorSource: string): string {
  const valuesLiteral = pyIntListLiteral(values);
  return `from polysort.interfaces import SortProblem

${comparatorSource}

class Problem(SortProblem):
    def data(self):
        return ${valuesLiteral}

    def comparator(self, a, b):
        return comparator(a, b)
`;
}

export interface AuthorPythonComparatorResult extends AuthorPythonProblemResult {
  synthetic_source?: string;
}

export async function authorPythonSortComparator(
  values: number[],
  comparatorSource: string
): Promise<AuthorPythonComparatorResult> {
  const syntheticSource = buildComparatorProblemSource(values, comparatorSource);
  const result = await authorPythonSortProblem(syntheticSource);
  return result.valid ? { ...result, synthetic_source: syntheticSource } : result;
}
