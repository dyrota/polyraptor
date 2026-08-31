// New code — MazeProblem only wraps a grid you already hand it; polysearch
// has no maze generator. Guarantees solvability BY CONSTRUCTION (carve a
// random path from start to goal first, only place walls on the remaining
// cells) and then VERIFIES with an independent BFS pass before returning,
// regenerating with a perturbed seed on the (should-be-impossible) chance
// that verification fails.

export interface MazeGenerationOptions {
  rows: number;
  cols: number;
  wallDensity?: number;
  seed?: number;
  start?: [number, number];
  goal?: [number, number];
}

export interface GeneratedMaze {
  maze: number[][];
  start: [number, number];
  goal: [number, number];
  seedUsed: number;
}

// Small deterministic PRNG (mulberry32) so a given seed always reproduces the
// same maze — no external dependency needed for this.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function key(r: number, c: number): string {
  return `${r},${c}`;
}

// start/goal arrive straight from agent-supplied tool args (search_author_maze),
// where rows/cols are clamped but these were not. Three concrete failures this
// prevents, all reachable from a single tool call:
//   - out of bounds ([99, 99] on an 8x8) -> isSolvable indexes maze[99][99] and
//     throws TypeError, or carvePathBetween's candidate list comes back empty
//     and destructuring `undefined` throws;
//   - negative -> same;
//   - NON-INTEGER ([1.5, 2]) -> the L-shaped fallback walk steps by ±1 from a
//     fractional row, straddles the goal forever (6.5 -> 7.5 -> 6.5 -> ...) and
//     HANGS THE TAB in an unkillable main-thread loop.
// Clamping (rather than throwing) matches how rows/cols/wall_density already
// treat out-of-range input, so an agent gets a usable maze plus the corrected
// coordinates echoed back in the tool result, not a dead end.
function clampCoord(
  value: unknown,
  fallback: [number, number],
  rows: number,
  cols: number
): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const r = Math.floor(Number(value[0]));
  const c = Math.floor(Number(value[1]));
  if (!Number.isFinite(r) || !Number.isFinite(c)) return fallback;
  return [Math.max(0, Math.min(rows - 1, r)), Math.max(0, Math.min(cols - 1, c))];
}

function carvePathBetween(
  rows: number,
  cols: number,
  start: [number, number],
  goal: [number, number],
  rng: () => number
): Set<string> {
  const protectedCells = new Set<string>([key(...start)]);
  let [r, c] = start;
  const maxSteps = rows * cols * 4;
  let steps = 0;

  while ((r !== goal[0] || c !== goal[1]) && steps < maxSteps) {
    steps++;
    const candidates: [number, number][] = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ].filter(([nr, nc]) => nr >= 0 && nr < rows && nc >= 0 && nc < cols) as [number, number][];

    // 70% of the time, prefer a move that reduces distance to goal (keeps the
    // walk generally progressing); 30% fully random, so the path isn't just a
    // boring straight line.
    let next: [number, number];
    if (rng() < 0.7) {
      candidates.sort((a, b) => {
        const da = Math.abs(a[0] - goal[0]) + Math.abs(a[1] - goal[1]);
        const db = Math.abs(b[0] - goal[0]) + Math.abs(b[1] - goal[1]);
        return da - db;
      });
      // pick among the best few, not always the single best, for variety
      next = candidates[Math.floor(rng() * Math.min(2, candidates.length))];
    } else {
      next = candidates[Math.floor(rng() * candidates.length)];
    }

    [r, c] = next;
    protectedCells.add(key(r, c));
  }

  // Fallback: if the biased random walk didn't converge within the step
  // budget (shouldn't happen on any reasonable grid size, but bounded so it
  // can never hang), finish with a deterministic L-shaped path.
  if (r !== goal[0] || c !== goal[1]) {
    while (r !== goal[0]) {
      r += r < goal[0] ? 1 : -1;
      protectedCells.add(key(r, c));
    }
    while (c !== goal[1]) {
      c += c < goal[1] ? 1 : -1;
      protectedCells.add(key(r, c));
    }
  }

  return protectedCells;
}

function isSolvable(maze: number[][], start: [number, number], goal: [number, number]): boolean {
  const rows = maze.length;
  const cols = maze[0].length;
  if (maze[start[0]][start[1]] === 1 || maze[goal[0]][goal[1]] === 1) return false;

  const visited = new Set<string>([key(...start)]);
  const queue: [number, number][] = [start];
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    if (r === goal[0] && c === goal[1]) return true;
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ] as [number, number][]) {
      if (
        nr >= 0 &&
        nr < rows &&
        nc >= 0 &&
        nc < cols &&
        maze[nr][nc] === 0 &&
        !visited.has(key(nr, nc))
      ) {
        visited.add(key(nr, nc));
        queue.push([nr, nc]);
      }
    }
  }
  return false;
}

export function generateMaze(options: MazeGenerationOptions): GeneratedMaze {
  const rows = Math.max(4, Math.min(30, Math.floor(options.rows)));
  const cols = Math.max(4, Math.min(30, Math.floor(options.cols)));
  const wallDensity = Math.max(0, Math.min(0.6, options.wallDensity ?? 0.25));
  const start = clampCoord(options.start, [0, 0], rows, cols);
  const goal = clampCoord(options.goal, [rows - 1, cols - 1], rows, cols);

  const seedOption = Number(options.seed);
  let seed = Number.isFinite(seedOption) ? Math.floor(seedOption) : Date.now();
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = mulberry32(seed + attempt);
    const protectedCells = carvePathBetween(rows, cols, start, goal, rng);

    const maze: number[][] = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        if (protectedCells.has(key(r, c))) return 0;
        return rng() < wallDensity ? 1 : 0;
      })
    );

    if (isSolvable(maze, start, goal)) {
      return { maze, start, goal, seedUsed: seed + attempt };
    }
    // Should be unreachable given construction guarantees solvability, but
    // never trust that blindly — verify, and retry with a perturbed seed if
    // something unexpected happened.
  }

  // Absolute last resort: an open room is always solvable.
  const openMaze = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  return { maze: openMaze, start, goal, seedUsed: seed };
}
