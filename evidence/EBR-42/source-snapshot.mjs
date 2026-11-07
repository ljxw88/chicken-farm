import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Evidence may be captured before its single encompassing commit. Require all
// runtime/test inputs to match the index, and record their exact Git trees.
const inputs = ['src', 'tests', 'tools', 'index.html', 'package.json', 'package-lock.json'];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function captureSourceSnapshot() {
  const unstaged = git('diff', '--name-only', '--', ...inputs);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...inputs);
  assert.equal(unstaged, '', 'Stage all runtime, test and tool changes before capturing evidence');
  assert.equal(untracked, '', 'Untracked runtime, test or tool files cannot be included in evidence');
  const head = git('rev-parse', 'HEAD');
  const indexTree = git('write-tree');
  return {
    head,
    indexTree,
    srcTree: git('rev-parse', `${indexTree}:src`),
    testsTree: git('rev-parse', `${indexTree}:tests`),
    toolsTree: git('rev-parse', `${indexTree}:tools`),
    indexHtml: git('rev-parse', `${indexTree}:index.html`),
    packageJson: git('rev-parse', `${indexTree}:package.json`),
    packageLock: git('rev-parse', `${indexTree}:package-lock.json`),
    sourceStatus: git('status', '--porcelain', '--untracked-files=all', '--', ...inputs),
  };
}
