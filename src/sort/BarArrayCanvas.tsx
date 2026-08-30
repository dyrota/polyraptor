import { useEffect, useRef } from 'react';
import type { AuthoredSortProblem, SortTrace } from './types';
import { deriveSortVisualState } from './deriveVisualState';

const MAIN_HEIGHT = 180;
const AUX_HEIGHT = 40;
const MARK_HEIGHT = 24;
const MIN_BAR_GAP = 1;

const HIGHLIGHT_COLOR: Record<string, string> = {
  compare: '#ffb300',
  swap: '#e53935',
  write: '#43a047',
};

// Same imperative ref + useEffect pattern as MazeCanvas — canvas rendering is
// kept outside React's reconciliation on purpose.
export function BarArrayCanvas({ problem, trace }: { problem: AuthoredSortProblem; trace: SortTrace | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !problem.values.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const n = problem.values.length;
    const width = Math.max(480, n * 6);
    const auxBuffers = trace ? Object.keys(deriveSortVisualState(problem.values, trace.entries, trace.currentSeq).auxiliary) : [];
    const height = MAIN_HEIGHT + MARK_HEIGHT + auxBuffers.length * AUX_HEIGHT + 20;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, width, height);

    const atEnd = trace ? trace.currentSeq >= trace.entries.length - 1 : false;
    const visual = trace ? deriveSortVisualState(problem.values, trace.entries, trace.currentSeq) : null;
    // At the very end, prefer the algorithm's own reported final_values over
    // the replayed array — radix_sort's writes never touch the 'main' buffer
    // (see deriveVisualState's comment), so replay alone would never show it
    // as sorted. Every other algorithm's replay already agrees with
    // final_values by construction, so this is a safe universal fallback.
    const mainValues = atEnd && trace ? trace.summary.final_values : (visual ? visual.mainValues : problem.values);

    const maxValue = Math.max(1, ...problem.values);
    const barWidth = Math.max(1, width / n - MIN_BAR_GAP);

    for (let i = 0; i < n; i++) {
      const value = mainValues[i] ?? 0;
      const barHeight = Math.max(2, (value / maxValue) * (MAIN_HEIGHT - 10));
      const x = i * (barWidth + MIN_BAR_GAP);
      const y = MAIN_HEIGHT - barHeight;
      const highlight = visual?.highlighted[i];
      ctx.fillStyle = highlight ? HIGHLIGHT_COLOR[highlight] : atEnd ? '#4caf50' : '#90caf9';
      ctx.fillRect(x, y, barWidth, barHeight);
    }

    // Auxiliary buffer strips (key/left/right/count/output/negatives/...).
    let auxY = MAIN_HEIGHT + 10;
    for (const bufferName of auxBuffers) {
      const values = visual?.auxiliary[bufferName] ?? {};
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(bufferName, 4, auxY + 12);
      const entries = Object.entries(values);
      const auxMax = Math.max(1, ...entries.map(([, v]) => v));
      for (const [idxStr, value] of entries) {
        const idx = Number(idxStr);
        const barHeight = Math.max(2, (value / auxMax) * (AUX_HEIGHT - 16));
        const x = 60 + idx * (barWidth + MIN_BAR_GAP);
        ctx.fillStyle = '#ce93d8';
        ctx.fillRect(x, auxY + AUX_HEIGHT - 4 - barHeight, Math.max(2, barWidth), barHeight);
      }
      auxY += AUX_HEIGHT;
    }

    // Current mark / status text.
    ctx.fillStyle = '#333';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const statusText = atEnd ? 'sorted' : visual?.markText ?? '';
    ctx.fillText(statusText, 4, height - 6);
  }, [problem, trace, trace?.currentSeq, trace?.entries.length]);

  return (
    <div className="bar-canvas-wrapper">
      <canvas ref={canvasRef} />
      <div className="maze-legend">
        <span>
          <i className="swatch" style={{ background: '#90caf9' }} /> unsorted
        </span>
        <span>
          <i className="swatch" style={{ background: '#ffb300' }} /> comparing
        </span>
        <span>
          <i className="swatch" style={{ background: '#e53935' }} /> swapping
        </span>
        <span>
          <i className="swatch" style={{ background: '#43a047' }} /> writing
        </span>
        <span>
          <i className="swatch" style={{ background: '#4caf50' }} /> sorted
        </span>
      </div>
    </div>
  );
}
