import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceDirectory, readSpec, root } from './config.mjs';
import { runOpenCode, sessionMetadata } from './opencode.mjs';

const id = process.argv[2];
if (!['barrel', 'hay-bale', 'round-oak'].includes(id)) throw new Error('Usage: node tools/assetgen/bakeoff-b.mjs <barrel|hay-bale|round-oak>');
const scratch = '/tmp/assetgen-img2threejs.REij4K';
const offline = '/tmp/assetgen-offline-bin.I2tSoG/offline';
const directory = join(scratch, 'ebr83-85', id);
const out = join(evidenceDirectory, 'ebr83-85', 'img2threejs', id);
await mkdir(join(scratch, 'ebr83-85'), { recursive: true });
await mkdir(directory); // Refuse to overwrite another attempt.
await mkdir(out, { recursive: true });
const { spec, path: specPath } = await readSpec(id);
const ref = join(evidenceDirectory, 'ebr83-85', 'historical', id, 'b-reference-transparent.png');
await copyFile(ref, join(directory, 'reference.png'));
await copyFile(specPath, join(directory, 'spec.json'));
await copyFile(join(root, 'docs/asset-style-bible.md'), join(directory, 'style-bible.md'));
await copyFile(join(root, 'docs/asset-lookdev-brief.md'), join(directory, 'lookdev-brief.md'));
try { await cp(join(root, 'src'), join(directory, 'game-src'), { recursive: true, errorOnExist: true, force: false }); }
catch (error) { if (error.code !== 'ERR_FS_CP_EEXIST') throw error; }
for (const [target, link] of [[join(root, 'node_modules'), join(directory, 'node_modules')],
  [join(scratch, 'home/.config/opencode/skills/img2threejs/forge'), join(directory, 'forge')]]) {
  try { await symlink(target, link); } catch (error) { if (error.code !== 'EEXIST') throw error; }
}
const prompt = `Use the installed img2threejs skill for the ${id} in reference.png, following its mandatory staged state, deterministic gates and visual review. spec.json, style-bible.md and lookdev-brief.md contain the exact game brief. Reference is a local render of an older approach-A candidate: it is not independent, and must be disclosed. Rebuild as a chunky low-poly Three.js asset under the merged EBR-80 game lights copied in game-src. No image/model downloads, textures, projection, neural meshes, paid keys, network, new lights or shadow maps. Keep every output inside this scratch folder; do not edit the game worktree, push, commit, or open a PR. All shell commands must begin ${offline}, which confines execution to an offline network namespace with the scratch directory writable. The forge symlink is the installed skill. Preserve honest stage/gate state: stop on a failed gate, do not label a partial model a pass. Produce a 1280x720 contact sheet and in-scene scale composite if the skill reaches rendering. The limit is 30 minutes for this asset; report blockers and exact output paths.`;
await writeFile(join(directory, 'task.txt'), `${prompt}\n`);
const binary = process.env.OPENCODE_BIN || '/home/michael/.opencode/bin/opencode';
const args = ['run', '--format', 'json', '--model', 'opencode/crouton-alpha-free', '--file', join(directory, 'reference.png'), prompt];
const start = Date.now();
const child = spawn(binary, args, { cwd: directory, env: { ...process.env, PWD: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', sessionId = null, timedOut = false, buffer = '', interruptPromise = null;
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', (data) => {
  stdout += data; buffer += data;
  const lines = buffer.split('\n'); buffer = lines.pop();
  for (const line of lines) try { sessionId ??= JSON.parse(line).sessionID ?? null; } catch { /* incomplete line */ }
});
child.stderr.on('data', (data) => { stderr += data; });
const timer = setTimeout(() => {
  timedOut = true;
  if (sessionId) interruptPromise = runOpenCode(['api', 'post', `/api/session/${sessionId}/interrupt`], { cwd: directory, timeout: 15000 }).catch(() => null);
  child.kill('SIGTERM');
}, (30 * 60 - 10) * 1000); // Leave time to interrupt the shared server before the cap.
const result = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
clearTimeout(timer);
if (interruptPromise) await interruptPromise;
await writeFile(join(directory, 'agent.jsonl'), stdout);
await writeFile(join(directory, 'agent.stderr'), stderr);
const events = stdout.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
const errors = events.filter((event) => event.type === 'error').map((event) => ({ type: event.error?.type, message: event.error?.message,
  status: event.error?.status, retryAfterMs: event.error?.retryAfterMs }));
let metadata = { modelId: null, usage: null };
if (sessionId) try { metadata = await sessionMetadata(sessionId, directory); } catch { /* unavailable */ }
let artifact = null;
try { artifact = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')); } catch { /* no completed model */ }
const record = { id, status: artifact ? 'unverified-external-output' : 'BLOCKED', reason: timedOut ? '30-minute asset timebox' : errors[0]?.message || 'No completed external model',
  code: result.code, signal: result.signal, timedOut, sessionId, ...metadata, wallTimeMs: Date.now() - start,
  errors, reference: 'A-derived historical candidate rendered under EBR-80; not an independent reference',
  referenceSha256: createHash('sha256').update(await readFile(join(directory, 'reference.png'))).digest('hex'),
  modelProduced: !!artifact, contactSheetProduced: false, quality: 'not measured', paletteFit: 'not measured',
  note: 'No third-party code or raw skill transcript is copied into the repository.' };
await writeFile(join(out, 'attempt.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(record, null, 2));
if (!artifact) process.exitCode = 1;
