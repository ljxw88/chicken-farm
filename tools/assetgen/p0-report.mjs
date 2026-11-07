const uniq = (items) => [...new Set(items.filter(Boolean))];

function codes(row) {
  const startup = row.generatorExit != null && row.generatorExit !== 0 && !row.final ? 'GENERATOR_ERROR' : null;
  const verifyError = row.verifyExit != null && row.verifyExit !== 0 && !row.verification ? 'VERIFY_ERROR' : null;
  if (!row.final) return uniq(['NO_FINAL', startup, verifyError]);
  const last = row.final.history?.at(-1);
  const verifyVisual = typeof row.verification?.visual === 'object' ? row.verification.visual : null;
  return uniq([...(row.final.best?.blockers || []).map((item) => item.code), ...(last?.blockers || []),
    ...(row.verification?.hard?.failures || []).map((item) => item.code), ...(verifyVisual?.failures || []).map((item) => item.code),
    ...(last?.failure ? ['GENERATOR'] : []), verifyError]);
}

export function renderP0Report({ rows, generatedAt, runDirectory }) {
  const table = rows.map((row) => {
    const usage = row.final?.usage;
    const tokens = usage ? `${usage.input} / ${usage.output} / ${usage.reasoning}${usage.complete === false ? ' (partial)' : ''}` : 'unknown';
    const cost = usage?.reportedCostUSD == null ? 'unknown' : `$${usage.reportedCostUSD.toFixed(6)}`;
    const seed = row.spec?.variationSeed;
    const seeded = Array.isArray(row.recipe?.parts) && row.recipe.parts.some((part) => part?.seed === seed && Object.values(part.jitter || {}).some((amount) => amount > 0));
    const seedLabel = seed === undefined ? '—' : `${seed} (${seeded ? 'used' : 'missing'})`;
    return `| ${row.id} | ${row.final?.roundsUsed ?? 0} | ${row.final?.status ?? 'not completed'} | ${codes(row).join(', ') || 'none recorded'} | ${seedLabel} | ${tokens} | ${cost} | ${row.final?.visualCritiqueStatus ?? 'not run'} |`;
  }).join('\n');
  const reasons = rows.map((row) => `- **${row.id}:** ${row.final?.stopReason || 'No final report; inspect the generator log.'}`).join('\n');
  return `# P0 calibration runs · PR B\n\nGenerated ${generatedAt}. Evidence and verifier reports: \`${runDirectory}\`. These are review-only; no Look Dev signoff or runtime registry entry is implied. Failing codes combine the selected candidate, the last attempted stage, and offline verification. Missing checks are not passes. Variant seeds control recipe jitter; the OpenCode CLI does not expose a model sampling seed. The brief provides expected heights, not P0 footprint dimensions; widths and depths are design proposals based on existing specs, not measured reference values.\n\n| Brief | Rounds | Final status | Failing codes | Recipe seed | Tokens (input / output / reasoning) | Reported cost | Visual critique |\n|---|---:|---|---|---|---:|---:|---|\n${table}\n\n## Stop reasons\n\n${reasons}\n\nToken counts and cost are session-reported, not estimates; partial token totals exclude sessions with missing usage. \`unknown\` includes any incomplete or missing cost data. A visual critic is not independent Look Dev signoff.\n`;
}
