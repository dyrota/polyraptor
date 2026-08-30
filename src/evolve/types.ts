export interface JointGene {
  amplitude: number;
  frequency: number;
  phase: number;
}

export interface Genome {
  joints: JointGene[];
}

export interface Creature {
  id: number;
  genome: Genome;
  fitness: number | null;
}

export type SelectionStrategy = 'tournament' | 'roulette' | 'elitism';

export interface EvolveParams {
  population_size: number;
  mutation_rate: number;
  mutation_amount: number;
  crossover_rate: number;
  simulation_ticks: number;
  selection_strategy: SelectionStrategy;
  elite_count: number;
}

export interface GenerationHistoryEntry {
  generation: number;
  best_fitness: number;
  avg_fitness: number;
}

export interface EvolveState {
  params: EvolveParams;
  population: Creature[];
  generation: number;
  history: GenerationHistoryEntry[];
  bestEverGenome: Genome | null;
  bestEverFitness: number;
  protectedIds: Set<number>;
}
