import { useEffect, useRef } from 'react';
import type { AuthoredProblem, SearchTrace } from './types';
import { deriveSearchVisualState, isStateIn } from './deriveVisualState';
import { VIZ, BRAND } from '../shared/vizColors';

const CELL_SIZE = 28;

// Canvas rendering is kept imperative and outside React's reconciliation —
// per the plan doc, this is a ref + effect-driven draw loop, not per-cell JSX.
// counterexample: the state a heuristic verification refuted the heuristic on.
// Drawn last, as a distinct marker rather than a fill, so it stays legible on
// top of whatever the replay has already coloured that cell -- the whole value
// of the verification feature is being able to point at ONE cell and say "here
// is where your heuristic lies", which a fill blending into expanded/frontier
// colours would undercut.
export function MazeCanvas({
  problem,
  trace,
  counterexample,
}: {
  problem: AuthoredProblem;
  trace: SearchTrace | null;
  counterexample?: [number, number] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !problem.maze) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rows = problem.maze.length;
    const cols = problem.maze[0].length;
    canvas.width = cols * CELL_SIZE;
    canvas.height = rows * CELL_SIZE;

    const visual = trace ? deriveSearchVisualState(trace.entries, trace.currentSeq) : null;
    const atEnd = trace ? trace.currentSeq >= trace.entries.length - 1 : false;
    const pathCells = atEnd && trace?.summary.path ? (trace.summary.path as [number, number][]) : null;
    const pathSet = new Set(pathCells?.map((s) => JSON.stringify(s)) ?? []);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * CELL_SIZE;
        const y = r * CELL_SIZE;
        const isWall = problem.maze[r][c] === 1;
        const state: [number, number] = [r, c];
        const key = JSON.stringify(state);

        let fill = '#161b22';
        if (isWall) fill = '#010409';
        else if (pathSet.has(key)) fill = VIZ.green;
        else if (visual && isStateIn(visual.expanded, state)) fill = VIZ.blue;
        else if (visual && isStateIn(visual.frontier, state)) fill = VIZ.yellow;
        else if (visual && isStateIn(visual.rejected, state)) fill = VIZ.vermillion;

        ctx.fillStyle = fill;
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        ctx.strokeStyle = '#30363d';
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }

    // Start / goal markers
    const drawMarker = (pos: [number, number], label: string, color: string) => {
      const x = pos[1] * CELL_SIZE + CELL_SIZE / 2;
      const y = pos[0] * CELL_SIZE + CELL_SIZE / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, CELL_SIZE * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `${CELL_SIZE * 0.45}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 1);
    };
    if (problem.start) drawMarker(problem.start, 'S', VIZ.sky);
    if (problem.goal) drawMarker(problem.goal, 'G', VIZ.purple);

    // Current-event highlight ring
    if (visual?.currentState) {
      const [r, c] = visual.currentState as [number, number];
      ctx.strokeStyle = BRAND;
      ctx.lineWidth = 3;
      ctx.strokeRect(c * CELL_SIZE + 2, r * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.lineWidth = 1;
    }

    if (counterexample && counterexample.length === 2) {
      const [r, c] = counterexample;
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        const x = c * CELL_SIZE;
        const y = r * CELL_SIZE;
        ctx.strokeStyle = VIZ.vermillion;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 5);
        ctx.lineTo(x + CELL_SIZE - 5, y + CELL_SIZE - 5);
        ctx.moveTo(x + CELL_SIZE - 5, y + 5);
        ctx.lineTo(x + 5, y + CELL_SIZE - 5);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }, [problem, trace, trace?.currentSeq, trace?.entries.length, counterexample]);

  return (
    <div className="maze-canvas-wrapper">
      <canvas ref={canvasRef} />
      <div className="maze-legend">
        <span><i className="swatch" style={{ background: VIZ.blue }} /> expanded</span>
        <span><i className="swatch" style={{ background: VIZ.yellow }} /> frontier</span>
        <span><i className="swatch" style={{ background: VIZ.vermillion }} /> rejected</span>
        <span><i className="swatch" style={{ background: VIZ.green }} /> solution path</span>
        {counterexample && <span><i className="swatch swatch-outline" style={{ borderColor: VIZ.vermillion }} /> counterexample</span>}
      </div>
    </div>
  );
}
