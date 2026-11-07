import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { comparePlacementEnvironmentReplay } from '../tools/placement-environment-replay.mjs';

test('current-main replay rejects a tampered archive before starting a browser', async (t) => {
  let archive;
  try { archive = await mkdtemp('/tmp/opencode/ebr76-archive-integrity-'); }
  catch (error) {
    if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
    archive = await mkdtemp(join(tmpdir(), 'ebr76-archive-integrity-'));
  }
  t.after(() => rm(archive, { recursive: true, force: true }));
  await writeFile(join(archive, 'index.html'), 'tampered');
  const baselineSha = '843c242da5f3bc0e4c2b12ef5484113165c914c7';
  await assert.rejects(comparePlacementEnvironmentReplay({ baselineRoot: archive, candidateRoot: process.cwd(),
    baselineSha, archivedBaselineSha: baselineSha }), /Archived baseline differs: index\.html/);
});
