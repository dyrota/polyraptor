import { registerTools, isWebMcpAvailable } from './registerTool';
import { searchTools } from './tools.search';
import { playbackTools } from './tools.playback';

// Sort/evolve tool modules land in Phase 3 — not registered yet.
export function initWebMcp(): { available: boolean; toolCount: number } {
  const available = isWebMcpAvailable();
  const { count } = registerTools([...searchTools, ...playbackTools]);
  return { available, toolCount: count };
}
