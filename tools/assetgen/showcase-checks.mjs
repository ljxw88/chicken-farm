/** Summarize only measurements actually present in an offline verifier pack. */
export function visualCheckSummary(visual) {
  const keys = ['S1', 'S2', 'S3', 'S4', 'S5', 'S5_HIGHLIGHT', 'S7', 'A7', 'A9', 'IDENTITY_VISIBLE', 'PIXEL_RENDER'];
  if (!visual?.metrics || !Array.isArray(visual.failures)) return Object.fromEntries(keys.map((key) => [key, 'not run']));
  const { metrics, failures } = visual;
  const failed = (code) => failures.some((failure) => failure.code === code);
  const samplesComplete = Array.isArray(metrics.samples) && metrics.samples.length >= 120;
  const phases = Object.values(metrics.phaseLighting || {});
  const pixel = metrics.pixel;
  const jitter = metrics.jitter;
  const identity = metrics.identityVisibility;
  const nonTreeA9 = ['daytime', 'morning', 'sunset'].every((phase) => metrics.phaseLighting?.[phase]?.status === 'pass') && metrics.a9Calibration;
  return {
    S1: 'unmeasured', S2: failed('S2') ? 'FAIL' : samplesComplete ? 'pass (night warnings separate)' : 'unmeasured',
    S3: 'unmeasured',
    S4: failed('S4') ? 'FAIL' : metrics.keyLight?.status === 'pass' && phases.length >= 5 && phases.every((phase) => phase.status === 'pass') ? 'pass' : 'unmeasured',
    S5: 'unmeasured', S5_HIGHLIGHT: failed('S5_HIGHLIGHT') ? 'FAIL' : samplesComplete ? 'pass (highlight check only)' : 'unmeasured',
    S7: 'unmeasured',
    A7: failed('A7_FLICKER') || failed('A7_UNMEASURED') ? 'FAIL' : Array.isArray(jitter) && jitter.length === 24 && jitter.some((item) => item.checkedPixels > 0) ? 'pass (interior only; silhouette edges unmeasured)' : 'unmeasured',
    A9: failed('A9_SHADE_RATIO') || failed('A9_UNMEASURED') ? 'FAIL' : metrics.a9FloorMode === 'tree-by-eye' ? 'by-eye review required' : nonTreeA9 ? 'pass' : 'unmeasured',
    IDENTITY_VISIBLE: failed('IDENTITY_VISIBLE') ? 'FAIL' : identity && Object.keys(identity).length && Object.values(identity).every((views) => Array.isArray(views) && views.length >= 8) ? 'pass (pixel contribution only; semantics need review)' : 'unmeasured',
    PIXEL_RENDER: failed('PIXEL_RENDER') ? 'FAIL' : pixel?.enabled && pixel.canvasWidth === 320 && pixel.canvasHeight === 180 && pixel.cssPixelSize === 4 ? 'pass' : 'unmeasured',
  };
}
