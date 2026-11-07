import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseJson } from './generator.mjs';
import { textEvents } from './opencode.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;

/** A prior critique is feedback only; it can never grant a current pass. */
export async function loadPriorReview(reportPath, spec, specBytes, bibleText) {
  const path = resolve(reportPath), directory = dirname(path);
  const [reportBytes, recipeBytes, generatorReceipt, criticReceipt] = await Promise.all([
    readFile(path, 'utf8'), readFile(join(directory, 'recipe.json'), 'utf8'),
    readFile(join(directory, 'generator.jsonl'), 'utf8'), readFile(join(directory, 'critic.jsonl'), 'utf8'),
  ]);
  const report = JSON.parse(reportBytes), recipe = JSON.parse(recipeBytes);
  if (report.id !== spec.id || recipe.id !== spec.id || report.specHash !== hash(specBytes) ||
      report.bibleHash !== hash(bibleText) || report.recipeHash !== hash(recipeBytes)) throw new Error('Prior review does not match the current spec, bible and recipe');
  if (!report.generatorSession || !report.criticSession || report.generatorSession === report.criticSession || !report.criticModelId ||
      report.critiqueStatus !== 'independent visual critique recorded' || report.critique?.imageReviewed !== true ||
      !Array.isArray(report.critique?.fixes) || !report.critique.fixes.length || !report.critique.fixes.every((item) => typeof item === 'string') ||
      !Array.isArray(report.critique?.blockers) || !report.critique.blockers.every((item) => typeof item === 'string')) {
    throw new Error('Prior review needs independent image critique with concrete fixes');
  }
  if (hash(generatorReceipt) !== report.generatorReceiptHash || hash(criticReceipt) !== report.criticReceiptHash) throw new Error('Prior review receipts do not match their hashes');
  const generator = textEvents(generatorReceipt), critic = textEvents(criticReceipt);
  const sessionsMatch = (events, id) => { const ids = new Set(events.map((event) => event.sessionID).filter(Boolean)); return ids.size === 1 && ids.has(id); };
  if (!sessionsMatch(generator.events, report.generatorSession) || !sessionsMatch(critic.events, report.criticSession) ||
      JSON.stringify(stable(parseJson(critic.text))) !== JSON.stringify(stable(report.critique))) throw new Error('Prior review receipts do not substantiate the recorded critique');
  return { recipe, feedback: { action: report.critique.action, failures: report.blockers, critique: report.critique,
    instruction: 'A human requested a recipe-only trial of these specific critic fixes. Do not change the spec or disregard the prior verdict. Revise the named parts, preserve all hard checks and require a fresh independent critic. For a genuinely narrow hoop or band, use the band exception only when appropriate; it must still be at least 0.1 thick and visible. If the fixes cannot fit the existing spec, request input.' },
    provenance: { reportPath: path, reportHash: hash(reportBytes), recipeHash: hash(recipeBytes), specHash: report.specHash,
      bibleHash: report.bibleHash, generatorReceiptHash: report.generatorReceiptHash, criticReceiptHash: report.criticReceiptHash,
      generatorSession: report.generatorSession, criticSession: report.criticSession, criticModelId: report.criticModelId,
      priorCriticAction: report.critique.action } };
}
