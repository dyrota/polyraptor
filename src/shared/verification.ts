// The verdict vocabulary, shared by both families' verification features.
//
// Search verifies a heuristic against ground truth it has to compute by
// exhaustive exploration; sort verifies a comparator against the algebraic
// laws a sort needs it to obey. Different mathematics, identical epistemics --
// in both, the check is bounded by a budget, and hitting that budget makes the
// two "nothing found" outcomes mean genuinely different things:
//
//   refuted    a counterexample exists. Sound at ANY size: a violation found
//              among a subset is still a violation.
//   proven     the check ran to completion and found nothing. A real guarantee
//              (see each family's own note on precisely what is guaranteed).
//   unrefuted  the budget was hit first. Nothing found among what was checked,
//              which is NOT the same as the property holding.
//
// Keeping the union in one place is what stops the two families from drifting
// into describing the same three outcomes with different words -- the whole
// point of the feature is that the distinction is legible, and it stops being
// legible the moment each panel invents its own vocabulary for it.
export type VerificationVerdict = 'refuted' | 'proven' | 'unrefuted';

// `counterexample` rather than a bare boolean, everywhere: "your comparator is
// not transitive" is a grade, while "it says 3 < 5, 5 < 1, and 3 > 1" is
// something you can act on.
export interface PropertyResult<TCounterexample> {
  holds: boolean;
  checked: number;
  counterexample: TCounterexample | null;
}
