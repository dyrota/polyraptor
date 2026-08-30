import { registerTools, isWebMcpAvailable } from './registerTool';
import { searchTools } from './tools.search';
import { sortTools } from './tools.sort';
import { playbackTools } from './tools.playback';

// Evolve's tool module lands separately — not registered yet.
export function initWebMcp(): { available: boolean; toolCount: number } {
  const available = isWebMcpAvailable();
  const { count } = registerTools([...searchTools, ...sortTools, ...playbackTools]);
  return { available, toolCount: count };
}
