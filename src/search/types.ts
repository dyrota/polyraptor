// Discriminated union for polysearch's on_step events, per the plan doc's
// "Search" event schema. g/h/f are optional since only some algorithms track
// them (a_star: all three; best_first: h only; uniform_cost/branch_and_bound: g
// only; breadth_first/depth_first: none).

export interface ExpandEvent {
  type: 'expand';
  state: unknown;
  g?: number;
  h?: number;
  f?: number;
  frontier_size: number;
  inferences: number;
  restart_index?: number;
}

export interface GenerateEvent {
  type: 'generate';
  from_state: unknown;
  to_state: unknown;
  operator_name?: string | null;
  g?: number;
  h?: number;
  restart_index?: number;
}

export interface RejectEvent {
  type: 'reject';
  from_state: unknown;
  to_state?: unknown;
  reason: 'invalid' | 'visited' | 'bound-exceeded';
  restart_index?: number;
}

export interface GoalEvent {
  type: 'goal';
  state: unknown;
  path_length: number;
  cost: number;
}

export interface GoalCandidateEvent {
  type: 'goal-candidate';
  state: unknown;
  cost: number;
  improved: boolean;
}

export interface MarkEvent {
  type: 'mark';
  kind: 'restart-begin' | 'restart-end' | 'iteration-begin' | 'cutoff' | 'stuck';
  restart_index?: number;
  depth_limit?: number;
  [key: string]: unknown;
}

export type SearchEvent =
  | ExpandEvent
  | GenerateEvent
  | RejectEvent
  | GoalEvent
  | GoalCandidateEvent
  | MarkEvent;

export interface SearchTraceEntry {
  seq: number;
  event: SearchEvent;
}

export type MazeState = [number, number];

export type SearchAlgorithm =
  | 'a_star'
  | 'best_first'
  | 'branch_and_bound'
  | 'breadth_first'
  | 'depth_first'
  | 'hill_climbing'
  | 'iterative_deepening'
  | 'uniform_cost';

export type SearchProblemType = 'maze' | 'n_queens' | 'missionaries_and_cannibals';

export interface AuthoredProblem {
  problem_id: string;
  type: SearchProblemType;
  // Problem-specific data needed to render + to reconstruct the Python object.
  maze?: number[][];
  start?: MazeState;
  goal?: MazeState;
  n?: number;
}

export interface RunSummary {
  path_found: boolean;
  path?: unknown[] | null;
  path_length?: number;
  cost?: number;
  inferences?: number;
  elapsed_ms?: number;
  visited_count?: number;
}

export interface SearchTrace {
  trace_id: string;
  problem_id: string;
  algorithm: SearchAlgorithm;
  entries: SearchTraceEntry[];
  summary: RunSummary;
  currentSeq: number;
  playing: boolean;
  speed: number;
}
