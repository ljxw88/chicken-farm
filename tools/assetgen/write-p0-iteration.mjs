import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceDirectory, readSpec, runDirectory } from './config.mjs';
import { renderP0Iteration, summarizeP0 } from './p0-iteration.mjs';

const iteration = Number(process.argv[2]);
if (!Number.isInteger(iteration) || iteration < 1) throw new Error('Usage: node tools/assetgen/write-p0-iteration.mjs <iteration-number>');
const ids = ['round-oak-a', 'round-oak-b', 'small-bush', 'rock-a', 'rock-b', 'rock-c', 'barrel', 'crate', 'hay-bale'];
const json = async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
let attempted = new Set();
try { attempted = new Set((await readFile(join(evidenceDirectory, 'logs', `iteration-${iteration}.tsv`), 'utf8')).trim().split('\n').slice(1).map((line) => line.split('\t')[0])); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const rows = await Promise.all(ids.map(async (id) => ({ id, spec: (await readSpec(id)).spec, recipe: await json(join(runDirectory, id, 'candidate.json')),
  final: await json(join(runDirectory, id, 'final.json')), verification: await json(join(runDirectory, id, 'verify/report.json')),
  assessment: await json(join(runDirectory, id, 'review-readiness.json')), attempted: attempted.has(id) })));
const summary = summarizeP0(rows), dataPath = join(evidenceDirectory, `ITERATION-${iteration}.json`), reportPath = join(evidenceDirectory, `ITERATION-${iteration}.md`);
await writeFile(dataPath, `${JSON.stringify({ iteration, runDirectory, summary, rows }, null, 2)}\n`, { flag: 'wx' });
await writeFile(reportPath, renderP0Iteration({ rows, iteration, generatedAt: new Date().toISOString(), runDirectory }), { flag: 'wx' });
console.log(JSON.stringify({ iteration, summary, reportPath }, null, 2));
