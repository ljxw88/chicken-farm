import { isBlocked, type FarmBounds, type FarmObstacle } from './farmCollisions';
import { stairSupports, type StairSurface } from './stairSurface';

export type WalkPoint = { x: number; z: number };

// The bridge and stair openings both admit the 0.4-radius capsule on this
// grid. Grid points are kept slightly clear of collision boundaries; final
// destinations are refined against the real, unexpanded collision shapes.
const GRID = 0.2;
const GRID_CLEARANCE = 0.005;
const END_CLEARANCE = 0.0001;
const PATH_CLEARANCE = 0.001;
const SAMPLE = 0.025;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const distance = (a: WalkPoint, b: WalkPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** Plan a pointer-time route using the same footprints and stair union as movement. */
export function planWalkRoute(
  start: WalkPoint, goal: WalkPoint, radius: number, bounds: FarmBounds,
  obstacles: readonly FarmObstacle[], surface?: StairSurface,
): WalkPoint[] {
  function walkable(point: WalkPoint, clearance = 0) {
    const r = radius + clearance;
    return point.x >= bounds.minX + r && point.x <= bounds.maxX - r &&
      point.z >= bounds.minZ + r && point.z <= bounds.maxZ - r &&
      (!surface || stairSupports(surface, point.x, point.z, r)) && !isBlocked(point.x, point.z, r, obstacles);
  }

  // Sample more finely than movement's collision substeps. A small interior
  // margin prevents a smoothed segment from grazing a rounded obstacle corner;
  // taper it away at endpoints, where the player may already touch a wall.
  function clear(a: WalkPoint, b: WalkPoint, margin = 0) {
    const length = distance(a, b);
    const steps = Math.max(1, Math.ceil(length / SAMPLE));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const padding = Math.min(margin, length * t / 2, length * (1 - t) / 2);
      if (!walkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, padding)) return false;
    }
    return true;
  }

  // Preserve the old one-segment movement exactly when it already works.
  if (walkable(goal) && clear(start, goal)) return [goal];

  const columns = Math.floor((bounds.maxX - bounds.minX) / GRID) + 1;
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / GRID) + 1;
  const count = columns * rows;
  const parent = new Int32Array(count).fill(-2); // -2 unvisited, -1 connected directly to start
  const cost = new Float64Array(count);
  const occupancy = new Uint8Array(count);
  const queue = new Int32Array(count);
  let tail = 0;
  const index = (column: number, row: number) => row * columns + column;
  const point = (id: number): WalkPoint => ({ x: bounds.minX + id % columns * GRID,
    z: bounds.minZ + Math.floor(id / columns) * GRID });
  function open(column: number, row: number) {
    if (column < 0 || row < 0 || column >= columns || row >= rows) return false;
    const id = index(column, row);
    if (!occupancy[id]) occupancy[id] = walkable(point(id), GRID_CLEARANCE) ? 1 : 2;
    return occupancy[id] === 1;
  }

  const startColumn = Math.round((start.x - bounds.minX) / GRID);
  const startRow = Math.round((start.z - bounds.minZ) / GRID);
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const column = startColumn + dx, row = startRow + dz;
    if (!open(column, row)) continue;
    const id = index(column, row), p = point(id);
    if (distance(start, p) > GRID * 3 || !clear(start, p)) continue;
    parent[id] = -1;
    cost[id] = distance(start, p);
    queue[tail++] = id;
  }

  const goalWalkable = walkable(goal);
  let goalNode = -1;
  for (let head = 0; head < tail; head++) {
    const id = queue[head], p = point(id);
    if (goalWalkable && distance(p, goal) <= GRID * 2.5 && clear(p, goal, PATH_CLEARANCE)) {
      goalNode = id;
      break;
    }
    const column = id % columns, row = Math.floor(id / columns);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nextColumn = column + dx, nextRow = row + dz;
      if (!open(nextColumn, nextRow)) continue;
      const next = index(nextColumn, nextRow);
      if (parent[next] !== -2) continue;
      // A diagonal cannot squeeze between two blocked grid cells.
      if (dx && dz && (!open(column + dx, row) || !open(column, row + dz))) continue;
      const nextPoint = point(next);
      if (!clear(p, nextPoint, PATH_CLEARANCE)) continue;
      parent[next] = id;
      cost[next] = cost[id] + Math.hypot(dx, dz) * GRID;
      queue[tail++] = next;
    }
  }

  let bestNode = goalNode;
  let bestPoint = goal;
  let bestDistance = goalNode >= 0 ? 0 : distance(start, goal);
  let bestCost = goalNode >= 0 ? cost[goalNode] + distance(point(goalNode), goal) : 0;
  if (goalNode < 0) {
    bestNode = -1;
    bestPoint = start;
    function consider(candidate: WalkPoint, from: number, routeCost: number) {
      const d = distance(candidate, goal);
      if (d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && routeCost < bestCost)) {
        bestDistance = d;
        bestCost = routeCost;
        bestPoint = candidate;
        bestNode = from;
      }
    }
    for (let i = 0; i < tail; i++) {
      const id = queue[i];
      consider(point(id), id, cost[id]);
    }

    // From the nearby reachable cells, approach the desired point until the
    // first real collision/support boundary. This also covers joined boxes and
    // unreachable free space, not just an isolated obstacle's simple outline.
    function approach(from: WalkPoint) {
      const length = distance(from, goal);
      if (length === 0) return from;
      const steps = Math.max(1, Math.ceil(length / 0.05));
      let last = from;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const next = { x: from.x + (goal.x - from.x) * t, z: from.z + (goal.z - from.z) * t };
        if (clear(last, next)) { last = next; continue; }
        let low = 0, high = 1;
        for (let iteration = 0; iteration < 24; iteration++) {
          const middle = (low + high) / 2;
          const probe = { x: last.x + (next.x - last.x) * middle, z: last.z + (next.z - last.z) * middle };
          if (clear(last, probe)) low = middle;
          else high = middle;
        }
        const tSafe = Math.max(0, low - END_CLEARANCE / Math.max(distance(last, next), END_CLEARANCE));
        return { x: last.x + (next.x - last.x) * tSafe, z: last.z + (next.z - last.z) * tSafe };
      }
      return goal;
    }
    const fromStart = approach(start);
    consider(fromStart, -1, distance(start, fromStart));
    for (let i = 0; i < tail; i++) {
      const id = queue[i], p = point(id);
      if (distance(p, goal) > bestDistance + GRID * 2.5) continue;
      const candidate = approach(p);
      consider(candidate, id, cost[id] + distance(p, candidate));
    }

    // A box face or circle's radial point gives an accurate nearest boundary,
    // rather than leaving the endpoint quantized to a grid cell.
    const candidates: WalkPoint[] = [];
    const faceXs: number[] = [];
    const faceZs: number[] = [];
    for (const obstacle of obstacles) {
      if (obstacle.blocksWalking === false) continue;
      if (obstacle.kind === 'box') {
        const x = clamp(goal.x, obstacle.minX, obstacle.maxX);
        const z = clamp(goal.z, obstacle.minZ, obstacle.maxZ);
        const r = radius + END_CLEARANCE;
        faceXs.push(obstacle.minX - r, obstacle.maxX + r);
        faceZs.push(obstacle.minZ - r, obstacle.maxZ + r);
        candidates.push({ x: obstacle.minX - r, z }, { x: obstacle.maxX + r, z },
          { x, z: obstacle.minZ - r }, { x, z: obstacle.maxZ + r });
        for (const cornerX of [obstacle.minX, obstacle.maxX]) for (const cornerZ of [obstacle.minZ, obstacle.maxZ]) {
          const dx = goal.x - cornerX, dz = goal.z - cornerZ;
          if ((cornerX === obstacle.minX ? dx > 0 : dx < 0) ||
              (cornerZ === obstacle.minZ ? dz > 0 : dz < 0)) continue;
          const length = Math.hypot(dx, dz);
          if (length) candidates.push({ x: cornerX + dx / length * r, z: cornerZ + dz / length * r });
        }
      } else {
        const dx = goal.x - obstacle.x, dz = goal.z - obstacle.z;
        const length = Math.hypot(dx, dz), r = obstacle.radius + radius + END_CLEARANCE;
        if (length) candidates.push({ x: obstacle.x + dx / length * r, z: obstacle.z + dz / length * r });
        else for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          candidates.push({ x: obstacle.x + x * r, z: obstacle.z + z * r });
        }
      }
    }
    // The closest exit from overlapping boxes can be where two expanded faces
    // meet, rather than the projection onto either face in isolation.
    for (const x of faceXs) {
      if (Math.abs(x - goal.x) > bestDistance + 1e-9) continue;
      for (const z of faceZs) {
        if (Math.hypot(x - goal.x, z - goal.z) <= bestDistance + 1e-9) candidates.push({ x, z });
      }
    }
    for (const candidate of candidates) {
      if (distance(candidate, goal) > bestDistance + 1e-9 || !walkable(candidate)) continue;
      if (clear(start, candidate)) consider(candidate, -1, distance(start, candidate));
      const column = Math.round((candidate.x - bounds.minX) / GRID);
      const row = Math.round((candidate.z - bounds.minZ) / GRID);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = column + dx, z = row + dz;
        if (x < 0 || z < 0 || x >= columns || z >= rows) continue;
        const id = index(x, z);
        if (parent[id] === -2) continue;
        const p = point(id);
        if (distance(p, candidate) <= GRID * 3 && clear(p, candidate, PATH_CLEARANCE)) {
          consider(candidate, id, cost[id] + distance(p, candidate));
        }
      }
    }
  }

  const path: WalkPoint[] = [];
  for (let node = bestNode; node !== -1; node = parent[node]) path.push(point(node));
  path.reverse();
  if (!path.length || distance(path[path.length - 1], bestPoint) > 1e-8) path.push(bestPoint);

  // String-pull the grid path into a few clear waypoints. Movement retains the
  // normal capsule collision/slide system instead of teleporting between them.
  const result: WalkPoint[] = [];
  let from = start;
  for (let i = 0; i < path.length;) {
    let end = path.length - 1;
    while (end > i && !clear(from, path[end], PATH_CLEARANCE)) end--;
    if (distance(from, path[end]) > 1e-8) result.push(path[end]);
    from = path[end];
    i = end + 1;
  }
  return result;
}
