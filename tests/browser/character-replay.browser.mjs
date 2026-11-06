import { execFileSync } from 'node:child_process';
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { compareCharacterParity } from '../../tools/character-parity.mjs';

test('scripted key, mouse and touch traces match the main worktree frame by frame', { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  let baseline = process.env.EBR74_BASELINE_WORKTREE;
  let owned = false;
  try {
    if (!baseline) {
      baseline = await mkdtemp(join(tmpdir(), 'ebr74-main-'));
      execFileSync('git', ['worktree', 'add', '--detach', baseline, '9e8c8c6c479567fcb4c7796763e86ceb6d6b72a4'], { cwd: root });
      owned = true;
      await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    }
    const report = await compareCharacterParity({ baselineRoot: resolve(baseline), candidateRoot: root,
      evidenceDir: process.env.EBR74_ROUTE_EVIDENCE_DIR && resolve(process.env.EBR74_ROUTE_EVIDENCE_DIR) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.frames}`).join(', ')}`);
    t.diagnostic(`Changed pixels: ${Object.entries(report.frameResults).map(([name, count]) => `${name}=${count}`).join(', ')}`);
  } finally {
    if (owned) execFileSync('git', ['worktree', 'remove', '--force', baseline], { cwd: root });
  }
});
