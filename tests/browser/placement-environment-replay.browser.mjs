import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { comparePlacementEnvironmentReplay } from '../../tools/placement-environment-replay.mjs';

const references = [
  { label: 'dcbaf70', sha: 'dcbaf70b8f2c1038afe5c0b70f506ec7de931214', env: 'EBR75_DCB_BASELINE_WORKTREE' },
  { label: '5d9ba48', sha: '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff', env: 'EBR75_MAIN_BASELINE_WORKTREE' },
];

for (const reference of references) test(`placement and environment replay against clean main ${reference.label}`, { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  let baseline = process.env[reference.env];
  let archiveDir;
  let archivedBaselineSha;
  try {
    if (!baseline) {
      try {
        archiveDir = await mkdtemp('/tmp/opencode/ebr75-main-');
      } catch (error) {
        if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
        archiveDir = await mkdtemp(join(tmpdir(), 'ebr75-main-'));
      }
      // A clean archive avoids creating or force-removing another Git worktree.
      archivedBaselineSha = reference.sha;
      baseline = join(archiveDir, 'checkout');
      await mkdir(baseline);
      const archive = join(archiveDir, 'baseline.tar');
      execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, reference.sha,
        'index.html', 'package.json', 'package-lock.json', 'src'], { cwd: root });
      execFileSync('tar', ['-xf', archive, '-C', baseline]);
      await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    }
    const report = await comparePlacementEnvironmentReplay({ baselineRoot: resolve(baseline), candidateRoot: root,
      baselineSha: reference.sha, archivedBaselineSha,
      evidenceDir: process.env.EBR75_REPLAY_EVIDENCE_DIR && resolve(process.env.EBR75_REPLAY_EVIDENCE_DIR, reference.label) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.samples}`).join(', ')}`);
    t.diagnostic(`Additional frames: ${Object.keys(report.visualResults).length}; body-only: ${report.intendedBodyChanges.length}; expected EBR-88 rain changes: ${report.expectedRainChanges.length}; unexpected: ${report.unexpectedVisualChanges.length}`);
  } finally {
    if (archiveDir) await rm(archiveDir, { recursive: true });
  }
});
