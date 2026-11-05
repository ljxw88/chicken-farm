export type FarmObstacle =
  | { kind: 'box'; name: string; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: 'circle'; name: string; x: number; z: number; radius: number };

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
) {
  if (obstacles.length === 0 || (dx === 0 && dz === 0)) return { x: x + dx, z: z + dz };

  const distance = Math.hypot(dx, dz);
  const maxStep = Math.min(0.1, Math.max(0.01, radius / 2));
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepX = dx / steps;
  const stepZ = dz / steps;

  for (let step = 0; step < steps; step++) {
    if (!isBlocked(x + stepX, z + stepZ, radius, obstacles)) {
      x += stepX;
      z += stepZ;
    } else {
      if (!isBlocked(x + stepX, z, radius, obstacles)) x += stepX;
      if (!isBlocked(x, z + stepZ, radius, obstacles)) z += stepZ;
    }
  }

  return { x, z };
}
