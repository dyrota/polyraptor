import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/activityLog';
import { tracesStore } from '../shared/traceStore';
import * as searchState from '../search/state';
import * as sortState from '../sort/state';
import type { AuthoredProblem } from '../search/types';
import type { AuthoredSortProblem } from '../sort/types';

// State DISCOVERY, the missing half of this app's premise.
//
// Every other tool here pushes state from the agent to the page. Nothing read
// it back: an agent could only ever act on ids it had created itself in the
// current conversation. So the moment a human clicked "New Maze" or "New
// Dataset" -- or the agent simply lost track of an id -- the agent was blind to
// the very state it is supposed to be sharing, and the "human and agent touch
// the same state" claim only actually held in one direction.
//
// These two tools close that loop. They are the natural first call for an agent
// arriving mid-session, and the recovery path for any "Unknown problem_id"
// error, which is why those errors now name them.

const MAX_LISTED = 25;
// A trace can hold tens of thousands of events; only the position is useful
// here, and the full event is available from playback_get_state.
function describeTrace(traceId: string | null) {
  if (!traceId) return null;
  const trace = tracesStore.getState()[traceId];
  if (!trace) return null;
  return {
    trace_id: trace.trace_id,
    problem_id: trace.problem_id,
    algorithm: trace.algorithm,
    total_length: trace.entries.length,
    current_seq: trace.currentSeq,
    playing: trace.playing,
    speed: trace.speed,
    summary: trace.summary,
  };
}

function describeSearchProblem(p: AuthoredProblem, full: boolean) {
  const base: Record<string, unknown> = { problem_id: p.problem_id, type: p.type };
  if (p.type === 'maze') {
    base.rows = p.maze?.length ?? null;
    base.cols = p.maze?.[0]?.length ?? null;
    base.start = p.start;
    base.goal = p.goal;
    // Only for the active problem: a 30x30 grid is ~900 numbers, worth sending
    // when the agent is about to reason about THIS maze, wasteful for a list.
    if (full) base.maze = p.maze;
  } else if (p.type === 'n_queens') {
    base.n = p.n;
  } else if (p.type === 'python_problem') {
    base.preview = p.preview;
    if (full) base.source_code = p.source_code;
  }
  return base;
}

function describeSortProblem(p: AuthoredSortProblem, full: boolean) {
  const base: Record<string, unknown> = {
    problem_id: p.problem_id,
    dataset_type: p.dataset_type,
    size: p.size,
  };
  if (full) {
    base.values = p.values;
    if (p.source_code) base.source_code = p.source_code;
  }
  return base;
}

// Authored algorithms and heuristics share one store, distinguished by the id
// prefix their factory assigns -- see newAlgorithmId call sites.
function splitAuthored(ids: string[]) {
  return {
    algorithm_ids: ids.filter((id) => id.includes('-algo-py-')),
    heuristic_ids: ids.filter((id) => id.includes('-heuristic-py-')),
  };
}

export const stateTools: ToolDefinition<never>[] = [
  {
    name: 'search_get_state',
    description:
      'Report everything the Search panel currently holds: the active problem (with its full grid, if a maze), ' +
      'every problem_id authored so far, the ids of any custom algorithms and heuristics, the active trace and ' +
      'its exact playback position, and the most recent heuristic verification verdict. ' +
      'Call this FIRST if you did not author the current state yourself — the human can create problems by ' +
      'clicking "New Maze" in the page, and those ids exist but were never returned to you. Also the right ' +
      'recovery call after an "Unknown problem_id" or "Unknown trace_id" error.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: logged('search_get_state', async () => {
      const problems = searchState.problemsStore.getState();
      const activeProblemId = searchState.activeProblemIdStore.getState();
      const activeTraceId = searchState.activeTraceIdStore.getState();
      const active = activeProblemId ? problems[activeProblemId] : null;
      const verification = searchState.verificationStore.getState();
      const ids = Object.keys(searchState.algorithmsStore.getState());

      return JSON.stringify({
        active_problem: active ? describeSearchProblem(active, true) : null,
        problems: Object.values(problems)
          .slice(-MAX_LISTED)
          .map((p) => describeSearchProblem(p, false)),
        ...splitAuthored(ids),
        active_trace: describeTrace(activeTraceId),
        latest_verification: verification
          ? {
              problem_id: verification.problem_id,
              heuristic_id: verification.heuristic_id,
              verdict: verification.report.verdict,
              admissible: verification.report.admissible.holds,
              consistent: verification.report.consistent.holds,
              goal_zero: verification.report.goal_zero.holds,
              states_explored: verification.report.states_explored,
              budget_exceeded: verification.report.budget_exceeded,
            }
          : null,
      });
    }),
  },
  {
    name: 'sort_get_state',
    description:
      'Report everything the Sort panel currently holds: the active problem (with its full value list), every ' +
      'problem_id authored so far, the ids of any custom algorithms, the active trace with its exact ' +
      'playback position, and the most recent comparator verification verdict. ' +
      'Call this FIRST if you did not author the current state yourself — the human can create datasets by ' +
      'clicking "New Dataset" in the page, and those ids exist but were never returned to you. Also the right ' +
      'recovery call after an "Unknown problem_id" or "Unknown trace_id" error.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: logged('sort_get_state', async () => {
      const problems = sortState.problemsStore.getState();
      const activeProblemId = sortState.activeProblemIdStore.getState();
      const activeTraceId = sortState.activeTraceIdStore.getState();
      const active = activeProblemId ? problems[activeProblemId] : null;
      const verification = sortState.verificationStore.getState();
      const ids = Object.keys(sortState.algorithmsStore.getState());

      return JSON.stringify({
        active_problem: active ? describeSortProblem(active, true) : null,
        problems: Object.values(problems)
          .slice(-MAX_LISTED)
          .map((p) => describeSortProblem(p, false)),
        ...splitAuthored(ids),
        active_trace: describeTrace(activeTraceId),
        latest_verification: verification
          ? {
              problem_id: verification.problem_id,
              verdict: verification.report.verdict,
              total: verification.report.total.holds,
              deterministic: verification.report.deterministic.holds,
              antisymmetric: verification.report.antisymmetric.holds,
              transitive: verification.report.transitive.holds,
              equivalence_transitive: verification.report.equivalence_transitive.holds,
              values_checked: verification.report.values_checked,
              budget_exceeded: verification.report.budget_exceeded,
            }
          : null,
      });
    }),
  },
];
