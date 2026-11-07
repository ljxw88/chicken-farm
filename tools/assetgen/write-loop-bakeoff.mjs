import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { evidenceDirectory } from './config.mjs';
import { renderLoopBakeoff } from './bakeoff-loop-report.mjs';

const output = resolve(process.env.ASSETGEN_BAKEOFF_DIR || join(homedir(), 'OpenBot/Shared/farm-evidence/EBR-85/bakeoff-pr-b'));
const onDirectory = join(evidenceDirectory, 'runs'), offDirectory = join(output, 'loop-off');
const ids = ['round-oak-a', 'barrel', 'hay-bale'];
const readJson = async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function timings(path) {
  try {
    const lines = (await readFile(path, 'utf8')).trim().split('\n').slice(1);
    return Object.fromEntries(lines.map((line) => { const fields = line.split('\t'); return [fields[0], { elapsedMs: Number(fields[2]), verifyElapsedMs: Number(fields[4]) }]; }));
  } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function load(directory, id, duration) {
  const base = join(directory, id);
  const [final, verification] = await Promise.all([readJson(join(base, 'final.json')), readJson(join(base, 'verify/report.json'))]);
  const valid = Number.isInteger(final?.best?.round) && final.best.round >= 1 && final.best.round <= 4 &&
    ['blockout', 'form', 'material', 'detail', 'lighting', 'optimise'].includes(final.best.stage);
  const stageReport = valid ? await readJson(join(base, `round-${final.best.round}`, `stage-${final.best.stage}`, 'report.json')) : null;
  return { final, verification, stageReport, ...duration };
}
const [onTimes, offTimes] = await Promise.all([timings(join(evidenceDirectory, 'logs/timings.tsv')), timings(join(output, 'logs/timings.tsv'))]);
const rows = await Promise.all(ids.map(async (id) => ({ id, on: await load(onDirectory, id, onTimes[id]), off: await load(offDirectory, id, offTimes[id]) })));
await mkdir(output, { recursive: true });
const result = renderLoopBakeoff({ rows, generatedAt: new Date().toISOString(), onDirectory, offDirectory });
await writeFile(join(output, 'RESULT.md'), result, { flag: 'wx' });
console.log(`Loop bake-off: ${join(output, 'RESULT.md')}`);
