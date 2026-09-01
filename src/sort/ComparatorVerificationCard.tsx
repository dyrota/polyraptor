import { PropertyRow, fmtValue, round } from '../shared/VerificationRow';
import { summarizeComparatorVerdict, type ComparatorVerificationReport } from './verifyComparator';

// Renders a comparator verdict for a human. Same deliberate choice as search's
// VerificationCard: lead with the VERDICT, not five green ticks. 'proven' and
// 'unrefuted' both have every property "holding", and collapsing them into one
// visual would teach precisely the wrong lesson.

// Comparator results are signs, and "-1" is not what anyone reads a comparison
// as. Rendering the RELATION instead ("5 < 3") is what makes a cycle legible at
// a glance -- the point of a counterexample is that you can see the
// contradiction, not decode it.
function rel(a: number, sign: number, b: number): string {
  const op = sign < 0 ? '<' : sign > 0 ? '>' : '=';
  return `${round(a)} ${op} ${round(b)}`;
}

export function ComparatorVerificationCard({ report }: { report: ComparatorVerificationReport }) {
  const totalCe = report.total.counterexample;
  const detCe = report.deterministic.counterexample;
  const antiCe = report.antisymmetric.counterexample;
  const transCe = report.transitive.counterexample;
  const eqCe = report.equivalence_transitive.counterexample;

  // A comparator that failed totality on every pair leaves the later laws with
  // nothing to check, so they hold vacuously. Naming that is the whole reason
  // PropertyRow has a `vacuous` state.
  const pairsVacuous = report.total.checked === 0;
  const triplesVacuous = report.transitive.checked === 0;

  return (
    <div className={`verify-card verify-${report.verdict}`}>
      <div className="verify-verdict">
        <span className="verify-verdict-tag">{report.verdict}</span>
        <span className="verify-verdict-text">{summarizeComparatorVerdict(report)}</span>
      </div>

      <PropertyRow
        label="total — returns a number for every pair"
        holds={report.total.holds}
        checked={report.total.checked}
        vacuous={pairsVacuous}
        unit="pairs"
        detail={
          totalCe
            ? `comparator(${fmtValue(totalCe.a)}, ${fmtValue(totalCe.b)}) ${totalCe.reason}. Every comparison ` +
              `algorithm branches on this value, so there is no order to speak of until it is a number.`
            : undefined
        }
      />
      <PropertyRow
        label="deterministic — same pair, same answer"
        holds={report.deterministic.holds}
        checked={report.deterministic.checked}
        vacuous={pairsVacuous}
        unit="pairs"
        detail={
          detCe
            ? `comparator(${fmtValue(detCe.a)}, ${fmtValue(detCe.b)}) returned ${fmtValue(detCe.first)} and then ` +
              `${fmtValue(detCe.second)} — ${detCe.reason}. The sorted output then depends on which pairs the ` +
              `algorithm happened to compare, so two algorithms disagree on the same input.`
            : undefined
        }
      />
      <PropertyRow
        label="antisymmetric — cmp(a,b) = −cmp(b,a)"
        holds={report.antisymmetric.holds}
        checked={report.antisymmetric.checked}
        vacuous={pairsVacuous}
        unit="pairs"
        detail={
          antiCe
            ? antiCe.reflexive
              ? `Your comparator says ${rel(antiCe.a, antiCe.a_vs_b, antiCe.b)} — but those are the same value, ` +
                `so it must return 0. A value that is not equal to itself has no stable position in the output.`
              : `Your comparator says ${rel(antiCe.a, antiCe.a_vs_b, antiCe.b)} and also ` +
                `${rel(antiCe.b, antiCe.b_vs_a, antiCe.a)} — both cannot be true. Which one wins depends on the ` +
                `order the algorithm passes them in.`
            : undefined
        }
      />
      <PropertyRow
        label="transitive — a < b and b < c ⟹ a < c"
        holds={report.transitive.holds}
        checked={report.transitive.checked}
        vacuous={triplesVacuous}
        unit="triples"
        detail={
          transCe
            ? `Your comparator says ${rel(transCe.a, transCe.a_vs_b, transCe.b)} and ` +
              `${rel(transCe.b, transCe.b_vs_c, transCe.c)}, but ${rel(transCe.a, transCe.a_vs_c, transCe.c)} — ` +
              `a cycle. There is no ordering of these three values that satisfies all three answers, so "sorted" ` +
              `is not defined for this input.`
            : undefined
        }
      />
      <PropertyRow
        label='equivalence — a = b and b = c ⟹ a = c'
        holds={report.equivalence_transitive.holds}
        checked={report.equivalence_transitive.checked}
        vacuous={triplesVacuous}
        unit="triples"
        detail={
          eqCe
            ? `Your comparator calls ${fmtValue(eqCe.a)} and ${fmtValue(eqCe.b)} equal, and ${fmtValue(eqCe.b)} and ` +
              `${fmtValue(eqCe.c)} equal, but says ${rel(eqCe.a, eqCe.a_vs_c, eqCe.c)}. "Equal" has to be all-or- ` +
              `nothing within a group; this is the classic symptom of a tolerance test like ` +
              `abs(a - b) < epsilon.`
            : undefined
        }
      />

      <div className="verify-meta">
        {report.values_checked.toLocaleString()} distinct value{report.values_checked === 1 ? '' : 's'} checked
        {report.budget_exceeded &&
          ` of ${report.distinct_values_in_dataset.toLocaleString()} (budget reached — the rest went unchecked)`}
        {' · '}
        {report.comparator_calls.toLocaleString()} comparator calls
        {' · '}
        dataset of {report.dataset_size.toLocaleString()}
      </div>
    </div>
  );
}
