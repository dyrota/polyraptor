// Standalone smoke test, no framework — run with `node --experimental-strip-types src/search/mazeGenerator.smoketest.ts`
// (or plain `node src/search/mazeGenerator.smoketest.ts` if the runtime strips types by default).
import { generateMaze } from './mazeGenerator.ts';

function bfsSolvable(maze: number[][], start: [number, number], goal: [number, number]): boolean {
  const rows = maze.length;
  const cols = maze[0].length;
  const visited = new Set<string>([`${start[0]},${start[1]}`]);
  const queue: [number, number][] = [start];
  while (queue.length) {
    const [r, c] = queue.shift()!;
    if (r === goal[0] && c === goal[1]) return true;
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as [number, number][]) {
      const k = `${nr},${nc}`;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && maze[nr][nc] === 0 && !visited.has(k)) {
        visited.add(k);
        queue.push([nr, nc]);
      }
    }
  }
  return false;
}

let failures = 0;
let ran = 0;

function check(label: string, cond: boolean) {
  ran++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const configs = [
  { rows: 4, cols: 4 },
  { rows: 10, cols: 10, wallDensity: 0.4 },
  { rows: 15, cols: 20, wallDensity: 0.55, seed: 42 },
  { rows: 30, cols: 30, wallDensity: 0.6 },
  { rows: 6, cols: 6, wallDensity: 0.5, start: [0, 0] as [number, number], goal: [5, 0] as [number, number] },
  { rows: 8, cols: 8, seed: 1 },
  { rows: 8, cols: 8, seed: 1 }, // same seed twice -> determinism check
];

const results = configs.map((cfg) => generateMaze(cfg));

results.forEach((result, i) => {
  const cfg = configs[i];
  const expectedRows = Math.max(4, Math.min(30, cfg.rows));
  const expectedCols = Math.max(4, Math.min(30, cfg.cols));
  check(`config ${i}: correct row count`, result.maze.length === expectedRows);
  check(`config ${i}: correct col count`, result.maze.every((row) => row.length === expectedCols));
  check(`config ${i}: start is open`, result.maze[result.start[0]][result.start[1]] === 0);
  check(`config ${i}: goal is open`, result.maze[result.goal[0]][result.goal[1]] === 0);
  check(`config ${i}: solvable (independent BFS)`, bfsSolvable(result.maze, result.start, result.goal));
  check(`config ${i}: values are only 0 or 1`, result.maze.every((row) => row.every((v) => v === 0 || v === 1)));
});

// Determinism: same seed + same config -> identical maze.
const a = JSON.stringify(results[5].maze);
const b = JSON.stringify(results[6].maze);
check('same seed produces identical maze (determinism)', a === b);

console.log(`${ran - failures}/${ran} checks passed across ${configs.length} maze configs.`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
