import { resolve } from 'node:path';
import { test } from 'node:test';
import { comparePlacementEnvironmentReplay } from '../../tools/placement-environment-replay.mjs';

const references = [
  { label: 'dcbaf70', sha: 'dcbaf70b8f2c1038afe5c0b70f506ec7de931214', env: 'EBR75_DCB_BASELINE_WORKTREE' },
  { label: '5d9ba48', sha: '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff', env: 'EBR75_MAIN_BASELINE_WORKTREE' },
];

for (const reference of references) test(`placement and environment replay against clean main ${reference.label}`, { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  const baseline = process.env[reference.env];
  const report = await comparePlacementEnvironmentReplay({ baselineRoot: baseline && resolve(baseline), candidateRoot: root,
    baselineSha: reference.sha,
    evidenceDir: process.env.EBR75_REPLAY_EVIDENCE_DIR && resolve(process.env.EBR75_REPLAY_EVIDENCE_DIR, reference.label) });
  t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.samples}`).join(', ')}`);
  t.diagnostic(`Additional frames: ${Object.keys(report.visualResults).length}; expected EBR-88 rain changes: ${report.expectedRainChanges.length}; unexpected: ${report.unexpectedVisualChanges.length}`);
  t.diagnostic(`Raw frame differences: ${Object.values(report.rawVisualResults).filter((count) => count > 0).length} frames; exact without-effects comparisons retained`);
});
