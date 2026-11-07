import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceInGit, filterDiffNames, parseTestCounts } from '../tools/pregate-lib.mjs';
import { outputDirectory } from '../tools/evidence-path.mjs';

test('diff names retain only the requested roots and exact top-level files', () => {
  const names = ['src/main.ts', 'tests/browser/a b.mjs', 'tools/pregate.mjs', 'index.html', 'package.json',
    'package-lock.json', 'src-old/main.ts', 'src', 'tests', 'tools', 'docs/readme.md', 'nested/tools/a', 'package.json.backup',
    'evidence/frame.png', '.gitignore'];
  assert.deepEqual(filterDiffNames(names), [...names.slice(0, 6), 'src', 'tests', 'tools']);
});

test('evidence check detects tracked root evidence, deliveries and handoffs only', () => {
  const names = ['tools/fixtures/historical/EBR-73/baseline.json', 'tests/evidence/example.json',
    'evidence/frame.png', 'evidence/nested/file.json', 'DELIVER.txt', 'DELIVER-EBR95.txt',
    'handoffs/note.md', 'docs/DELIVER-EBR95.txt', 'DELIVER-EBR95.md', 'handoffs-old/note.md'];
  assert.deepEqual(evidenceInGit(names), { ok: false, count: 5, tracked: names.slice(2, 7) });
  assert.deepEqual(evidenceInGit(['tools/fixtures/historical/frame.png', 'evidence-old/a']),
    { ok: true, count: 0, tracked: [] });
  assert.equal(evidenceInGit(['evidence', 'handoffs']).count, 2);
  assert.equal(evidenceInGit(['evidence/conflict.png', 'evidence/conflict.png']).count, 1);
});

test('test counts come from the final TAP footer and incomplete footers fail closed', () => {
  const output = '# tests 2\n# pass 2\n# fail 0\nnoise\n# tests 12\n# suites 3\n# pass 10\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n';
  assert.deepEqual(parseTestCounts(output), { tests: 12, suites: 3, pass: 10, fail: 1, cancelled: 0, skipped: 1, todo: 0 });
  assert.deepEqual(parseTestCounts('ℹ tests 4\nℹ pass 4\nℹ fail 0\n'), { tests: 4, pass: 4, fail: 0 });
  assert.equal(parseTestCounts('# tests 2\n# pass 2\n# fail 0\n# tests 3\n'), null);
  assert.equal(parseTestCounts('npm failed before tests started'), null);
});

test('output directories default outside the worktree and preserve legacy overrides', () => {
  const saved = { EVIDENCE_DIR: process.env.EVIDENCE_DIR, PARITY_EVIDENCE_DIR: process.env.PARITY_EVIDENCE_DIR };
  try {
    delete process.env.EVIDENCE_DIR;
    delete process.env.PARITY_EVIDENCE_DIR;
    assert.equal(outputDirectory('parity', 'PARITY_EVIDENCE_DIR'), '/home/michael/OpenBot/Shared/farm-evidence/parity');
    process.env.EVIDENCE_DIR = '/tmp/generic-output';
    assert.equal(outputDirectory('parity', 'PARITY_EVIDENCE_DIR'), '/tmp/generic-output');
    process.env.PARITY_EVIDENCE_DIR = '/tmp/legacy-output';
    assert.equal(outputDirectory('parity', 'PARITY_EVIDENCE_DIR'), '/tmp/legacy-output');
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
