import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceDirectory } from './config.mjs';
import { trackP0Progress } from './p0-iteration.mjs';

const count = Number(process.argv[2]);
if (!Number.isInteger(count) || count < 1) throw new Error('Usage: node tools/assetgen/track-p0-progress.mjs <iteration-count>');
const baseline = JSON.parse(await readFile(join(evidenceDirectory, 'BASELINE.json'), 'utf8')).summary;
const iterations = [];
for (let i = 1; i <= count; i++) iterations.push(JSON.parse(await readFile(join(evidenceDirectory, `ITERATION-${i}.json`), 'utf8')).summary);
const result = trackP0Progress(baseline, iterations);
const output = join(evidenceDirectory, `PROGRESS-${count}.json`);
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
