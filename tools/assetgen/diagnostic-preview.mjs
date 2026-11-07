/** Permit only non-executing, explicitly labeled previews of a narrow set of
 * schema errors. This never changes the recipe or its verification result. */
export function diagnosticEligibility(recipe, schemaFailures, rules) {
  const parts = recipe?.parts;
  if (!Array.isArray(parts) || !parts.length || (Number.isInteger(rules.maxParts) && parts.length > rules.maxParts) ||
      parts.some((part) => !part || typeof part.name !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(part.name)) ||
      new Set(parts.map((part) => part.name)).size !== parts.length) return { safe: false, notes: [] };
  for (const part of parts) {
    if (part.seed !== undefined && !Number.isInteger(part.seed)) return { safe: false, notes: [] };
    if (part.jitter === undefined) continue;
    if (!part.jitter || typeof part.jitter !== 'object' || Array.isArray(part.jitter)) return { safe: false, notes: [] };
    for (const [key, value] of Object.entries(part.jitter)) {
      if (key === 'seed') { if (!Number.isInteger(value)) return { safe: false, notes: [] }; }
      else if (key === 'max' || key === 'rot') {
        const values = Array.isArray(value) ? value : [value];
        if (![1, 3].includes(values.length) || values.some((item) => !Number.isFinite(item) || item < 0 || item > rules.jitterMaximum)) return { safe: false, notes: [] };
      } else if (!['position', 'rotation'].includes(key) || !Number.isFinite(value) || value < 0 || value > rules.jitterMaximum) return { safe: false, notes: [] };
    }
  }
  const allowed = schemaFailures.every((failure) => failure.code === 'VARIANT_SEED' || failure.code === 'H1' &&
    (/^Invalid or duplicate part name [a-z0-9_-]+$/i.test(failure.message) || /^Part [a-z0-9_-]+ jitter requires an integer seed$/i.test(failure.message)));
  if (!allowed) return { safe: false, notes: [] };
  const notes = [];
  if (schemaFailures.length) notes.push('Schema or variant failures remain in force; this is a diagnostic render, not verification.');
  if (parts.some((part) => part.jitter && (!Number.isInteger(part.seed) || ['seed', 'max', 'rot'].some((key) => Object.hasOwn(part.jitter, key))))) {
    notes.push('The builder ignores unsupported nested jitter seed/max/rot fields; the requested seeded variation is not shown.');
  }
  if (parts.some((part) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part.name))) notes.push('Some part names are not valid kebab-case; no names were repaired.');
  return { safe: true, notes };
}
