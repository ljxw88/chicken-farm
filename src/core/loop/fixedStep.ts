export const FIXED_STEP_SECONDS = 1 / 60;
export const MAX_CATCH_UP_SECONDS = 0.1;

export type FixedSystem = (stepSeconds: number) => void;

interface FixedStepOptions {
  systems: readonly FixedSystem[];
  stepSeconds?: number;
  maxCatchUpSeconds?: number;
}

/** Advance a fixed simulation independently of the number of rendered frames. */
export function createFixedStepAccumulator({
  systems, stepSeconds = FIXED_STEP_SECONDS, maxCatchUpSeconds = MAX_CATCH_UP_SECONDS,
}: FixedStepOptions) {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0 ||
      !Number.isFinite(maxCatchUpSeconds) || maxCatchUpSeconds < stepSeconds) {
    throw new RangeError('Fixed step and catch-up limit must be finite and positive, with at least one step allowed');
  }
  const orderedSystems = [...systems];
  const epsilon = stepSeconds * 1e-9;
  const maxSteps = Math.floor((maxCatchUpSeconds + epsilon) / stepSeconds);
  let accumulator = 0;

  function advance(elapsedSeconds: number) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      throw new RangeError('Elapsed time must be finite and non-negative');
    }
    const accepted = Math.min(elapsedSeconds, maxCatchUpSeconds);
    let droppedSeconds = elapsedSeconds - accepted;
    accumulator += accepted;
    let steps = 0;
    while (steps < maxSteps && accumulator + epsilon >= stepSeconds) {
      accumulator -= stepSeconds;
      if (accumulator < 0 && accumulator > -epsilon) accumulator = 0;
      for (const system of orderedSystems) system(stepSeconds);
      steps++;
    }
    // A custom limit need not be an exact multiple of the step. Discard any
    // excess whole ticks rather than carrying a catch-up spiral into later frames.
    if (accumulator + epsilon >= stepSeconds) {
      const extraSteps = Math.floor((accumulator + epsilon) / stepSeconds);
      accumulator -= extraSteps * stepSeconds;
      if (accumulator < 0 && accumulator > -epsilon) accumulator = 0;
      droppedSeconds += extraSteps * stepSeconds;
    }
    return { steps, alpha: accumulator / stepSeconds, droppedSeconds };
  }

  function reset() {
    accumulator = 0;
  }

  return { advance, reset };
}
