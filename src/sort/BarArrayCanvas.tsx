import { useEffect, useRef } from 'react';
import type { AuthoredSortProblem, SortTrace } from './types';
import { deriveSortVisualState } from './deriveVisualState';
import { VIZ } from '../shared/vizColors';

const MAIN_HEIGHT = 180;
const AUX_HEIGHT = 40;
const MARK_HEIGHT = 24;
const MIN_BAR_GAP = 1;

const HIGHLIGHT_COLOR: Record<string, string> = {
  compare: VIZ.yellow,
  swap: VIZ.vermillion,
  write: VIZ.purple,
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

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    const atEnd = trace ? trace.currentSeq >= trace.entries.length - 1 : false;
    const visual = trace ? deriveSortVisualState(problem.values, trace.entries, trace.currentSeq) : null;
    // At the very end, prefer the algorithm's own reported final_values over
    // the replayed array — radix_sort's writes never touch the 'main' buffer
    // (see deriveVisualState's comment), so replay alone would never show it
    // as sorted. Every other algorithm's replay already agrees with
    // final_values by construction, so this is a safe universal fallback.
    // final_values is absent for a tier-2 custom-algorithm trace (no
    // guaranteed return shape) -- fall back the same way the "not atEnd"
    // branch already does.
    const mainValues =
      atEnd && trace && trace.summary.final_values ? trace.summary.final_values : visual ? visual.mainValues : problem.values;

    // Scale across the full observed range rather than from an implicit zero.
    // With negative data (which polysort explicitly supports -- radix_sort has
    // dedicated 'negatives'/'non_negatives' buffers) the old `Math.max(1,
    // ...values)` made every bar clamp to the 2px minimum, so an all-negative
    // array rendered as a flat line that never appeared to sort. A baseline
    // drawn at zero keeps the sign readable when the range straddles it.
    const finite = problem.values.filter((v) => Number.isFinite(v));
    const dataMin = Math.min(0, ...finite);
    const dataMax = Math.max(0, ...finite);
    const span = dataMax - dataMin || 1;
    const plotHeight = MAIN_HEIGHT - 10;
    const baselineY = MAIN_HEIGHT - ((0 - dataMin) / span) * plotHeight;
    const barWidth = Math.max(1, width / n - MIN_BAR_GAP);

    if (dataMin < 0) {
      ctx.strokeStyle = '#30363d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, baselineY);
      ctx.lineTo(width, baselineY);
      ctx.stroke();
    }

    for (let i = 0; i < n; i++) {
      const raw = mainValues[i];
      const value = Number.isFinite(raw) ? raw : 0;
      const valueY = MAIN_HEIGHT - ((value - dataMin) / span) * plotHeight;
      const top = Math.min(valueY, baselineY);
      const barHeight = Math.max(2, Math.abs(baselineY - valueY));
      const x = i * (barWidth + MIN_BAR_GAP);
      const highlight = visual?.highlighted[i];
      ctx.fillStyle = highlight ? HIGHLIGHT_COLOR[highlight] : atEnd ? VIZ.green : VIZ.sky;
      ctx.fillRect(x, top, barWidth, barHeight);
    }

    // Auxiliary buffer strips (key/left/right/count/output/negatives/...).
    let auxY = MAIN_HEIGHT + 10;
    for (const bufferName of auxBuffers) {
      const values = visual?.auxiliary[bufferName] ?? {};
      ctx.fillStyle = '#b3bac2';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(bufferName, 4, auxY + 12);
      const entries = Object.entries(values);
      const auxMax = Math.max(1, ...entries.map(([, v]) => v));
      for (const [idxStr, value] of entries) {
        const idx = Number(idxStr);
        const barHeight = Math.max(2, (value / auxMax) * (AUX_HEIGHT - 16));
        const x = 60 + idx * (barWidth + MIN_BAR_GAP);
        ctx.fillStyle = VIZ.purple;
        ctx.fillRect(x, auxY + AUX_HEIGHT - 4 - barHeight, Math.max(2, barWidth), barHeight);
      }
      auxY += AUX_HEIGHT;
    }

    // Current mark / status text.
    ctx.fillStyle = '#e6edf3';
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
          <i className="swatch" style={{ background: VIZ.sky }} /> unsorted
        </span>
        <span>
          <i className="swatch" style={{ background: VIZ.yellow }} /> comparing
        </span>
        <span>
          <i className="swatch" style={{ background: VIZ.vermillion }} /> swapping
        </span>
        <span>
          <i className="swatch" style={{ background: VIZ.purple }} /> writing
        </span>
        <span>
          <i className="swatch" style={{ background: VIZ.green }} /> sorted
        </span>
      </div>
    </div>
  );
}
