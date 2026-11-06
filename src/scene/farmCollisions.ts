export type FarmObstacle =
  | { kind: 'box'; name: string; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: 'circle'; name: string; x: number; z: number; radius: number };

export interface FarmBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function isBlocked(x: number, z: number, radius: number, obstacles: readonly FarmObstacle[]) {
  return obstacles.some((obstacle) => {
    if (obstacle.kind === 'circle') {
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      return dx * dx + dz * dz <= (radius + obstacle.radius) ** 2;
    }

    const closestX = Math.max(obstacle.minX, Math.min(x, obstacle.maxX));
    const closestZ = Math.max(obstacle.minZ, Math.min(z, obstacle.maxZ));
    return (x - closestX) ** 2 + (z - closestZ) ** 2 <= radius ** 2;
  });
}

// Substeps prevent a long frame or click from tunnelling through a prop. When
// a diagonal step hits something, try its axes separately to slide along it.
export function moveWithFarmCollisions(
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
  obstacles: readonly FarmObstacle[],
  bounds?: FarmBounds,
) {
  const clampX = (value: number) => bounds
    ? Math.max(bounds.minX + radius, Math.min(value, bounds.maxX - radius)) : value;
  const clampZ = (value: number) => bounds
    ? Math.max(bounds.minZ + radius, Math.min(value, bounds.maxZ - radius)) : value;

  x = clampX(x);
  z = clampZ(z);
  if (obstacles.length === 0 || (dx === 0 && dz === 0)) return { x: clampX(x + dx), z: clampZ(z + dz) };

  const distance = Math.hypot(dx, dz);
  const maxStep = Math.min(0.1, Math.max(0.01, radius / 2));
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepX = dx / steps;
  const stepZ = dz / steps;

  for (let step = 0; step < steps; step++) {
    // Clamp each substep, not just the final position: otherwise a diagonal
    // movement can travel outside the island and bypass a prop along the rim.
    const nextX = clampX(x + stepX);
    const nextZ = clampZ(z + stepZ);
    if (!isBlocked(nextX, nextZ, radius, obstacles)) {
      x = nextX;
      z = nextZ;
    } else {
      if (!isBlocked(nextX, z, radius, obstacles)) x = nextX;
      if (!isBlocked(x, nextZ, radius, obstacles)) z = nextZ;
    }
  }

  return { x, z };
}
