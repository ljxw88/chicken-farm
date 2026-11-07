export const KEY_LIGHT_GEOMETRY = {
  radiusComponents: [11, 4], directionX: -0.8, directionZ: 0.6,
  baseHeight: 4, sunHeight: 8, moonHeight: 5,
} as const;

export const PRACTICAL_LIGHT_GEOMETRY = {
  windowOffset: 0.7, lanternPosition: [0.72, 1.05, 0.5],
  wingStart: [-0.4, -0.05, -0.28], wingEnd: [-0.08, -0.05, -0.06], wingRadius: 0.08,
  wingCapSegments: 4, wingRadialSegments: 8,
  glass: [0.12, 0.13, 0.3, 8], cap: [0.15, 0.15, 0.04, 8], capYs: [-0.17, 0.17],
  handle: [0.11, 0.015, 6, 12, Math.PI], handleY: 0.19,
} as const;

export const FARM_SHADOW_GEOMETRY = {
  unitCircle: [1, 24], footprintScale: 0.55, buildingLift: 0.03, waterLift: 0.034,
  waterfallInset: 0.25, waterfallExtraWidth: 0.05, waterfallTouchMargin: 0.005,
  treeOffsetFactor: 1.8, treeTouchRadius: 0.15, chickenOffsetFactor: 0.9, chickenTouchRadius: 0.1,
  cottageOffsetFactor: 2, otherOffsetFactor: 1.8,
} as const;
