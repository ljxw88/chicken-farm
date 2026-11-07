import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceDirectory } from './config.mjs';
import { runOpenCode } from './opencode.mjs';

const scratch = process.argv[2];
if (!scratch) throw new Error('Usage: node tools/assetgen/summarize-img2threejs.mjs <scratch-directory>');
const out = join(evidenceDirectory, 'img2threejs');
await mkdir(out, { recursive: true });
const runs = [];
for (const id of ['barrel', 'hay-bale']) {
  const directory = join(scratch, id);
  const events = (await readFile(join(directory, 'agent.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return {}; }
  });
  const sessionId = events.find((event) => event.sessionID)?.sessionID;
  const response = await runOpenCode(['api', 'get', `/api/session/${sessionId}`], { cwd: directory, timeout: 30000 });
  const session = JSON.parse(response.stdout).data;
  const trace = events.filter((event) => event.type === 'tool_use').map((event) => ({
    tool: event.part?.tool, status: event.part?.state?.status, command: event.part?.tool === 'shell' ? event.part?.state?.input?.command : undefined,
    path: event.part?.state?.input?.path, error: event.part?.state?.error,
  }));
  const state = JSON.parse(await readFile(join(directory, '.img2threejs/state.json'), 'utf8'));
  const target = join(out, id);
  await mkdir(target, { recursive: true });
  await copyFile(join(directory, 'reference.png'), join(target, 'reference-from-recipe.png'));
  await copyFile(join(directory, '.img2threejs/state.json'), join(target, 'state.json'));
  for (const file of ['admission.json', 'probe.json', 'image-analysis.md']) {
    try { await copyFile(join(directory, file), join(target, file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(join(target, 'tool-trace.json'), `${JSON.stringify(trace, null, 2)}\n`);
  runs.push({ id, sessionId, outcome: session.outcome, created: session.time.created, ended: session.time.updated,
    tokens: session.tokens, reportedCostUSD: session.cost, currentStep: state.currentStep,
    checklistDone: state.checklist.filter((item) => item.status === 'done').map((item) => item.id),
    modelProduced: false, contactSheetProduced: false });
}
const summary = { tool: 'img2threejs', npmVersion: '0.2.0', skillVersion: '2.0.1',
  skillCommit: '0c0c49bc168e648dbaf9c8c080474de0b3a941b6', license: 'Apache-2.0',
  scratch, runs, oak: 'not started within time box',
  caveat: 'References were rendered from approach A; no independent B output or visual quality comparison was produced. Tool traces exclude upstream code and tool response bodies.' };
await writeFile(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
