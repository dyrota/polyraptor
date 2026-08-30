import type { AuthoredProblem, SearchTrace } from './types';
import { deriveSearchVisualState } from './deriveVisualState';

// Lower priority than the maze per the plan (maze is the hero visual) — kept
// functional and correct, not gold-plated. NQueensProblem's operators are all
// literally named 'operator' (verified against source), so this renders off
// the state itself (columns filled left-to-right, value = row) rather than
// anything operator-name-based.
export function NQueensBoard({ problem, trace }: { problem: AuthoredProblem; trace: SearchTrace | null }) {
  const n = problem.n ?? 8;
  const atEnd = trace ? trace.currentSeq >= trace.entries.length - 1 : false;
  const finalState = atEnd && trace?.summary.path ? (trace.summary.path[trace.summary.path.length - 1] as number[]) : null;
  const visual = trace ? deriveSearchVisualState(trace.entries, trace.currentSeq) : null;
  const liveState = (finalState ?? (visual?.currentState as number[] | null)) ?? [];

  const cell = 32;

  return (
    <div className="nqueens-wrapper">
      <svg width={n * cell} height={n * cell}>
        {Array.from({ length: n }).map((_, row) =>
          Array.from({ length: n }).map((_, col) => (
            <rect
              key={`${row}-${col}`}
              x={col * cell}
              y={row * cell}
              width={cell}
              height={cell}
              fill={(row + col) % 2 === 0 ? '#3d3227' : '#211a14'}
            />
          ))
        )}
        {liveState.map((row, col) => (
          <text
            key={col}
            x={col * cell + cell / 2}
            y={row * cell + cell / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={cell * 0.7}
            fill="#e6edf3"
          >
            ♛
          </text>
        ))}
      </svg>
      <p className="nqueens-caption">
        {finalState ? `Solved: ${n}-queens placed with no conflicts.` : `Placing queens column by column (${liveState.length}/${n})...`}
      </p>
    </div>
  );
}
