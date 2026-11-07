const unique = (items) => [...new Set(items.filter(Boolean))];
const axes = ['ready', 'hardClear', 'schemaClear', 'validVariantJitter'];

export function summarizeP0(rows) {
  const summary = { attempted: 0, ready: 0, hardClear: 0, schemaClear: 0, validVariantJitter: 0 };
  for (const row of rows) {
    if (!row.final && !row.assessment && !row.attempted) continue;
    summary.attempted++;
    if (row.assessment?.ready === true) summary.ready++;
    const hard = row.verification?.hard;
    if (Array.isArray(hard?.failures)) {
      if (!hard.failures.length && Array.from({ length: 10 }, (_, i) => hard.metrics?.checks?.[`H${i + 1}`] === true).every(Boolean)) summary.hardClear++;
      if (!hard.failures.some((failure) => ['H1', 'VARIANT_SEED', 'FORBIDDEN_FEATURE', 'BAKED_LIGHT', 'G_HIDDEN', 'G_NON_FINITE', 'G_ZERO_SCALE'].includes(failure.code))) summary.schemaClear++;
    }
    const seed = row.spec?.variationSeed;
    if (seed !== undefined && Array.isArray(row.recipe?.parts) && row.recipe.parts.some((part) => part?.seed === seed && part.jitter &&
        typeof part.jitter === 'object' && !Array.isArray(part.jitter) && Object.keys(part.jitter).every((key) => ['position', 'rotation'].includes(key)) &&
        Object.values(part.jitter).every((value) => Number.isFinite(value) && value >= 0 && value <= 0.03) &&
        Object.values(part.jitter).some((value) => value > 0))) summary.validVariantJitter++;
  }
  return summary;
}

/** Compare fully attempted iterations, prioritizing actual review-ready assets. */
export function improvesP0(current, best) {
  if (current.attempted < 9) return false;
  for (const key of axes) if (current[key] !== best[key]) return current[key] > best[key];
  return false;
}

export function renderP0Iteration({ rows, iteration, generatedAt, runDirectory }) {
  const summary = summarizeP0(rows);
  const table = rows.map((row) => {
    const reasons = row.assessment?.reasons || [];
    const codes = unique(reasons.map((reason) => reason.code));
    const status = row.assessment?.ready ? 'ready for Look Dev P0 review' : row.final?.status ?? (row.attempted ? 'not completed' : 'not attempted');
    const blocker = row.assessment?.ready ? 'none in implemented checks; human review required' : reasons[0]?.message || row.final?.stopReason || (row.attempted ? 'assessment unavailable' : 'stopped before run');
    const safe = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
    return `| ${row.id} | ${row.final?.roundsUsed ?? 0} | ${safe(status)} | ${codes.join(', ') || (row.assessment?.ready ? 'none' : 'not measured')} | ${safe(blocker)} |`;
  }).join('\n');
  return `# P0 fix iteration ${iteration}\n\nGenerated ${generatedAt}. Runs: \`${runDirectory}\`. **${summary.ready} P0 candidate(s) clear all implemented offline checks and an authenticated independent image critic.** This means ready for Look Dev P0 review only, not signed, bundled or cleared for unimplemented checks.\n\nProgress counts: ${summary.attempted}/9 attempted; ${summary.ready} ready; ${summary.hardClear} hard-check clear; ${summary.schemaClear} schema clear; ${summary.validVariantJitter}/5 use valid required variant jitter. Progress is compared lexicographically in that order after a full nine-asset attempt; schema or hard-check improvements alone are not passes.\n\n| Brief | Rounds | Status | Failing / unmeasured codes | First blocking reason |\n|---|---:|---|---|---|\n${table}\n\nSee each \`review-readiness.json\`, verifier report and critic receipt for the full evidence. Unmeasured S1/S3/S5/S7 and excluded silhouette edges are not passes.\n`;
}
