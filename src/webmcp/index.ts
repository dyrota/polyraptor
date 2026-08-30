import { registerTools, isWebMcpAvailable } from './registerTool';
import { searchTools } from './tools.search';
import { sortTools } from './tools.sort';
import { evolveTools } from './tools.evolve';
import { playbackTools } from './tools.playback';

export function initWebMcp(): { available: boolean; toolCount: number } {
  const available = isWebMcpAvailable();
  const { count } = registerTools([...searchTools, ...sortTools, ...evolveTools, ...playbackTools]);
  return { available, toolCount: count };
}
