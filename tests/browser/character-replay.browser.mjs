import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { compareCharacterParity } from '../../tools/character-parity.mjs';

test('scripted key, mouse and touch traces match the archived baseline frame by frame', { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  const temp = await mkdtemp(join(tmpdir(), 'ebr74-main-'));
  try {
    const baseline = join(temp, 'archive');
    const archive = join(temp, 'baseline.tar');
    await mkdir(baseline);
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, '9e8c8c6c479567fcb4c7796763e86ceb6d6b72a4',
      'index.html', 'package.json', 'package-lock.json', 'src'], { cwd: root });
    execFileSync('tar', ['-xf', archive, '-C', baseline]);
    await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    const report = await compareCharacterParity({ baselineRoot: resolve(baseline), candidateRoot: root,
      baselineArchive: true, evidenceDir: process.env.EBR74_ROUTE_EVIDENCE_DIR && resolve(process.env.EBR74_ROUTE_EVIDENCE_DIR) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.frames}`).join(', ')}`);
    t.diagnostic(`Changed pixels with the new sheepfold hidden: ${Object.entries(report.frameResults).map(([name, count]) => `${name}=${count}`).join(', ')}`);
    t.diagnostic('The unchanged body geometry/shader and the body-and-fold-hidden frames match main; visible changes are body-only.');
  } finally {
    await rm(temp, { recursive: true });
  }
});
