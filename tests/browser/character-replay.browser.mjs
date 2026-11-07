import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { compareCharacterParity } from '../../tools/character-parity.mjs';

const references = [
  { label: '9e8c8c6', sha: '9e8c8c6c479567fcb4c7796763e86ceb6d6b72a4', env: 'EBR74_BASELINE_WORKTREE' },
  { label: '5d9ba48', sha: '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff', env: 'EBR94_BASELINE_WORKTREE' },
];

for (const reference of references) test(`scripted key, mouse and touch traces match ${reference.label} frame by frame`, { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  let baseline = process.env[reference.env];
  let archiveDir;
  let archivedBaselineSha;
  try {
    if (!baseline) {
      // A clean archive gives the replay its reference without creating or
      // removing a Git worktree on the shared host.
      archivedBaselineSha = reference.sha;
      try {
        archiveDir = await mkdtemp('/tmp/opencode/ebr74-main-');
      } catch (error) {
        if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
        archiveDir = await mkdtemp(join(tmpdir(), 'ebr74-main-'));
      }
      baseline = join(archiveDir, 'checkout');
      await mkdir(baseline);
      const archive = join(archiveDir, 'baseline.tar');
      execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, archivedBaselineSha,
        'index.html', 'package.json', 'package-lock.json', 'src'], { cwd: root });
      execFileSync('tar', ['-xf', archive, '-C', baseline]);
      await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    }
    const report = await compareCharacterParity({ baselineRoot: resolve(baseline), candidateRoot: root,
      baselineSha: reference.sha, archivedBaselineSha,
      evidenceDir: process.env.EBR74_ROUTE_EVIDENCE_DIR && resolve(process.env.EBR74_ROUTE_EVIDENCE_DIR, reference.label) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.frames}`).join(', ')}`);
    t.diagnostic(`Raw changed pixels: ${Object.entries(report.frameResults).map(([name, count]) => `${name}=${count}`).join(', ')}`);
    t.diagnostic(`With effects hidden: ${Object.entries(report.unaffectedFrameResults).map(([name, count]) => `${name}=${count}`).join(', ')}`);
    t.diagnostic('Outside body/effect masks and with both hidden: zero; character geometry and shader match.');
  } finally {
    if (archiveDir) await rm(archiveDir, { recursive: true });
  }
});
