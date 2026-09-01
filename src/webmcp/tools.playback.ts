import type { ToolDefinition } from './registerTool';
import { logged } from '../shared/activityLog';
import { play, pause, step, jumpTo, getPlaybackState } from '../playback/playbackEngine';

// Shared by search + sort traces, keyed by trace_id — pure client-side
// scrubbing over an already-computed event array, no further Pyodide calls.
export const playbackTools: ToolDefinition<never>[] = [
  {
    name: 'playback_play',
    description: 'Start animating a trace forward from its current position, at the given speed (0.25-8x, default 1).',
    inputSchema: {
      type: 'object',
      properties: {
        trace_id: { type: 'string' },
        speed: { type: 'number', minimum: 0.25, maximum: 8 },
      },
      required: ['trace_id'],
    },
    execute: logged('playback_play', async (args: { trace_id: string; speed?: number }) => {
      play(args.trace_id, args.speed);
      return JSON.stringify(getPlaybackState(args.trace_id));
    }),
  },
  {
    name: 'playback_pause',
    description: 'Pause a currently-animating trace.',
    inputSchema: { type: 'object', properties: { trace_id: { type: 'string' } }, required: ['trace_id'] },
    execute: logged('playback_pause', async (args: { trace_id: string }) => {
      pause(args.trace_id);
      return JSON.stringify(getPlaybackState(args.trace_id));
    }),
  },
  {
    name: 'playback_step',
    description: 'Step a trace forward or backward by a number of events (default: 1 forward). Pauses any running animation.',
    inputSchema: {
      type: 'object',
      properties: {
        trace_id: { type: 'string' },
        direction: { type: 'string', enum: ['forward', 'backward'] },
        count: { type: 'integer', minimum: 1 },
      },
      required: ['trace_id'],
    },
    execute: logged(
      'playback_step',
      async (args: { trace_id: string; direction?: 'forward' | 'backward'; count?: number }) => {
        step(args.trace_id, args.direction, args.count);
        return JSON.stringify(getPlaybackState(args.trace_id));
      }
    ),
  },
  {
    name: 'playback_jump_to',
    description: 'Jump a trace directly to a specific event index (seq).',
    inputSchema: {
      type: 'object',
      properties: { trace_id: { type: 'string' }, seq: { type: 'integer', minimum: 0 } },
      required: ['trace_id', 'seq'],
    },
    execute: logged('playback_jump_to', async (args: { trace_id: string; seq: number }) => {
      jumpTo(args.trace_id, args.seq);
      return JSON.stringify(getPlaybackState(args.trace_id));
    }),
  },
  {
    name: 'playback_get_state',
    description: 'Get the current playback position, total length, and current event of a trace, to narrate in sync with what is on screen.',
    // The one playback tool that only reads -- play/pause/step/jump_to all
    // move what the human is watching.
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { trace_id: { type: 'string' } }, required: ['trace_id'] },
    execute: logged('playback_get_state', async (args: { trace_id: string }) => {
      return JSON.stringify(getPlaybackState(args.trace_id));
    }),
  },
];
