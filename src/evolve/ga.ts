import Matter from 'matter-js';
import { buildCreatureBodies, centroidX, driveCreature, randomGenome } from './creature';
import { evolveStore } from './state';
import type { Creature, EvolveParams, EvolveState, Genome, SelectionStrategy } from './types';

const GROUND_Y = 300;
const START_X = 100;
const PHYSICS_TICK_MS = 1000 / 60;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Headless, unrendered simulation — this is what makes "advance N generations"
// fast regardless of N. No canvas, no requestAnimationFrame: just repeated
// Matter.Engine.update() calls in a tight loop. The only place a *rendered*,
// real-time version of this same physics runs is EvolvePanel's watch-effect,
// which replays a single already-evaluated genome for the human to see.
export function evaluateFitness(genome: Genome, ticks: number): number {
  const engine = Matter.Engine.create({ gravity: { x: 0, y: 1 } });
  const ground = Matter.Bodies.rectangle(2000, GROUND_Y + 20, 6000, 40, { isStatic: true, friction: 1 });
  const { segments, constraints } = buildCreatureBodies(genome, START_X, GROUND_Y - 40);
  Matter.Composite.add(engine.world, [ground, ...segments, ...constraints]);

  const startX = centroidX(segments);
  for (let t = 0; t < ticks; t++) {
    driveCreature(genome, segments, (t * PHYSICS_TICK_MS) / 1000);
    Matter.Engine.update(engine, PHYSICS_TICK_MS);
  }
  return centroidX(segments) - startX;
}

function mutateGenome(genome: Genome, rate: number, amount: number): Genome {
  return {
    joints: genome.joints.map((j) => ({
      amplitude: Math.random() < rate ? Math.max(0.5, j.amplitude + (Math.random() * 2 - 1) * amount * 10) : j.amplitude,
      frequency: Math.random() < rate ? Math.max(0.1, j.frequency + (Math.random() * 2 - 1) * amount * 2) : j.frequency,
      phase: Math.random() < rate ? j.phase + (Math.random() * 2 - 1) * amount * Math.PI : j.phase,
    })),
  };
}

function crossoverGenomes(a: Genome, b: Genome): Genome {
  return { joints: a.joints.map((jointA, i) => (Math.random() < 0.5 ? jointA : b.joints[i])) };
}

function selectParent(population: Creature[], strategy: SelectionStrategy): Creature {
  if (strategy === 'tournament') {
    let best: Creature = population[Math.floor(Math.random() * population.length)];
    for (let i = 0; i < 2; i++) {
      const candidate = population[Math.floor(Math.random() * population.length)];
      if ((candidate.fitness ?? -Infinity) > (best.fitness ?? -Infinity)) best = candidate;
    }
    return best;
  }
  if (strategy === 'roulette') {
    const minFitness = Math.min(...population.map((c) => c.fitness ?? 0));
    const shift = minFitness < 0 ? -minFitness + 1 : 1;
    const weights = population.map((c) => (c.fitness ?? 0) + shift);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < population.length; i++) {
      r -= weights[i];
      if (r <= 0) return population[i];
    }
    return population[population.length - 1];
  }
  // elitism-as-selection: pick uniformly from the fitter half.
  const sorted = [...population].sort((a, b) => (b.fitness ?? -Infinity) - (a.fitness ?? -Infinity));
  const topHalf = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
  return topHalf[Math.floor(Math.random() * topHalf.length)];
}

let nextCreatureId = 1;
function seedPopulation(size: number): Creature[] {
  return Array.from({ length: size }, () => ({ id: nextCreatureId++, genome: randomGenome(), fitness: null }));
}

function ensureFitness(population: Creature[], ticks: number): Creature[] {
  return population.map((c) => (c.fitness === null ? { ...c, fitness: evaluateFitness(c.genome, ticks) } : c));
}

function advanceOneGeneration(state: EvolveState): EvolveState {
  let population = state.population.length ? state.population : seedPopulation(state.params.population_size);
  population = ensureFitness(population, state.params.simulation_ticks);

  const sorted = [...population].sort((a, b) => (b.fitness ?? -Infinity) - (a.fitness ?? -Infinity));
  const bestFitness = sorted[0].fitness ?? 0;
  const avgFitness = population.reduce((sum, c) => sum + (c.fitness ?? 0), 0) / population.length;
  const improved = bestFitness > state.bestEverFitness;

  const eliteIds = new Set(sorted.slice(0, state.params.elite_count).map((c) => c.id));
  const carryOver = population.filter((c) => eliteIds.has(c.id) || state.protectedIds.has(c.id));
  const nextGeneration: Creature[] = carryOver.map((c) => ({ ...c }));

  while (nextGeneration.length < state.params.population_size) {
    const parentA = selectParent(population, state.params.selection_strategy);
    let childGenome =
      Math.random() < state.params.crossover_rate
        ? crossoverGenomes(parentA.genome, selectParent(population, state.params.selection_strategy).genome)
        : parentA.genome;
    childGenome = mutateGenome(childGenome, state.params.mutation_rate, state.params.mutation_amount);
    nextGeneration.push({ id: nextCreatureId++, genome: childGenome, fitness: null });
  }

  return {
    ...state,
    population: nextGeneration,
    generation: state.generation + 1,
    history: [...state.history, { generation: state.generation + 1, best_fitness: bestFitness, avg_fitness: avgFitness }],
    bestEverGenome: improved ? sorted[0].genome : state.bestEverGenome,
    bestEverFitness: improved ? bestFitness : state.bestEverFitness,
  };
}

const DEFAULT_PARAMS: EvolveParams = {
  population_size: 20,
  mutation_rate: 0.1,
  mutation_amount: 0.2,
  crossover_rate: 0.5,
  simulation_ticks: 300,
  selection_strategy: 'tournament',
  elite_count: 2,
};

export function setParams(overrides: Partial<EvolveParams>): EvolveState {
  const params: EvolveParams = {
    population_size: clamp(Math.floor(overrides.population_size ?? DEFAULT_PARAMS.population_size), 8, 60),
    mutation_rate: clamp(overrides.mutation_rate ?? DEFAULT_PARAMS.mutation_rate, 0, 1),
    mutation_amount: Math.max(0, overrides.mutation_amount ?? DEFAULT_PARAMS.mutation_amount),
    crossover_rate: clamp(overrides.crossover_rate ?? DEFAULT_PARAMS.crossover_rate, 0, 1),
    simulation_ticks: clamp(Math.floor(overrides.simulation_ticks ?? DEFAULT_PARAMS.simulation_ticks), 30, 2000),
    selection_strategy: overrides.selection_strategy ?? DEFAULT_PARAMS.selection_strategy,
    elite_count: clamp(Math.floor(overrides.elite_count ?? DEFAULT_PARAMS.elite_count), 0, 10),
  };
  const state: EvolveState = {
    params,
    population: [],
    generation: 0,
    history: [],
    bestEverGenome: null,
    bestEverFitness: -Infinity,
    protectedIds: new Set(),
  };
  evolveStore.setState(state);
  return state;
}

export function advanceGenerations(count: number): EvolveState {
  let state = evolveStore.getState();
  const n = clamp(Math.floor(count), 1, 200);
  for (let i = 0; i < n; i++) state = advanceOneGeneration(state);
  evolveStore.setState(state);
  return state;
}

export function selectSurvivor(creatureId: number, forceSurvive: boolean): void {
  const state = evolveStore.getState();
  const protectedIds = new Set(state.protectedIds);
  if (forceSurvive) protectedIds.add(creatureId);
  else protectedIds.delete(creatureId);
  evolveStore.setState({ ...state, protectedIds });
}

export function breedPair(parentAId: number, parentBId: number): Creature {
  const state = evolveStore.getState();
  const parentA = state.population.find((c) => c.id === parentAId);
  const parentB = state.population.find((c) => c.id === parentBId);
  if (!parentA || !parentB) throw new Error(`Unknown creature id(s): ${parentAId}, ${parentBId}`);

  let genome = crossoverGenomes(parentA.genome, parentB.genome);
  genome = mutateGenome(genome, state.params.mutation_rate, state.params.mutation_amount);
  const fitness = evaluateFitness(genome, state.params.simulation_ticks);
  const child: Creature = { id: nextCreatureId++, genome, fitness };

  const sortedAscending = [...state.population].sort((a, b) => (a.fitness ?? -Infinity) - (b.fitness ?? -Infinity));
  const replaceTarget = sortedAscending.find((c) => !state.protectedIds.has(c.id)) ?? sortedAscending[0];
  const population = state.population.map((c) => (c.id === replaceTarget.id ? child : c));

  const improved = fitness > state.bestEverFitness;
  evolveStore.setState({
    ...state,
    population,
    bestEverGenome: improved ? genome : state.bestEverGenome,
    bestEverFitness: improved ? fitness : state.bestEverFitness,
  });
  return child;
}

export function resetEvolve(): void {
  evolveStore.setState({
    params: DEFAULT_PARAMS,
    population: [],
    generation: 0,
    history: [],
    bestEverGenome: null,
    bestEverFitness: -Infinity,
    protectedIds: new Set(),
  });
}
