import type { SearchTrace } from './types';
import { deriveSearchVisualState } from './deriveVisualState';

// Lower priority than the maze per the plan — simple but functional.
export function MissionariesView({ trace }: { trace: SearchTrace | null }) {
  const atEnd = trace ? trace.currentSeq >= trace.entries.length - 1 : false;
  const finalState = atEnd && trace?.summary.path ? (trace.summary.path[trace.summary.path.length - 1] as number[]) : null;
  const visual = trace ? deriveSearchVisualState(trace.entries, trace.currentSeq) : null;
  const state = (finalState ?? (visual?.currentState as number[] | null)) ?? [3, 3, 1];
  const [missionaries, cannibals, boatPosition] = state;
  // The two counts in polysearch's (m, c, boat) state are ALWAYS the number
  // still on the starting bank -- verified against the wheel: move_1m
  // decrements them when the boat is at 1 and increments them when it is at 0,
  // and the goal is (0, 0, 0), everyone across. They do not flip with the boat.
  // Conditioning them on boat position (as this did) inverted every state where
  // the boat was on the right, so the solved state rendered all six people
  // still on the left under a caption saying they had crossed.
  const leftM = missionaries;
  const leftC = cannibals;
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

  // The caption sits OUTSIDE .mc-wrapper: that wrapper is a flex row, so a
  // caption inside it became a third column squeezed beside the right bank
  // rather than a line underneath the scene.
  return (
    <div className="mc-view">
      <div className="mc-wrapper">
        <Bank m={leftM} c={leftC} hasBoat={boatPosition === 1} />
        <div className="mc-river">river</div>
        <Bank m={rightM} c={rightC} hasBoat={boatPosition === 0} />
      </div>
      <p className="mc-caption">
        {finalState
          ? 'Solved: everyone crossed safely.'
          : `Starting bank: ${missionaries}m, ${cannibals}c — boat on the ${boatPosition === 1 ? 'left' : 'right'}`}
      </p>
    </div>
  );
}
