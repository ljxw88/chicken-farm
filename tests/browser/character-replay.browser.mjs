import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
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
      try {
        baseline = await mkdtemp('/tmp/opencode/ebr74-main-');
      } catch (error) {
        if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
        baseline = await mkdtemp(join(tmpdir(), 'ebr74-main-'));
      }
      owned = true;
      const archive = join(baseline, 'main.tar');
      execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff',
        'index.html', 'package.json', 'package-lock.json', 'src'], { cwd: root });
      execFileSync('tar', ['-xf', archive, '-C', baseline]);
      await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    }
    const report = await compareCharacterParity({ baselineRoot: resolve(baseline), candidateRoot: root,
      baselineIsArchive: owned, evidenceDir: process.env.EBR74_ROUTE_EVIDENCE_DIR && resolve(process.env.EBR74_ROUTE_EVIDENCE_DIR) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.frames}`).join(', ')}`);
    t.diagnostic(`Changed pixels: ${Object.entries(report.frameResults).map(([name, count]) => `${name}=${count}`).join(', ')}`);
  } finally {
    if (owned) await rm(baseline, { recursive: true });
  }
});
