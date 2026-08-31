import type {
  VerificationReport,
  AdmissibilityCounterexample,
  ConsistencyCounterexample,
  GoalZeroCounterexample,
} from './verifyHeuristic';
import { summarizeVerdict } from './verifyHeuristic';

// Renders a verification verdict for a human. Deliberately leads with the
// VERDICT rather than three green ticks: "proven" and "unrefuted" both have
// every property "holding", and collapsing them into the same visual would
// teach precisely the wrong lesson -- that failing to find a counterexample is
// the same as there not being one.
function fmtState(state: unknown): string {
  if (Array.isArray(state)) return `(${state.join(', ')})`;
  if (state === null || state === undefined) return '—';
  if (typeof state === 'object') return JSON.stringify(state);
  return String(state);
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function PropertyRow({
  label,
  holds,
  checked,
  detail,
  vacuous,
}: {
  label: string;
  holds: boolean;
  checked: number;
  detail?: string;
  vacuous?: boolean;
}) {
  const status = vacuous ? 'not checked' : holds ? 'holds' : 'violated';
  const cls = vacuous ? 'verify-row-skip' : holds ? 'verify-row-ok' : 'verify-row-bad';
  return (
    <div className={`verify-row ${cls}`}>
      <span className="verify-row-label">{label}</span>
      <span className="verify-row-status">{status}</span>
      <span className="verify-row-checked">{vacuous ? '0 checked' : `${checked.toLocaleString()} checked`}</span>
      {detail && <div className="verify-row-detail">{detail}</div>}
    </div>
  );
}

export function VerificationCard({ report }: { report: VerificationReport }) {
  const admCe = report.admissible.counterexample as AdmissibilityCounterexample | null;
  const conCe = report.consistent.counterexample as ConsistencyCounterexample | null;
  const gzCe = report.goal_zero.counterexample as GoalZeroCounterexample | null;

  // Admissibility is only meaningful once at least one goal state was found --
  // otherwise there is no true remaining cost to compare against and the pass
  // is vacuous.
  const admVacuous = report.admissible.checked === 0;

  return (
    <div className={`verify-card verify-${report.verdict}`}>
      <div className="verify-verdict">
        <span className="verify-verdict-tag">{report.verdict}</span>
        <span className="verify-verdict-text">{summarizeVerdict(report)}</span>
      </div>

      <PropertyRow
        label="goal-zero — h(goal) = 0"
        holds={report.goal_zero.holds}
        checked={report.goal_zero.checked}
        vacuous={report.goal_zero.checked === 0}
        detail={gzCe ? `h${fmtState(gzCe.state)} = ${round(gzCe.h_value)}, but that state is a goal — it should be 0.` : undefined}
      />
      <PropertyRow
        label="admissible — h(n) ≤ h*(n)"
        holds={report.admissible.holds}
        checked={report.admissible.checked}
        vacuous={admVacuous}
        detail={
          admCe
            ? `At ${fmtState(admCe.state)} your heuristic says ${round(admCe.h_value)}, but the true remaining cost is ${round(
                admCe.true_cost
              )} — an overestimate of ${round(admCe.overestimate_by)}. A* can return a non-optimal path because of this.`
            : undefined
        }
      />
      <PropertyRow
        label="consistent — h(n) ≤ c(n,n′) + h(n′)"
        holds={report.consistent.holds}
        checked={report.consistent.checked}
        detail={
          conCe
            ? `Moving ${fmtState(conCe.state)} → ${fmtState(conCe.successor)} costs ${round(conCe.edge_cost)}, but h drops from ${round(
                conCe.h_value
              )} to ${round(conCe.successor_h)} — a drop of ${round(conCe.h_value - conCe.successor_h)}, which is ${round(
                conCe.violation_by
              )} more than the step actually costs.`
            : undefined
        }
      />

      <div className="verify-meta">
        {report.states_explored.toLocaleString()} states explored
        {report.budget_exceeded && ' (budget reached — exploration was cut short)'}
        {' · '}
        {report.goal_states_found} goal state{report.goal_states_found === 1 ? '' : 's'} found
        {report.optimal_cost_from_initial !== null && (
          <> · true optimal cost from start: {round(report.optimal_cost_from_initial)}</>
        )}
      </div>
    </div>
  );
}
