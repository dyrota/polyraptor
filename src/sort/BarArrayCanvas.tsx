import { useEffect, useRef } from 'react';
import type { AuthoredSortProblem, SortTrace } from './types';
import { deriveSortVisualState } from './deriveVisualState';
import { VIZ } from '../shared/vizColors';

// The values a comparator verification was refuted on, each tagged with the
// letter the verdict card calls it. Matched by VALUE rather than by index --
// a comparator is a function of values, the counterexample names values, and
// after a partial sort the value that was `a` is no longer at the index it
// started at. Every bar holding that value is marked, since the comparator
// misbehaves on it wherever it appears.
export interface CounterexampleMark {
  value: number;
  role: string;
}

const MAIN_HEIGHT = 180;
const AUX_HEIGHT = 40;
const MARK_HEIGHT = 24;
const MIN_BAR_GAP = 1;
const CE_LABEL_HEIGHT = 16;

const HIGHLIGHT_COLOR: Record<string, string> = {
  compare: VIZ.yellow,
  swap: VIZ.vermillion,
  write: VIZ.purple,
};

// Same imperative ref + useEffect pattern as MazeCanvas — canvas rendering is
// kept outside React's reconciliation on purpose.
export function BarArrayCanvas({
  problem,
  trace,
  counterexample,
}: {
  problem: AuthoredSortProblem;
  trace: SortTrace | null;
  counterexample?: CounterexampleMark[] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !problem.values.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const n = problem.values.length;
    const width = Math.max(480, n * 6);
    // Derived ONCE per draw. This used to be called a second time further down
    // for `visual`, so every frame replayed the whole trace twice -- and a
    // trace is routinely tens of thousands of events (bubble sort on 300
    // elements is ~45,000), replayed from seq 0 on each step of the animation.
    const visual = trace ? deriveSortVisualState(problem.values, trace.entries, trace.currentSeq) : null;
    const auxBuffers = visual ? Object.keys(visual.auxiliary) : [];
    // Role letters are drawn above the bars, so they need headroom that the
    // plot would otherwise use.
    const ceMarks = counterexample?.length ? counterexample : null;
    const topPad = ceMarks ? CE_LABEL_HEIGHT : 0;
    const height = topPad + MAIN_HEIGHT + MARK_HEIGHT + auxBuffers.length * AUX_HEIGHT + 20;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    const atEnd = trace ? trace.currentSeq >= trace.entries.length - 1 : false;
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
    const mainBottom = topPad + MAIN_HEIGHT;
    const baselineY = mainBottom - ((0 - dataMin) / span) * plotHeight;
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
      const valueY = mainBottom - ((value - dataMin) / span) * plotHeight;
      const top = Math.min(valueY, baselineY);
      const barHeight = Math.max(2, Math.abs(baselineY - valueY));
      const x = i * (barWidth + MIN_BAR_GAP);
      const highlight = visual?.highlighted[i];
      ctx.fillStyle = highlight ? HIGHLIGHT_COLOR[highlight] : atEnd ? VIZ.green : VIZ.sky;
      ctx.fillRect(x, top, barWidth, barHeight);

      // Outline + role letter, matching MazeCanvas's treatment of a refuted
      // state: the point of a counterexample is that you can look at it.
      const mark = ceMarks?.find((m) => m.value === raw);
      if (mark) {
        ctx.strokeStyle = VIZ.vermillion;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 0.5, top - 1, barWidth + 1, barHeight + 2);
        ctx.lineWidth = 1;
        ctx.fillStyle = VIZ.vermillion;
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(mark.role, x + barWidth / 2, topPad - 4);
      }
    }

    // Auxiliary buffer strips (key/left/right/count/output/negatives/...).
    let auxY = mainBottom + 10;
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
  }, [problem, trace, trace?.currentSeq, trace?.entries.length, counterexample]);

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
        {counterexample?.length ? (
          <span>
            <i className="swatch swatch-outline" style={{ borderColor: VIZ.vermillion }} /> counterexample
          </span>
        ) : null}
      </div>
    </div>
  );
}
