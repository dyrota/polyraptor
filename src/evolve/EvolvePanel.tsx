import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Matter from 'matter-js';
import { evolveStore } from './state';
import { setParams, advanceGenerations } from './ga';
import { buildCreatureBodies, centroidX, driveCreature, SEGMENT_HEIGHT, SEGMENT_WIDTH } from './creature';
import type { SelectionStrategy } from './types';

const GROUND_Y = 220;
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 260;
const PHYSICS_TICK_MS = 1000 / 60;

// Same imperative ref + useEffect pattern as MazeCanvas/BarArrayCanvas, except
// here the "draw loop" is also the physics loop — this is a live, rendered,
// real-time replay of one already-evaluated genome (the best one so far), not
// the fast headless simulation ga.ts uses to actually evaluate fitness. Those
// two are deliberately separate: advancing 10 generations must not take 10x
// as long as advancing 1, which it would if fitness evaluation were tied to
// requestAnimationFrame instead of a tight synchronous loop.
function WatchCanvas({ genomeKey, ticks }: { genomeKey: string; ticks: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useSyncExternalStore(evolveStore.subscribe, evolveStore.getState);
  const genome = state.bestEverGenome;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !genome) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const ctx = ctx2d; // stable non-null binding for the frame() closure below
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    const engine = Matter.Engine.create({ gravity: { x: 0, y: 1 } });
    const ground = Matter.Bodies.rectangle(3000, GROUND_Y + 20, 8000, 40, { isStatic: true, friction: 1 });
    const { segments, constraints } = buildCreatureBodies(genome, 80, GROUND_Y - 40);
    Matter.Composite.add(engine.world, [ground, ...segments, ...constraints]);
    const startX = centroidX(segments);

    let tick = 0;
    let rafHandle = 0;
    let cancelled = false;

    const frame = () => {
      if (cancelled) return;
      if (tick < ticks) {
        driveCreature(genome!, segments, (tick * PHYSICS_TICK_MS) / 1000);
        Matter.Engine.update(engine, PHYSICS_TICK_MS);
        tick++;
      }

      const camX = centroidX(segments) - CANVAS_WIDTH / 3;

      ctx.fillStyle = '#eaf4ff';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#6d4c41';
      ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, 4);

      ctx.fillStyle = '#2e7d32';
      for (const seg of segments) {
        ctx.save();
        ctx.translate(seg.position.x - camX, seg.position.y);
        ctx.rotate(seg.angle);
        ctx.fillRect(-SEGMENT_WIDTH / 2, -SEGMENT_HEIGHT / 2, SEGMENT_WIDTH, SEGMENT_HEIGHT);
        ctx.restore();
      }

      ctx.fillStyle = '#333';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(
        `tick ${tick}/${ticks} — displacement ${(centroidX(segments) - startX).toFixed(1)}px`,
        8,
        16
      );

      rafHandle = requestAnimationFrame(frame);
    };
    rafHandle = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genomeKey, ticks]);

  return <canvas ref={canvasRef} />;
}

function Sparkline({ history }: { history: { generation: number; best_fitness: number }[] }) {
  if (history.length < 2) return null;
  const width = 240;
  const height = 40;
  const values = history.map((h) => h.best_fitness);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / (max - min || 1)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="evolve-sparkline">
      <polyline points={points} fill="none" stroke="#2e7d32" strokeWidth={2} />
    </svg>
  );
}

// Mirrors SearchPanel/SortPanel: human controls and the evolve_* WebMCP tools
// read/write the same store.
export function EvolvePanel() {
  const state = useSyncExternalStore(evolveStore.subscribe, evolveStore.getState);
  const [populationSize, setPopulationSize] = useState(20);
  const [mutationRate, setMutationRate] = useState(0.1);
  const [selectionStrategy, setSelectionStrategy] = useState<SelectionStrategy>('tournament');
  const [running, setRunning] = useState(false);

  function handleNewPopulation() {
    setParams({ population_size: populationSize, mutation_rate: mutationRate, selection_strategy: selectionStrategy });
  }

  async function handleAdvance() {
    setRunning(true);
    try {
      advanceGenerations(1);
    } finally {
      setRunning(false);
    }
  }

  const latest = state.history[state.history.length - 1];

  return (
    <div className="evolve-panel">
      <div className="search-controls">
        <input
          type="number"
          min={8}
          max={60}
          value={populationSize}
          onChange={(e) => setPopulationSize(Number(e.target.value))}
          style={{ width: '4.5rem' }}
          title="Population size"
        />
        <select value={selectionStrategy} onChange={(e) => setSelectionStrategy(e.target.value as SelectionStrategy)}>
          <option value="tournament">tournament</option>
          <option value="roulette">roulette</option>
          <option value="elitism">elitism</option>
        </select>
        <button onClick={handleNewPopulation}>New Population</button>
        <button onClick={handleAdvance} disabled={running}>
          {running ? 'Advancing...' : 'Advance Generation'}
        </button>
      </div>

      {state.bestEverGenome ? (
        <div className="evolve-canvas-wrapper">
          <WatchCanvas genomeKey={JSON.stringify(state.bestEverGenome)} ticks={state.params.simulation_ticks} />
        </div>
      ) : (
        <p className="search-empty">
          Click "New Population", or ask your agent to start one (evolve_set_params), then advance generations
          (evolve_advance_generation) — a 2-jointed creature evolving to inch forward.
        </p>
      )}

      {latest && (
        <div className="search-summary">
          <strong>Generation {state.generation}</strong> — best fitness {latest.best_fitness.toFixed(1)}px, average{' '}
          {latest.avg_fitness.toFixed(1)}px
          <div>
            <Sparkline history={state.history} />
          </div>
        </div>
      )}
    </div>
  );
}
