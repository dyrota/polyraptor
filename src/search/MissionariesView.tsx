import type { SearchTrace } from './types';
import { deriveSearchVisualState } from './deriveVisualState';

// Lower priority than the maze per the plan — simple but functional.
export function MissionariesView({ trace }: { trace: SearchTrace | null }) {
  const atEnd = trace ? trace.currentSeq >= trace.entries.length - 1 : false;
  const finalState = atEnd && trace?.summary.path ? (trace.summary.path[trace.summary.path.length - 1] as number[]) : null;
  const visual = trace ? deriveSearchVisualState(trace.entries, trace.currentSeq) : null;
  const state = (finalState ?? (visual?.currentState as number[] | null)) ?? [3, 3, 1];
  const [missionaries, cannibals, boatPosition] = state;
  const leftM = boatPosition === 1 ? missionaries : 3 - missionaries;
  const leftC = boatPosition === 1 ? cannibals : 3 - cannibals;
  const rightM = 3 - leftM;
  const rightC = 3 - leftC;

  const Bank = ({ m, c, hasBoat }: { m: number; c: number; hasBoat: boolean }) => (
    <div className="mc-bank">
      <div className="mc-icons">
        {Array.from({ length: m }).map((_, i) => <span key={`m${i}`}>🧑‍🦱</span>)}
        {Array.from({ length: c }).map((_, i) => <span key={`c${i}`}>😈</span>)}
      </div>
      {hasBoat && <div className="mc-boat">⛵</div>}
    </div>
  );

  return (
    <div className="mc-wrapper">
      <Bank m={leftM} c={leftC} hasBoat={boatPosition === 1} />
      <div className="mc-river">river</div>
      <Bank m={rightM} c={rightC} hasBoat={boatPosition === 0} />
      <p className="mc-caption">
        {finalState ? 'Solved: everyone crossed safely.' : `State: (${missionaries}m, ${cannibals}c, boat on ${boatPosition === 1 ? 'left' : 'right'})`}
      </p>
    </div>
  );
}
