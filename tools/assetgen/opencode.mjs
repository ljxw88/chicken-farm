import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './config.mjs';

export async function isolatedSessionDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-model-session-'));
  await writeFile(join(directory, 'opencode.json'), `${JSON.stringify({ $schema: 'https://opencode.ai/config.json',
    policies: [{ action: 'tool.use', resource: '*', effect: 'deny' }] }, null, 2)}\n`);
  return directory;
}

// An open stdin pipe makes `opencode run` wait for more input indefinitely.
// Explicitly close stdin and bound both runtime and output.
export function runOpenCode(args, { cwd = root, timeout = 180000, env = process.env } = {}) {
  const binary = process.env.OPENCODE_BIN || join(homedir(), '.opencode/bin/opencode');
  return new Promise((resolve, reject) => {
    const start = Date.now();
    // OpenCode uses PWD for location discovery; spawn's cwd alone does not
    // update the inherited environment, which would bypass the scratch policy.
    const child = spawn(binary, args, { cwd, env: { ...env, PWD: cwd }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => { stdout += data; if (stdout.length > 16 * 1024 * 1024) child.kill('SIGTERM'); });
    child.stderr.on('data', (data) => { stderr += data; if (stderr.length > 4 * 1024 * 1024) child.kill('SIGTERM'); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const result = { stdout, stderr, code, signal, durationMs: Date.now() - start };
      if (code !== 0 || timedOut) {
        const detail = stderr.trim() || stdout.trim();
        const error = new Error(`OpenCode ${timedOut ? 'timed out' : `exited ${code ?? signal}`}: ${detail.slice(0, 2000)}`);
        Object.assign(error, result);
        reject(error);
      } else resolve(result);
    });
  });
}

export function textEvents(stdout) {
  const events = stdout.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'unparsed', text: line }; }
  });
  return { events, text: events.filter((event) => event.type === 'text').map((event) => event.part?.text || event.text || '').join('\n') };
}

/** Read the actual model and usage from the session, not a guessed default. */
export async function sessionMetadata(sessionId, cwd) {
  if (!sessionId) return { modelId: null, usage: null };
  const [info, messages] = await Promise.all([
    runOpenCode(['api', 'get', `/api/session/${sessionId}`], { cwd, timeout: 30000 }),
    runOpenCode(['api', 'get', `/api/session/${sessionId}/message`], { cwd, timeout: 30000 }),
  ]);
  const data = JSON.parse(info.stdout).data;
  const records = JSON.parse(messages.stdout).data;
  const model = records?.find((record) => record.type === 'assistant' && record.model)?.model;
  return { modelId: model?.providerID && model?.id ? `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ''}` : null,
    usage: data?.tokens ? { tokens: data.tokens, cost: typeof data.cost === 'number' ? data.cost : null } : null };
}
