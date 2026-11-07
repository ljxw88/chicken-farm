#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, writeSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { verifyBaselineArchive } from './baseline-archive.mjs';
import { evidenceInGit, filterDiffNames, parseTestCounts } from './pregate-lib.mjs';

const heavy = '/home/michael/OpenBot/Shared/farm-tools/heavy';
const evidenceRoot = '/home/michael/OpenBot/Shared/farm-evidence';

function usage() {
  return 'Usage: node tools/pregate.mjs --pr-branch <current-branch> --ebr EBRnn [--masks <masks.json>]';
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--pr-branch', '--ebr', '--masks'].includes(name) || result[name] !== undefined ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage());
    result[name] = args[++i];
  }
  const match = /^EBR-?(\d+)$/i.exec(result['--ebr'] || '');
  if (!result['--pr-branch'] || !match) throw new Error(usage());
  return { branch: result['--pr-branch'], ebr: `EBR-${match[1].replace(/^0+(?=\d)/, '')}`,
    masks: result['--masks'] ? resolve(result['--masks']) : undefined };
}

const quote = (value) => /^[a-zA-Z0-9_./:=+@,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
const text = (error) => error instanceof Error ? error.message : String(error);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    console.log(usage());
    return;
  }
  const { branch, ebr, masks } = options(process.argv.slice(2));
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const gitNames = (...args) => execFileSync('git', args, { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  const ticketDir = join(evidenceRoot, ebr);
  await mkdir(ticketDir, { recursive: true });
  let logDir = await mkdtemp(join(ticketDir, '.pregate-'));
  let runDir;
  let resultDir;
  const report = {
    version: 1, ebr, branch, startedAt: new Date().toISOString(), headSha: git('rev-parse', 'HEAD'),
    mainSha: null, masks: masks ?? null, diffNames: [], evidenceInGit: null,
    steps: Object.fromEntries(['preflight', 'fetch', 'merge', 'build', 'test', 'browser', 'baseline',
      'baselineArchive', 'baselineExtract', 'baselineNpmCi', 'parityRecord', 'parity', 'finalCheck']
      .map((name) => [name, { rc: null, skipped: 'not reached' }])),
  };
  let stopped = false;

  async function locateRun() {
    if (runDir) return;
    report.headSha = git('rev-parse', 'HEAD');
    const shortSha = git('rev-parse', '--short=7', 'HEAD');
    report.shortSha = shortSha;
    resultDir = join(ticketDir, shortSha);
    await mkdir(join(resultDir, 'runs'), { recursive: true });
    runDir = join(resultDir, 'runs', basename(logDir));
    await rename(logDir, runDir);
    for (const step of Object.values(report.steps)) {
      if (step.log?.startsWith(`${logDir}/`)) step.log = join(runDir, basename(step.log));
    }
    logDir = runDir;
  }

  async function runStep(name, executable, args, { cwd = root, env = {} } = {}) {
    const command = [...Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`),
      executable, ...args.map(quote)].join(' ');
    const log = join(logDir, `${name}.log`);
    console.log(`$ ${command}`);
    const fd = openSync(log, 'w');
    let tail = '';
    let spawnError;
    let outcome;
    try {
      const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      const capture = (chunk) => {
        writeSync(fd, chunk);
        tail = (tail + chunk.toString('utf8')).slice(-1024 * 1024);
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      outcome = await new Promise((done) => {
        child.once('error', (error) => { spawnError = error; });
        child.once('close', (code, signal) => done({ rc: code ?? (spawnError?.code === 'ENOENT' ? 127 : 1), signal }));
      });
    } finally {
      closeSync(fd);
    }
    const step = { ...outcome, command, cwd, log, ...(spawnError ? { error: text(spawnError) } : {}) };
    report.steps[name] = step;
    if (name === 'test' || name === 'browser') {
      step.counts = parseTestCounts(tail);
      if (!step.counts) step.error = 'Test runner did not emit a complete TAP summary';
    }
    console.log(`${name}: rc=${step.rc}${step.counts ? ` tests=${step.counts.tests} pass=${step.counts.pass} fail=${step.counts.fail} skipped=${step.counts.skipped ?? 0}` : ''}`);
    if (step.rc !== 0 || step.error) console.error(tail.split('\n').slice(-45).join('\n').trim() || step.error || 'Command failed');
    return step;
  }

  async function validateCache(path, sha) {
    const metadata = JSON.parse(await readFile(join(path, '.pregate-baseline.json'), 'utf8'));
    assert.equal(metadata.mainSha, sha, 'Cached baseline metadata has a different SHA');
    assert.equal(metadata.packageLockSha256, sha256(await readFile(join(path, 'package-lock.json'))),
      'Cached baseline lockfile metadata changed');
    assert.equal(await readlink(join(path, 'node_modules')), '.pregate-deps/node_modules', 'Cached dependency link changed');
    await access(join(path, 'node_modules', 'vite', 'package.json'));
    await verifyBaselineArchive(path, sha, root);
  }

  async function prepareBaseline(sha) {
    const parent = join(evidenceRoot, '_baseline');
    const target = join(parent, sha);
    await mkdir(parent, { recursive: true });
    let temporary;
    let failureRc = 1;
    try {
      if (existsSync(target)) {
        await validateCache(target, sha);
        for (const name of ['baselineArchive', 'baselineExtract', 'baselineNpmCi']) {
          report.steps[name] = { rc: null, skipped: 'cached baseline reused' };
        }
        report.steps.baseline = { rc: 0, path: target, cached: true };
        return target;
      }
      temporary = await mkdtemp(join(parent, `.${sha}-`));
      const tree = join(temporary, 'tree');
      const archive = join(temporary, 'main.tar');
      await mkdir(tree);
      const packed = await runStep('baselineArchive', 'git', ['archive', '--format=tar', `--output=${archive}`, sha]);
      failureRc = packed.rc;
      if (packed.rc !== 0) throw new Error('git archive failed');
      const extracted = await runStep('baselineExtract', 'tar', ['-xf', archive, '-C', tree]);
      failureRc = extracted.rc;
      if (extracted.rc !== 0) throw new Error('Extracting the baseline failed');
      const installed = await runStep('baselineNpmCi', heavy, ['npm', 'ci', '--include=dev', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: tree });
      failureRc = installed.rc;
      if (installed.rc !== 0) throw new Error('npm ci for the baseline failed');
      await mkdir(join(tree, '.pregate-deps'));
      await rename(join(tree, 'node_modules'), join(tree, '.pregate-deps', 'node_modules'));
      await symlink('.pregate-deps/node_modules', join(tree, 'node_modules'), 'dir');
      await verifyBaselineArchive(tree, sha, root);
      await writeFile(join(tree, '.pregate-baseline.json'), `${JSON.stringify({ mainSha: sha,
        packageLockSha256: sha256(await readFile(join(tree, 'package-lock.json'))), createdAt: new Date().toISOString() }, null, 2)}\n`);
      try {
        await rename(tree, target);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        await validateCache(target, sha); // Another run finished the same SHA first.
      }
      report.steps.baseline = { rc: 0, path: target, cached: false };
      return target;
    } catch (error) {
      report.steps.baseline = { rc: failureRc || 1, path: target, error: text(error) };
      console.error(`Baseline unavailable: ${text(error)}`);
      return null;
    } finally {
      // Only the unique staging directory created above is ever removed.
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }

  try {
    const actualBranch = git('branch', '--show-current');
    const status = gitNames('status', '--porcelain=v1', '--untracked-files=all', '-z');
    if (actualBranch !== branch || status.length) {
      report.steps.preflight = { rc: 1, actualBranch, expectedBranch: branch, status };
      throw new Error(actualBranch !== branch ? `Current branch is ${actualBranch || '(detached)'}, not ${branch}` :
        `Worktree must be clean before merging:\n${status.join('\n')}`);
    }
    report.steps.preflight = { rc: 0, actualBranch, status: [] };

    const fetched = await runStep('fetch', 'git', ['fetch', 'origin', 'main'], { env: { GIT_TERMINAL_PROMPT: '0' } });
    if (fetched.rc !== 0) throw new Error('Fetch failed; no merge attempted');
    report.mainSha = git('rev-parse', '--verify', 'origin/main^{commit}');

    const merged = await runStep('merge', 'git', ['merge', '--no-edit', '--no-autostash', '--no-overwrite-ignore', 'origin/main']);
    if (merged.rc !== 0) {
      merged.conflicts = gitNames('diff', '--name-only', '--diff-filter=U', '-z');
      if (merged.conflicts.length) console.error(`Merge conflicts (resolve them before rerunning):\n${merged.conflicts.join('\n')}`);
      throw new Error('Merge failed; the merge state was left untouched');
    }
    report.headSha = git('rev-parse', 'HEAD');
    assert.equal(git('rev-parse', '--verify', 'origin/main^{commit}'), report.mainSha, 'origin/main moved during the merge');
    execFileSync('git', ['merge-base', '--is-ancestor', report.mainSha, 'HEAD'], { cwd: root });
    await locateRun();

    report.diffNames = filterDiffNames(gitNames('diff', '--no-renames', '--name-only', '-z', 'origin/main', 'HEAD', '--'));
    report.evidenceInGit = evidenceInGit(gitNames('ls-files', '-z'));
    await runStep('build', heavy, ['npm', 'run', 'build']);
    await runStep('test', heavy, ['npm', 'test']);
    await runStep('browser', heavy, ['npm', 'run', 'test:browser']);

    const afterTests = gitNames('status', '--porcelain=v1', '--untracked-files=all', '-z');
    if (afterTests.length) {
      report.steps.finalCheck = { rc: 1, status: afterTests, error: 'Tests changed the worktree; parity was not run' };
    } else if (existsSync(join(root, 'tools/parity.mjs'))) {
      const baseline = await prepareBaseline(report.mainSha);
      if (baseline) {
        const parityDir = join(runDir, 'parity');
        const env = { PARITY_EVIDENCE_DIR: parityDir, PARITY_BASELINE_DIR: '' };
        const recorded = await runStep('parityRecord', heavy, [process.execPath, 'tools/parity.mjs', '--record-baseline',
          '--baseline-sha', report.mainSha, '--baseline-root', baseline, '--baseline-port-range', '5211-5229'], { env });
        if (recorded.rc === 0) {
          const args = [process.execPath, 'tools/parity.mjs', ...(masks ? ['--masks', masks] : [])];
          const compared = await runStep('parity', heavy, args, { env });
          try {
            const parity = JSON.parse(await readFile(join(parityDir, 'parity.json'), 'utf8'));
            assert.equal(parity.baselineSha, report.mainSha, 'Parity compared a different baseline');
            assert.equal(parity.candidateSha, report.headSha, 'Parity compared a different candidate HEAD');
            assert.equal(parity.sourceStatus, '', 'Candidate source changed during parity');
            assert.ok(Object.keys(parity.results).length > 0 && Object.values(parity.results).every((result) =>
              Number.isInteger(result.changedPixels) && Number.isInteger(result.outsideMaskPixels)), 'Incomplete parity counts');
            compared.counts = { frames: Object.keys(parity.results).length,
              changedPixels: Object.values(parity.results).reduce((sum, result) => sum + result.changedPixels, 0),
              outsideMaskPixels: Object.values(parity.results).reduce((sum, result) => sum + result.outsideMaskPixels, 0),
              stateMismatches: parity.stateMismatches.length };
          } catch (error) {
            compared.error = `Could not validate parity results: ${text(error)}`;
          }
        } else report.steps.parity = { rc: null, skipped: 'baseline capture failed' };
      } else {
        report.steps.parityRecord = { rc: null, skipped: 'baseline unavailable' };
        report.steps.parity = { rc: null, skipped: 'baseline unavailable' };
      }
    } else {
      report.steps.baseline = { rc: null, skipped: 'no pixel gate exists' };
      report.steps.parityRecord = { rc: null, skipped: 'no pixel gate exists' };
      report.steps.parity = { rc: null, skipped: 'no pixel gate exists' };
    }

    if (report.steps.finalCheck.rc === null) {
      const status = gitNames('status', '--porcelain=v1', '--untracked-files=all', '-z');
      const currentMain = git('rev-parse', '--verify', 'origin/main^{commit}');
      const currentHead = git('rev-parse', 'HEAD');
      const currentBranch = git('branch', '--show-current');
      report.evidenceInGit = evidenceInGit(gitNames('ls-files', '-z'));
      report.steps.finalCheck = { rc: status.length || currentMain !== report.mainSha || currentHead !== report.headSha ||
        currentBranch !== branch || !report.evidenceInGit.ok ? 1 : 0,
        status, currentMain, currentHead, currentBranch, evidenceInGit: report.evidenceInGit };
    }
  } catch (error) {
    stopped = true;
    report.error = text(error);
    console.error(`Pre-gate stopped: ${report.error}`);
  } finally {
    await locateRun();
    report.evidenceInGit = evidenceInGit(gitNames('ls-files', '-z'));
    if (report.steps.finalCheck.rc !== null) {
      report.steps.finalCheck.evidenceInGit = report.evidenceInGit;
      if (!report.evidenceInGit.ok) report.steps.finalCheck.rc = 1;
    }
    if (report.mainSha && !report.diffNames.length) {
      report.diffNames = filterDiffNames(gitNames('diff', '--no-renames', '--name-only', '-z', 'origin/main', 'HEAD', '--'));
    }
    report.diffCount = report.diffNames.length;
    const required = ['preflight', 'fetch', 'merge', 'build', 'test', 'browser', 'finalCheck'];
    const gateNames = report.steps.parity.skipped === 'no pixel gate exists' ? [] : ['baseline', 'parityRecord', 'parity'];
    report.ok = !stopped && report.evidenceInGit.ok && [...required, ...gateNames].every((name) =>
      report.steps[name].rc === 0 && !report.steps[name].error);
    report.finishedAt = new Date().toISOString();
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const runReport = join(runDir, 'pregate.json');
    const result = join(resultDir, 'pregate.json');
    await writeFile(runReport, json);
    const temporary = join(runDir, 'pregate-latest.tmp');
    await writeFile(temporary, json);
    await rename(temporary, result);
    const count = (name) => report.steps[name].counts ? `${report.steps[name].counts.pass}/${report.steps[name].counts.tests}` : '-';
    console.log(`PREGATE ${report.ok ? 'PASS' : 'FAIL'} ${ebr} ${report.shortSha} build=${report.steps.build.rc ?? '-'} unit=${count('test')} browser=${count('browser')} parity=${report.steps.parity.rc ?? '-'} evidence=${report.evidenceInGit.count} result=${result}`);
    if (!report.ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Pre-gate failed: ${text(error)}`);
  process.exitCode = 1;
});
