import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { validateSpec } from './config.mjs';

/** Read external QA fixtures without executing code or modifying the input directory. */
export async function loadFixtures(directory, selectedId) {
  const base = resolve(directory);
  const entries = await readdir(base, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) files.push({ name: entry.name, spec: join(base, entry.name, 'spec.json'), recipe: join(base, entry.name, 'recipe.json'), nested: true });
    else if (entry.isFile() && entry.name.endsWith('.fixture.json')) files.push({ name: entry.name.slice(0, -13), combined: join(base, entry.name) });
    else if (entry.isFile() && entry.name.endsWith('.recipe.json')) {
      const name = entry.name.slice(0, -12);
      files.push({ name, spec: join(base, `${name}.spec.json`), recipe: join(base, entry.name) });
    }
  }
  const fixtures = [];
  for (const file of files) {
    if (selectedId && file.name !== selectedId) continue;
    try {
      const combinedBytes = file.combined ? await readFile(file.combined, 'utf8') : null;
      const combined = combinedBytes ? JSON.parse(combinedBytes) : null;
      if (combined && Object.hasOwn(combined, 'signed')) {
        if (Object.keys(combined).length !== 1 || !['tree', 'coop', 'fence', 'tread'].includes(combined.signed)) {
          throw new Error('Signed fixture must contain only one of tree, coop, fence or tread');
        }
        fixtures.push({ name: file.name, signed: combined.signed });
        continue;
      }
      if (combined && Object.keys(combined).some((key) => !['spec', 'recipe'].includes(key))) {
        throw new Error('Combined fixture may contain only spec and recipe; report/signoff are separate files');
      }
      const specBytes = combinedBytes ?? await readFile(file.spec, 'utf8');
      const recipeBytes = combinedBytes ?? await readFile(file.recipe, 'utf8');
      const spec = validateSpec(combined?.spec ?? JSON.parse(specBytes));
      const recipe = combined?.recipe ?? JSON.parse(recipeBytes);
      let report = null, signoff = null;
      let reportBytes = null, signoffBytes = null;
      const reportPath = file.nested ? join(base, file.name, 'report.json') : join(base, `${file.name}.report.json`);
      const signoffPath = file.nested ? join(base, file.name, 'signoff.json') : join(base, `${file.name}.signoff.json`);
      const generatorPath = file.nested ? join(base, file.name, 'generator.jsonl') : join(base, `${file.name}.generator.jsonl`);
      const criticPath = file.nested ? join(base, file.name, 'critic.jsonl') : join(base, `${file.name}.critic.jsonl`);
      if (!report) try { reportBytes = await readFile(reportPath, 'utf8'); report = JSON.parse(reportBytes); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { signoffBytes = await readFile(signoffPath, 'utf8'); signoff = JSON.parse(signoffBytes); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      let generator = null, critic = null;
      try { generator = await readFile(generatorPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { critic = await readFile(criticPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (selectedId && spec.id !== selectedId && file.name !== selectedId) continue;
      fixtures.push({ name: file.name, spec, recipe, specBytes, recipeBytes, report, reportBytes, signoff, signoffBytes, receipts: { generator, critic },
        sourcePaths: { spec: file.combined || file.spec, recipe: file.combined || file.recipe,
          report: reportPath, signoff: signoffPath, generator: generatorPath, critic: criticPath } });
    } catch (error) {
      fixtures.push({ name: file.name, error: { code: 'G_GEOMETRY', message: `Invalid fixture ${basename(file.combined || file.recipe)}: ${String(error)}` } });
    }
  }
  if (selectedId && !fixtures.length) throw new Error(`Fixture not found: ${selectedId}`);
  if (!fixtures.length) throw new Error(`No fixtures found in ${base}`);
  return fixtures;
}
