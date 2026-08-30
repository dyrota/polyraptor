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

export type SearchProblemType = 'maze' | 'n_queens' | 'missionaries_and_cannibals' | 'python_problem';

export interface PythonProblemPreview {
  initial_state?: unknown;
  operator_count?: number;
  goal_check_on_initial?: boolean;
}

export interface AuthoredProblem {
  problem_id: string;
  type: SearchProblemType;
  // Problem-specific data needed to render + to reconstruct the Python object.
  maze?: number[][];
  start?: MazeState;
  goal?: MazeState;
  n?: number;
  // python_problem only: the state's shape is opaque to JS (all we ever have
  // is the student's source string), so there's no structured spatial data
  // to render the way maze/n_queens have -- see GenericTraceLog.
  source_code?: string;
  preview?: PythonProblemPreview;
}

export interface RunSummary {
  // Optional, not required: a custom (tier-2) algorithm has no obligation to
  // match the built-ins' return convention, so this whole strict shape may
  // be absent in favor of the loose raw_return_value/event_type_counts pair.
  path_found?: boolean;
  path?: unknown[] | null;
  path_length?: number;
  cost?: number;
  inferences?: number;
  elapsed_ms?: number;
  visited_count?: number;
  // Tier 2 only (custom algorithm): the achievable guarantee is genuinely
  // looser here, not an inconsistency -- see plan doc's tool surface section.
  raw_return_value?: unknown;
  event_type_counts?: Record<string, number>;
}

export interface SearchTrace {
  trace_id: string;
  problem_id: string;
  // 'custom' when the trace came from a tier-2 student-authored algorithm,
  // not one of the 8 built-ins.
  algorithm: SearchAlgorithm | 'custom';
  entries: SearchTraceEntry[];
  summary: RunSummary;
  currentSeq: number;
  playing: boolean;
  speed: number;
}
