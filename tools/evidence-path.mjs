import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const historicalFixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/historical');

// Older tool-specific overrides retain priority; EVIDENCE_DIR overrides the
// whole output directory, not just its parent.
export function outputDirectory(tool, ...legacyVariables) {
  const override = [...legacyVariables, 'EVIDENCE_DIR'].map((name) => process.env[name]).find(Boolean);
  return resolve(override || join('/home/michael/OpenBot/Shared/farm-evidence', tool));
}
