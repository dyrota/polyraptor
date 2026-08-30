import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/toolCallLog';
import { setParams, advanceGenerations, selectSurvivor, breedPair, resetEvolve } from '../evolve/ga';
import { evolveStore } from '../evolve/state';
import type { EvolveParams } from '../evolve/types';

// Evolve is JS-native and incremental (no Pyodide, no trace_id/playback) —
// every tool here mutates evolveStore directly and returns a snapshot summary.
function summarizeState() {
  const s = evolveStore.getState();
  const latest = s.history[s.history.length - 1];
  return {
    generation: s.generation,
    population_size: s.population.length,
    best_fitness: latest ? latest.best_fitness : null,
    average_fitness: latest ? latest.avg_fitness : null,
    best_ever_fitness: s.bestEverFitness === -Infinity ? null : s.bestEverFitness,
    history: s.history,
  };
}

export const evolveTools: ToolDefinition<never>[] = [
  {
    name: 'evolve_set_params',
    description:
      'Re-seed a fresh population of simple 2-jointed creatures with the given genetic algorithm parameters. ' +
      'Starts back at generation 0. Fitness is horizontal distance moved after simulation_ticks physics steps.',
    inputSchema: {
      type: 'object',
      properties: {
        population_size: { type: 'integer', minimum: 8, maximum: 60, description: 'Default 20.' },
        mutation_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Per-gene mutation probability. Default 0.1.' },
        mutation_amount: { type: 'number', minimum: 0, description: 'Mutation step size. Default 0.2.' },
        crossover_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Probability of crossing two parents vs cloning one. Default 0.5.' },
        simulation_ticks: { type: 'integer', minimum: 30, maximum: 2000, description: 'Physics steps per fitness evaluation. Default 300.' },
        selection_strategy: { type: 'string', enum: ['tournament', 'roulette', 'elitism'], description: 'Default tournament.' },
        elite_count: { type: 'integer', minimum: 0, maximum: 10, description: 'Top-N always carried over unchanged. Default 2.' },
      },
      required: [],
    },
    execute: logged('evolve_set_params', async (args: Partial<EvolveParams>) => {
      setParams(args);
      return JSON.stringify(summarizeState());
    }),
  },
  {
    name: 'evolve_advance_generation',
    description:
      'Advance the population by one or more generations: evaluate fitness, select survivors, breed the next ' +
      'generation. Multi-generation requests fast-forward the simulation (not rendered in real time) and only ' +
      'animate the resulting best creature afterward. Returns the resulting generation number and fitness stats.',
    inputSchema: {
      type: 'object',
      properties: { generations: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 1.' } },
      required: [],
    },
    execute: logged('evolve_advance_generation', async (args: { generations?: number }) => {
      advanceGenerations(args.generations ?? 1);
      return JSON.stringify(summarizeState());
    }),
  },
  {
    name: 'evolve_select_survivor',
    description: 'Protect a specific creature (by id) so it always survives into the next generation regardless of fitness rank.',
    inputSchema: {
      type: 'object',
      properties: {
        creature_id: { type: 'integer' },
        force_survive: { type: 'boolean', description: 'Default true. Pass false to un-protect.' },
      },
      required: ['creature_id'],
    },
    execute: logged('evolve_select_survivor', async (args: { creature_id: number; force_survive?: boolean }) => {
      selectSurvivor(args.creature_id, args.force_survive ?? true);
      return JSON.stringify(summarizeState());
    }),
  },
  {
    name: 'evolve_breed_pair',
    description:
      'Immediately crossover two specific creatures from the current population by id, replacing the current ' +
      'worst (unprotected) performer with their mutated offspring.',
    inputSchema: {
      type: 'object',
      properties: { parent_a_id: { type: 'integer' }, parent_b_id: { type: 'integer' } },
      required: ['parent_a_id', 'parent_b_id'],
    },
    execute: logged('evolve_breed_pair', async (args: { parent_a_id: number; parent_b_id: number }) => {
      const child = breedPair(args.parent_a_id, args.parent_b_id);
      return JSON.stringify({ child_id: child.id, fitness: child.fitness });
    }),
  },
  {
    name: 'evolve_get_population_state',
    description: 'Get the current generation number, every creature\'s id and fitness, and the fitness history.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: logged('evolve_get_population_state', async () => {
      const s = evolveStore.getState();
      return JSON.stringify({
        ...summarizeState(),
        population: s.population.map((c) => ({ id: c.id, fitness: c.fitness })),
        protected_ids: [...s.protectedIds],
      });
    }),
  },
  {
    name: 'evolve_reset',
    description: 'Reset the evolve family entirely: clears the population, generation counter, and fitness history.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: logged('evolve_reset', async () => {
      resetEvolve();
      return JSON.stringify({ reset: true });
    }),
  },
];
