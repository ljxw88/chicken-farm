import { randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { evidenceDirectory } from './config.mjs';
import { runOpenCode, sessionMetadata, textEvents } from './opencode.mjs';

const colors = [
  { name: 'RED', css: 'rgb(225,25,35)' },
  { name: 'GREEN', css: 'rgb(20,185,45)' },
  { name: 'BLUE', css: 'rgb(25,55,225)' },
];
// Blind multiple-choice probes in random order make a lucky single guess less
// likely to be mistaken for vision. The prompt never contains the answer.
for (let i = colors.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [colors[i], colors[j]] = [colors[j], colors[i]];
}
const directory = join(evidenceDirectory, 'vision-probe-ebr83-85');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const trials = [];
try {
  const page = await browser.newPage({ viewport: { width: 96, height: 96 }, deviceScaleFactor: 1 });
  for (const [index, color] of colors.entries()) {
    const image = join(directory, `probe-${index + 1}.png`);
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:${color.css}}div{width:12px;height:12px;background:#fff}</style><div></div>`);
    await page.screenshot({ path: image });
    const prompt = 'Look at the attached image. Which colour occupies most of it? Reply with exactly one word: RED, GREEN, or BLUE. Do not use tools.';
    let answer = '';
    let transcript = '';
    let error = null;
    let sessionId = null;
    let modelId = null;
    try {
      const result = await runOpenCode(['run', '--format', 'json', '--file', image, prompt], { timeout: 120000 });
      transcript = result.stdout;
      const { events, text } = textEvents(result.stdout);
      answer = text.trim().toUpperCase();
      sessionId = events.find((event) => event.sessionID)?.sessionID ?? null;
      try { modelId = (await sessionMetadata(sessionId)).modelId; } catch { /* reported as unknown */ }
      const errors = events.filter((event) => event.type === 'error');
      if (errors.length) error = JSON.stringify(errors);
    } catch (failure) {
      error = String(failure);
      transcript = `${failure.stdout || ''}\n${failure.stderr || ''}`;
    }
    await writeFile(join(directory, `probe-${index + 1}.jsonl`), transcript);
    trials.push({ image: `probe-${index + 1}.png`, expected: color.name, answer, correct: answer === color.name, error, sessionId, modelId });
  }
} finally {
  await browser.close();
}
const result = { imageReadingObserved: trials.every((trial) => trial.correct), trials,
  method: 'Three shuffled dominant-colour PNGs; separate OpenCode run sessions; exact one-word answers.',
  caveat: 'Colour recognition is a capability probe, not proof of reliable asset critique.' };
await writeFile(join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
