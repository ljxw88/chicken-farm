import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceDirectory, readSpec, runDirectory } from './config.mjs';
import { renderP0Report } from './p0-report.mjs';

const ids = ['round-oak-a', 'round-oak-b', 'small-bush', 'rock-a', 'rock-b', 'rock-c', 'barrel', 'crate', 'hay-bale'];
const readJson = async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
let exits = {};
try {
  const lines = (await readFile(join(evidenceDirectory, 'logs/timings.tsv'), 'utf8')).trim().split('\n').slice(1);
  exits = Object.fromEntries(lines.map((line) => { const fields = line.split('\t'); return [fields[0], { generatorExit: Number(fields[1]), verifyExit: Number(fields[3]) }]; }));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const rows = await Promise.all(ids.map(async (id) => ({ id, spec: (await readSpec(id)).spec,
  recipe: await readJson(join(runDirectory, id, 'candidate.json')), final: await readJson(join(runDirectory, id, 'final.json')),
  verification: await readJson(join(runDirectory, id, 'verify/report.json')), ...exits[id] })));
const output = join(evidenceDirectory, 'P0-RESULT.md');
await writeFile(output, renderP0Report({ rows, generatedAt: new Date().toISOString(), runDirectory }), { flag: 'wx' });
console.log(`P0 report: ${output}`);
