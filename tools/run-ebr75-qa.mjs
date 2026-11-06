import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'vite';
import { compareQaSequences } from './compare-qa-sequences.mjs';

// Run the supplied real-time QA capture and its strict position/height check
// together under one heavy-run lock; its screenshots are not a pixel oracle.
const qa = '/home/michael/OpenBot/Shared/qa-graphics-gate/gate-g-sequences';
const output = resolve(process.argv[2] ?? 'evidence/EBR-75/qa-wrapped');
const server = await createServer({ configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false } });
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const child = spawn(process.execPath, [`${qa}/gateg-sequences.mjs`, `http://127.0.0.1:${address.port}`,
    output, `${process.cwd()}${sep}`], { stdio: 'inherit' });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => signal ? reject(new Error(`QA capture terminated: ${signal}`)) : resolveExit(code));
  });
  assert.equal(exitCode, 0, 'QA capture failed');
  const baseline = JSON.parse(await readFile(`${qa}/main-9e8c8c6/sequences.json`, 'utf8'));
  const candidate = JSON.parse(await readFile(`${output}/sequences.json`, 'utf8'));
  const report = compareQaSequences(baseline, candidate);
  await writeFile(`${output}/comparison.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.checks.length - report.failures.length}/${report.checks.length} strict QA checks pass`);
  if (report.failures.length) {
    console.error(JSON.stringify(report.failures, null, 2));
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
