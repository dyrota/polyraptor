// Discriminated union for polysort's on_step events, verified directly
// against the actual instrumented source in all 10 algorithm files (Phase 1)
// — not guessed from the plan doc's schema sketch. Buffer names vary by
// algorithm ('main', 'key' for insertion/shell's held-aside value, 'left'/
// 'right' for merge/tim's ephemeral sub-lists, 'count' for counting_sort,
// 'output'/'negatives'/'non_negatives' for radix_sort) — kept as a plain
// string rather than an exhaustive union since the renderer only needs to
// distinguish "main" from "everything else" for the simple bar view.

export interface BufferRef {
  buffer: string;
  index: number;
  value?: number;
}

export interface CompareEvent {
  type: 'compare';
  a: BufferRef;
  b: BufferRef;
  comparisons: number;
  swaps: number;
}

export interface SwapEvent {
  type: 'swap';
  a: { buffer: string; index: number };
  b: { buffer: string; index: number };
  comparisons: number;
  swaps: number;
}

export interface WriteEvent {
  type: 'write';
  target: { buffer: string; index: number };
  value: number;
  source: { buffer: string; index: number } | null;
  comparisons: number;
  swaps: number;
}

export interface MarkEvent {
  type: 'mark';
  kind: 'gap-change' | 'partition-range' | 'merge-range' | 'run-boundary' | 'merge-pass' | 'digit-pass';
  [key: string]: unknown;
}

export type SortEvent = CompareEvent | SwapEvent | WriteEvent | MarkEvent;

export interface SortTraceEntry {
  seq: number;
  event: SortEvent;
}

export type SortAlgorithm =
  | 'bubble_sort'
  | 'selection_sort'
  | 'insertion_sort'
  | 'merge_sort'
  | 'quick_sort'
  | 'heap_sort'
  | 'counting_sort'
  | 'radix_sort'
  | 'shell_sort'
  | 'tim_sort';

export type SortDatasetType = 'random_integers' | 'nearly_sorted' | 'reverse_sorted' | 'many_duplicates' | 'custom' | 'python_problem';

export interface AuthoredSortProblem {
  problem_id: string;
  dataset_type: SortDatasetType;
  size: number;
  // Always populated at author time (dataset generation happens once in
  // Python, values come back to JS) so the bar canvas has something to show
  // immediately, before any algorithm has run — mirrors search's
  // problem.maze being always-available regardless of trace state. For a
  // python_problem, this is the values captured from the student's data()
  // call during author-time validation — the bar canvas needs no changes
  // to render it, since it only ever looks at this field regardless of
  // dataset_type (see BarArrayCanvas.tsx).
  values: number[];
  seed?: number;
  swaps?: number;
  distinct?: number;
  // Only set when dataset_type === 'python_problem'. The source is the
  // stored artifact -- re-run means re-exec this from scratch, never a
  // cached live Python object (see plan doc: "Author = construct +
  // smoke-test + discard").
  source_code?: string;
}

export interface PythonValidationError {
  valid: false;
  kind: string;
  friendly_error: string;
  raw_traceback: string;
}

export interface SortRunSummary {
  comparisons: number;
  swaps: number;
  elapsed_ms: number;
  is_sorted: boolean;
  final_values: number[];
}

export interface SortTrace {
  trace_id: string;
  problem_id: string;
  algorithm: SortAlgorithm;
  entries: SortTraceEntry[];
  summary: SortRunSummary;
  currentSeq: number;
  playing: boolean;
  speed: number;
}
