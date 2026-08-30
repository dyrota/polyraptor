import { registerTools, isWebMcpAvailable } from './registerTool';
import { searchTools } from './tools.search';
import { sortTools } from './tools.sort';
import { playbackTools } from './tools.playback';

// evolve_* tools removed for now -- returning once polyevolve exists as a
// proper Python library (see evolve-js-prototype git tag for the working
// Matter.js version this replaced).
export function initWebMcp(): { available: boolean; toolCount: number } {
  const available = isWebMcpAvailable();
  const { count } = registerTools([...searchTools, ...sortTools, ...playbackTools]);
  return { available, toolCount: count };
}
