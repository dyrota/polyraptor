import type { SortTraceEntry } from './types';

export interface SortVisualState {
  mainValues: number[];
  // Only the most recent event's indices, not a cumulative history — unlike
  // search's expanded/frontier sets, "everything ever compared" isn't a
  // meaningful thing to keep highlighted for a sort visualization.
  highlighted: Record<number, 'compare' | 'swap' | 'write'>;
  // Secondary/auxiliary buffers (key, left, right, count, output,
  // negatives, non_negatives) accumulate naturally: a later merge/pass
  // reusing the same small index range just overwrites the earlier value,
  // which self-corrects without needing per-mark clearing.
  auxiliary: Record<string, Record<number, number>>;
  markText: string | null;
}

// Replays compare/swap/write/mark events up to currentSeq to reconstruct the
// array's current contents (values change over time, unlike search's
// state-identity buckets, which never mutate). Note: radix_sort's write
// events never target the 'main' buffer at all (only 'output'/'negatives'/
// 'non_negatives' — the final `data[:] = ...` reassembly has no
// corresponding event) so mainValues stays at its initial values for that
// algorithm until BarArrayCanvas falls back to trace.summary.final_values
// at the end of playback — a deliberate, acceptable simplification, not a
// bug, per the plan doc's note that radix is the most cuttable algorithm.
export function deriveSortVisualState(
  initialValues: number[],
  entries: SortTraceEntry[],
  currentSeq: number
): SortVisualState {
  const mainValues = [...initialValues];
  const auxiliary: Record<string, Record<number, number>> = {};
  let highlighted: Record<number, 'compare' | 'swap' | 'write'> = {};
  let markText: string | null = null;

  for (let i = 0; i <= currentSeq && i < entries.length; i++) {
    const event = entries[i].event;
    highlighted = {};
    // A custom algorithm can emit anything it likes under a known type name --
    // a `compare` with no `a`/`b`, a `write` with no `target`. Reading
    // event.a.buffer on one of those throws, and unlike search's equivalent
    // (which has had this guard since custom code was introduced) this ran
    // bare, inside a useEffect, with no ErrorBoundary above it -- so one
    // malformed event from student code took the whole app to a white screen.
    try {
      switch (event.type) {
      case 'compare': {
        // merge/tim's compare events tag 'left'/'right' (ephemeral sub-lists,
        // not main-array positions) and carry the value directly — without
        // this branch, those comparisons were invisible: every write during
        // a merge targets 'main' (the copy-back), so the aux strip mechanism
        // that already works for counting/radix's write-based buffers never
        // fired for merge/tim at all, even mid-merge.
        if (event.a.buffer === 'main') highlighted[event.a.index] = 'compare';
        else if (event.a.value !== undefined) auxiliary[event.a.buffer] = { ...(auxiliary[event.a.buffer] ?? {}), [event.a.index]: event.a.value };
        if (event.b.buffer === 'main') highlighted[event.b.index] = 'compare';
        else if (event.b.value !== undefined) auxiliary[event.b.buffer] = { ...(auxiliary[event.b.buffer] ?? {}), [event.b.index]: event.b.value };
        break;
      }
      case 'swap': {
        if (event.a.buffer === 'main' && event.b.buffer === 'main') {
          const tmp = mainValues[event.a.index];
          mainValues[event.a.index] = mainValues[event.b.index];
          mainValues[event.b.index] = tmp;
        }
        highlighted[event.a.index] = 'swap';
        highlighted[event.b.index] = 'swap';
        break;
      }
      case 'write': {
        if (event.target.buffer === 'main') {
          mainValues[event.target.index] = event.value;
          highlighted[event.target.index] = 'write';
        } else {
          auxiliary[event.target.buffer] = { ...(auxiliary[event.target.buffer] ?? {}), [event.target.index]: event.value };
        }
        break;
      }
      case 'mark': {
        markText = describeMark(event as { kind: string; [key: string]: unknown });
        break;
      }
      }
    } catch (err) {
      console.warn('polyraptor: skipping malformed sort trace event', event, err);
    }
  }

  return { mainValues, highlighted, auxiliary, markText };
}

function describeMark(event: { kind: string; [key: string]: unknown }): string {
  switch (event.kind) {
    case 'gap-change':
      return `gap = ${event.gap}`;
    case 'partition-range':
      return `partition [${event.low}, ${event.high}], pivot = ${event.pivot_value}`;
    case 'merge-range':
      return `merging [${event.left}, ${event.mid}, ${event.right}]`;
    case 'run-boundary':
      return `run [${event.left}, ${event.right}]`;
    case 'merge-pass':
      return `merge pass, size = ${event.size}`;
    case 'digit-pass':
      return `digit pass, exp = ${event.exp} (${event.phase})`;
    default:
      return String(event.kind);
  }
}
