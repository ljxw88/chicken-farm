// Review-only scene placement; this never changes a recipe or game registry.
const preferred = { x: -2, z: 4.2 };
const grid = [];
for (let x = -7; x <= 7; x += 0.5) for (let z = -7; z <= 7; z += 0.5) grid.push({ x, z });
grid.sort((a, b) => ((a.x - preferred.x) ** 2 + (a.z - preferred.z) ** 2) -
  ((b.x - preferred.x) ** 2 + (b.z - preferred.z) ** 2) || a.x - b.x || a.z - b.z);

export function overlapsContextFootprint(rect, obstacle) {
  if (!obstacle || typeof obstacle !== 'object') return true;
  if (obstacle.kind === 'box' && [obstacle.minX, obstacle.maxX, obstacle.minZ, obstacle.maxZ].every(Number.isFinite) &&
      obstacle.minX <= obstacle.maxX && obstacle.minZ <= obstacle.maxZ) return rect.minX < obstacle.maxX && rect.maxX > obstacle.minX && rect.minZ < obstacle.maxZ && rect.maxZ > obstacle.minZ;
  if (obstacle.kind === 'circle') {
    if (![obstacle.x, obstacle.z, obstacle.radius].every(Number.isFinite) || obstacle.radius < 0) return true;
    const x = Math.max(rect.minX, Math.min(rect.maxX, obstacle.x));
    const z = Math.max(rect.minZ, Math.min(rect.maxZ, obstacle.z));
    return Math.hypot(obstacle.x - x, obstacle.z - z) < obstacle.radius;
  }
  return true; // Unknown obstacles are never treated as safe ground.
}

/** Find clear ground close to the character and fence, using actual bounds. */
export function chooseContextPlacement(bounds, obstacles, { margin = 0.05, groundHalfSize = 8, candidates = [preferred, ...grid] } = {}) {
  const values = [bounds?.minX, bounds?.maxX, bounds?.minZ, bounds?.maxZ, margin, groundHalfSize];
  if (!values.every(Number.isFinite) || !Array.isArray(obstacles) || !Array.isArray(candidates) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ || margin < 0 || groundHalfSize <= 0) return null;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) continue;
    const footprint = { minX: candidate.x + bounds.minX - margin, maxX: candidate.x + bounds.maxX + margin,
      minZ: candidate.z + bounds.minZ - margin, maxZ: candidate.z + bounds.maxZ + margin };
    if (footprint.minX < -groundHalfSize || footprint.maxX > groundHalfSize || footprint.minZ < -groundHalfSize || footprint.maxZ > groundHalfSize) continue;
    if (!obstacles.some((obstacle) => overlapsContextFootprint(footprint, obstacle))) return { x: candidate.x, z: candidate.z, footprint };
  }
  return null;
}
