const codeList = (failures) => [...new Set((failures || []).map((failure) => typeof failure === 'string' ? failure : failure.code).filter(Boolean))];
const seconds = (value) => Number.isFinite(value) ? `${(value / 1000).toFixed(1)} s` : 'not recorded';

function describe(run) {
  const hard = run?.verification?.hard ?? run?.stageReport?.hard;
  const hardMeasured = Array.isArray(hard?.failures);
  const hardClear = hardMeasured && hard.failures.length === 0;
  const report = run?.stageReport;
  const missingVerify = run?.verifyExit != null && run.verifyExit !== 0 && !run.verification;
  const gateClear = hardClear && report?.action === 'continue' && report?.visual && report?.critique?.imageReviewed === true &&
    Array.isArray(report.blockers) && report.blockers.length === 0 && !(report.visual.failures || []).length && !missingVerify;
  const history = run?.final?.history || [];
  const errors = [...(run?.generatorExit != null && run.generatorExit !== 0 && !run.final ? ['GENERATOR_ERROR'] : []), ...(missingVerify ? ['VERIFY_ERROR'] : [])];
  const fallbackBlockers = [...history.flatMap((item) => item.blockers || []), ...(history.some((item) => item.failure) ? ['GENERATOR'] : []), ...errors];
  const models = [...new Set(history.map((item) => item.generatorModelId).filter(Boolean))].join(', ') || 'unknown';
  return { status: run?.final?.status ?? 'not completed', rounds: run?.final?.roundsUsed ?? 'not recorded',
    stage: run?.final?.best?.stage ?? 'not generated', hardMeasured, hardClear: !!hardClear, gateClear: !!gateClear,
    hardCodes: hardMeasured ? codeList(hard.failures).join(', ') || 'none' : 'not measured',
    blockers: report ? codeList([...(report.blockers || []), ...errors]).join(', ') || 'none' : codeList(fallbackBlockers).join(', ') || 'not measured',
    time: seconds(run?.elapsedMs), verifyTime: seconds(run?.verifyElapsedMs), models };
}

/** Compare identical briefs without conflating a single-shot gate with approval. */
export function renderLoopBakeoff({ rows, generatedAt, onDirectory, offDirectory }) {
  const descriptions = rows.map((row) => ({ id: row.id, on: describe(row.on), off: describe(row.off) }));
  const summary = ['on', 'off'].map((mode) => {
    const values = descriptions.map((row) => row[mode]), total = values.length;
    return `| ${mode.toUpperCase()} | ${values.filter((value) => value.gateClear).length}/${total} | ${values.filter((value) => value.hardClear).length}/${total} | ${values.filter((value) => value.status === 'PASSED').length}/${total} | ${values.filter((value) => !value.hardMeasured).length} |`;
  }).join('\n');
  const table = descriptions.flatMap((row) => ['on', 'off'].map((mode) => {
    const value = row[mode];
    return `| ${row.id} | ${mode.toUpperCase()} | ${value.status} | ${value.stage} | ${value.gateClear ? 'clear' : 'not clear'} | ${value.hardCodes} | ${value.blockers} | ${value.rounds} | ${value.time} | ${value.verifyTime} | ${value.models} |`;
  })).join('\n');
  return `# EBR-85 loop bake-off · PR B\n\nGenerated ${generatedAt}. Both modes use the same three P0 specs and hard gates; session-reported generator models are listed below (unknown or differing models limit comparability). Loop ON uses the bounded P0 runs in \`${onDirectory}\`; loop OFF uses \`--loop-off\` in \`${offDirectory}\` (one generation, no verification feedback). Both can apply the same recorded deterministic fit. Offline verification does not feed the OFF model.\n\nThe **selected-stage gate** is clear only when the selected candidate has no hard or measured visual failures, the independent critic actually reviewed the image, no blockers remain and its action is continue. This is not six-stage completion, human signoff, or a claim that unmeasured checks passed. OFF is always \`needs-human\` by design. Rates use all three attempted briefs as the denominator; unmeasured cases are listed separately, not called passes.\n\n| Mode | Selected-stage gate clear | Hard checks clear | Full automated PASSED | Hard checks unmeasured |\n|---|---:|---:|---:|---:|\n${summary}\n\n| Brief | Mode | Final status | Selected stage | Stage gate | Hard failures | Other blockers | Rounds | Generator wall time | Offline verify wall time | Generator model |\n|---|---|---|---|---|---|---|---:|---:|---:|---|\n${table}\n\nWall times are external command durations and include host-lock wait and setup; they are not model latency alone. A colour-image probe is not artistic approval. No candidate is signed or placed in the game.\n`;
}
