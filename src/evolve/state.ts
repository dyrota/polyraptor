import { createStore } from '../shared/store';
import type { EvolveState } from './types';

// Evolve deliberately does not use shared/traceStore or the playback_* tools
// — per the plan, it's naturally incremental (driven generation-by-generation
// by repeated tool calls), not a run-once-then-replay trace like search/sort.
export const evolveStore = createStore<EvolveState>({
  params: {
    population_size: 20,
    mutation_rate: 0.1,
    mutation_amount: 0.2,
    crossover_rate: 0.5,
    simulation_ticks: 300,
    selection_strategy: 'tournament',
    elite_count: 2,
  },
  population: [],
  generation: 0,
  history: [],
  bestEverGenome: null,
  bestEverFitness: -Infinity,
  protectedIds: new Set(),
});
