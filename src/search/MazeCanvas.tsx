import { useEffect, useRef } from 'react';
import type { AuthoredProblem, SearchTrace } from './types';
import { deriveSearchVisualState, isStateIn } from './deriveVisualState';

const CELL_SIZE = 28;

// Canvas rendering is kept imperative and outside React's reconciliation —
// per the plan doc, this is a ref + effect-driven draw loop, not per-cell JSX.
export function MazeCanvas({ problem, trace }: { problem: AuthoredProblem; trace: SearchTrace | null }) {
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

        let fill = '#f5f5f5';
        if (isWall) fill = '#2b2b2b';
        else if (pathSet.has(key)) fill = '#4caf50';
        else if (visual && isStateIn(visual.expanded, state)) fill = '#90caf9';
        else if (visual && isStateIn(visual.frontier, state)) fill = '#fff59d';
        else if (visual && isStateIn(visual.rejected, state)) fill = '#ffcdd2';

        ctx.fillStyle = fill;
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        ctx.strokeStyle = '#ddd';
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
    if (problem.start) drawMarker(problem.start, 'S', '#1565c0');
    if (problem.goal) drawMarker(problem.goal, 'G', '#c62828');

    // Current-event highlight ring
    if (visual?.currentState) {
      const [r, c] = visual.currentState as [number, number];
      ctx.strokeStyle = '#ff6f00';
      ctx.lineWidth = 3;
      ctx.strokeRect(c * CELL_SIZE + 2, r * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.lineWidth = 1;
    }
  }, [problem, trace, trace?.currentSeq, trace?.entries.length]);

  return (
    <div className="maze-canvas-wrapper">
      <canvas ref={canvasRef} />
      <div className="maze-legend">
        <span><i className="swatch" style={{ background: '#90caf9' }} /> expanded</span>
        <span><i className="swatch" style={{ background: '#fff59d' }} /> frontier</span>
        <span><i className="swatch" style={{ background: '#ffcdd2' }} /> rejected</span>
        <span><i className="swatch" style={{ background: '#4caf50' }} /> solution path</span>
      </div>
    </div>
  );
}
