import type { SearchTraceEntry } from './types';

export interface SearchVisualState {
  expanded: Set<string>;
  frontier: Set<string>;
  rejected: Set<string>;
  currentState: unknown | null;
}

function stateKey(state: unknown): string {
  return JSON.stringify(state);
}

// Scans events up to (and including) currentSeq and buckets states into
// expanded / frontier / rejected, for the canvas to color accordingly.
export function deriveSearchVisualState(entries: SearchTraceEntry[], currentSeq: number): SearchVisualState {
  const expanded = new Set<string>();
  const frontier = new Set<string>();
  const rejected = new Set<string>();
  let currentState: unknown | null = null;

  for (let i = 0; i <= currentSeq && i < entries.length; i++) {
    const event = entries[i].event;
    // A custom algorithm's event might not match the shape below (e.g. no
    // .state field) -- skip it rather than let one malformed event break
    // the whole replay. Well-formed built-in events are unaffected.
    try {
      switch (event.type) {
        case 'expand': {
          const k = stateKey(event.state);
          expanded.add(k);
          frontier.delete(k);
          currentState = event.state;
          break;
        }
        case 'generate': {
          const k = stateKey(event.to_state);
          if (!expanded.has(k)) frontier.add(k);
          break;
        }
        case 'reject': {
          if (event.to_state !== undefined) rejected.add(stateKey(event.to_state));
          break;
        }
        case 'goal':
        case 'goal-candidate': {
          currentState = event.state;
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.warn('polyraptor: skipping malformed search trace event', event, err);
    }
  }

  return { expanded, frontier, rejected, currentState };
}

export function isStateIn(set: Set<string>, state: unknown): boolean {
  return set.has(stateKey(state));
}
