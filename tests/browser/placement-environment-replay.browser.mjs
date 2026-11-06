import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { comparePlacementEnvironmentReplay } from '../../tools/placement-environment-replay.mjs';

const baselineSha = 'dcbaf70b8f2c1038afe5c0b70f506ec7de931214';

test('placement and environment replay exactly matches a clean dcbaf70 worktree', { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  let baseline = process.env.EBR75_BASELINE_WORKTREE;
  let owned = false;
  try {
    if (!baseline) {
      try {
        baseline = await mkdtemp('/tmp/opencode/ebr75-main-');
      } catch (error) {
        if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
        baseline = await mkdtemp(join(tmpdir(), 'ebr75-main-'));
      }
      execFileSync('git', ['worktree', 'add', '--detach', baseline, baselineSha], { cwd: root });
      owned = true;
      await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    }
    const report = await comparePlacementEnvironmentReplay({ baselineRoot: resolve(baseline), candidateRoot: root,
      evidenceDir: process.env.EBR75_REPLAY_EVIDENCE_DIR && resolve(process.env.EBR75_REPLAY_EVIDENCE_DIR) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.samples}`).join(', ')}`);
    t.diagnostic(`Additional frames: ${Object.keys(report.visualResults).length}; changed pixels: ${Object.values(report.visualResults).reduce((a, b) => a + b, 0)}`);
  } finally {
    if (owned) {
      // This worktree and its reference trace were created only by this test.
      await rm(join(baseline, 'node_modules'), { force: true });
      execFileSync('git', ['worktree', 'remove', '--force', baseline], { cwd: root });
    }
  }
});
