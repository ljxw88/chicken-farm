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
  let temp;
  let baselineArchive = false;
  try {
    if (!baseline) {
      try {
        temp = await mkdtemp('/tmp/opencode/ebr75-main-');
      } catch (error) {
        if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
        temp = await mkdtemp(join(tmpdir(), 'ebr75-main-'));
      }
      baseline = join(temp, 'archive');
      await mkdir(baseline);
      const resolved = execFileSync('git', ['rev-parse', `${reference.sha}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
      if (resolved !== reference.sha) throw new Error(`Unexpected baseline: ${resolved}`);
      const archive = join(temp, 'baseline.tar');
      execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, reference.sha,
        'index.html', 'package.json', 'package-lock.json', 'src'], { cwd: root });
      execFileSync('tar', ['-xf', archive, '-C', baseline]);
      await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
      baselineArchive = true;
    }
    const report = await comparePlacementEnvironmentReplay({ baselineRoot: resolve(baseline), candidateRoot: root,
      baselineSha: reference.sha, baselineArchive,
      evidenceDir: process.env.EBR75_REPLAY_EVIDENCE_DIR && resolve(process.env.EBR75_REPLAY_EVIDENCE_DIR, reference.label) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.samples}`).join(', ')}`);
    t.diagnostic(`Additional frames with the new fold hidden: ${Object.keys(report.visualResults).length}; body-only: ${report.intendedBodyChanges.length}; expected EBR-88 rain changes: ${report.expectedRainChanges.length}; unexpected: ${report.unexpectedVisualChanges.length}`);
  } finally {
    if (temp) await rm(temp, { recursive: true });
  }
});
