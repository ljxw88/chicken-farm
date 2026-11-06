// Convex X/Z footprints let water, its bridge opening and placement use the
// same shapes, including when a future route or bridge is diagonal.
export interface FarmPoint {
  x: number;
  z: number;
}

const EPSILON = 1e-9;

function cross(a: FarmPoint, b: FarmPoint, point: FarmPoint) {
  return (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
}

function area(points: readonly FarmPoint[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.z - point.z * next.x;
  }, 0) / 2;
}

export function rectangle(x: number, z: number, length: number, width: number, rotation = 0): FarmPoint[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [[-length / 2, -width / 2], [length / 2, -width / 2],
    [length / 2, width / 2], [-length / 2, width / 2]].map(([localX, localZ]) => ({
    x: x + localX * cos + localZ * sin,
    z: z - localX * sin + localZ * cos,
  }));
}

export function boxPolygon(box: { minX: number; maxX: number; minZ: number; maxZ: number }): FarmPoint[] {
  return [
    { x: box.minX, z: box.minZ }, { x: box.maxX, z: box.minZ },
    { x: box.maxX, z: box.maxZ }, { x: box.minX, z: box.maxZ },
  ];
}

/** Positive-area intersection, so merely touching a tile edge does not reserve it. */
export function polygonsOverlap(a: readonly FarmPoint[], b: readonly FarmPoint[]) {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      const nx = next.z - current.z;
      const nz = current.x - next.x;
      if (nx * nx + nz * nz < EPSILON ** 2) continue;
      const project = (points: readonly FarmPoint[]) => points.map((point) => point.x * nx + point.z * nz);
      const pa = project(a);
      const pb = project(b);
      if (Math.max(...pa) <= Math.min(...pb) + EPSILON || Math.max(...pb) <= Math.min(...pa) + EPSILON) return false;
    }
  }
  return true;
}

/** A walking character is a circle, not just its centre point. */
export function circleTouchesPolygon(x: number, z: number, radius: number, points: readonly FarmPoint[]) {
  const point = { x, z };
  if (points.every((a, index) => cross(a, points[(index + 1) % points.length], point) >= -EPSILON)) return true;
  return points.some((a, index) => {
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared));
    return (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 <= radius ** 2 + EPSILON;
  });
}

function halfPlane(points: readonly FarmPoint[], a: FarmPoint, b: FarmPoint, inside: boolean) {
  const result: FarmPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const previous = points[(i + points.length - 1) % points.length];
    const current = points[i];
    const previousSide = cross(a, b, previous);
    const currentSide = cross(a, b, current);
    const previousKept = inside ? previousSide >= 0 : previousSide <= 0;
    const currentKept = inside ? currentSide >= 0 : currentSide <= 0;
    if (previousKept !== currentKept) {
      const t = previousSide / (previousSide - currentSide);
      result.push({ x: previous.x + (current.x - previous.x) * t, z: previous.z + (current.z - previous.z) * t });
    }
    if (currentKept) result.push(current);
  }
  return result.length >= 3 && Math.abs(area(result)) > EPSILON ? result : [];
}

/** Both inputs are counter-clockwise convex polygons. */
export function clipPolygon(subject: readonly FarmPoint[], clip: readonly FarmPoint[]) {
  let result = [...subject];
  for (let i = 0; i < clip.length && result.length; i++) {
    result = halfPlane(result, clip[i], clip[(i + 1) % clip.length], true);
  }
  return result;
}

/** Split a convex water footprint into the pieces outside a convex bridge. */
export function subtractPolygon(subject: readonly FarmPoint[], cut: readonly FarmPoint[]) {
  if (!polygonsOverlap(subject, cut)) return [[...subject]];
  const pieces: FarmPoint[][] = [];
  let inside = [...subject];
  for (let i = 0; i < cut.length && inside.length; i++) {
    const a = cut[i];
    const b = cut[(i + 1) % cut.length];
    const outside = halfPlane(inside, a, b, false);
    if (outside.length) pieces.push(outside);
    inside = halfPlane(inside, a, b, true);
  }
  return pieces;
}
