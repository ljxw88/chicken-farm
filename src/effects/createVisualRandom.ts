// Match the small seeded generator used by the weather parity harness. Each
// effect gets its own stream so adding particles cannot reshuffle the rain.
export function createVisualRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
