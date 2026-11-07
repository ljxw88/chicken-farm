import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './config.mjs';
import { hashText, verifierSourceHash } from './bundle.mjs';
import { geometryHash } from './geometry.mjs';
import { createSignedFixtures } from './signed-fixtures.mjs';

export const A9_PHASES = ['daytime', 'morning', 'sunset'];
export const A9_REFERENCES = ['coop', 'fence', 'tread'];
export const calibrationPath = join(root, 'tools/assetgen/a9-calibration.json');
export const calibrationDigestPath = join(root, 'tools/assetgen/a9-calibration.sha256');

/** Construct floors from measurements, never from rounded display values. */
export function makeA9Calibration({ signedHashes, sourceHash, measurements }) {
  if (!/^[a-f0-9]{64}$/.test(sourceHash || '')) throw new Error('A9_CALIBRATION_INVALID: invalid measurement source hash');
  const hashes = {}, values = {};
  for (const name of A9_REFERENCES) {
    if (!/^[a-f0-9]{64}$/.test(signedHashes?.[name] || '')) throw new Error(`A9_CALIBRATION_INVALID: missing signed hash for ${name}`);
    hashes[name] = signedHashes[name];
    values[name] = {};
    for (const phase of A9_PHASES) {
      const value = measurements?.[name]?.[phase];
      if (!Number.isFinite(value) || value < 0) throw new Error(`A9_CALIBRATION_UNMEASURED: ${name}/${phase}`);
      values[name][phase] = value;
    }
  }
  const floors = Object.fromEntries(A9_PHASES.map((phase) => [phase, Math.min(...A9_REFERENCES.map((name) => values[name][phase]))]));
  return { version: 1, method: 'game pixel-pass A9, eight grass yaws; floor = minimum signed prop',
    sourceHash, signedHashes: hashes, measurements: values, floors };
}

/** The separate byte digest fails closed on accidental or forged table edits. */
export function parseA9Calibration(text, digest) {
  if (!/^[a-f0-9]{64}$/.test(String(digest).trim()) || hashText(text) !== String(digest).trim()) {
    throw new Error('A9_CALIBRATION_TAMPERED: checked-in table bytes do not match their digest');
  }
  let table;
  try { table = JSON.parse(text); } catch { throw new Error('A9_CALIBRATION_INVALID: invalid JSON'); }
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error('A9_CALIBRATION_INVALID: expected a table object');
  const expected = makeA9Calibration(table);
  if (JSON.stringify(table) !== JSON.stringify(expected)) throw new Error('A9_CALIBRATION_INVALID: values, floors or format differ from the measured table');
  return table;
}

export async function readA9Calibration() {
  return parseA9Calibration(await readFile(calibrationPath, 'utf8'), await readFile(calibrationDigestPath, 'utf8'));
}

export async function writeA9Calibration(table) {
  const text = `${JSON.stringify(makeA9Calibration(table), null, 2)}\n`;
  await writeFile(calibrationPath, text);
  await writeFile(calibrationDigestPath, `${hashText(text)}\n`);
}

/** Changes to signed meshes, the rendering code, render rules or Chromium remeasure all three props. */
export async function currentA9Inputs(server, rules, browserVersion) {
  const signed = await createSignedFixtures(server);
  const signedHashes = Object.fromEntries(A9_REFERENCES.map((name) => [name, geometryHash(signed.build(name))]));
  const sourceHash = hashText(`${await verifierSourceHash({ includeCalibration: false })}\0${JSON.stringify(rules.render)}\0${browserVersion}`);
  return { signed, signedHashes, sourceHash };
}

export async function measureA9Calibration(inputs, measure) {
  const measurements = {};
  for (const name of A9_REFERENCES) measurements[name] = await measure(name);
  return makeA9Calibration({ ...inputs, measurements });
}

export async function resolveA9Calibration({ stored, inputs, measure }) {
  const unchanged = stored.sourceHash === inputs.sourceHash && A9_REFERENCES.every((name) => stored.signedHashes[name] === inputs.signedHashes[name]);
  return unchanged ? { source: 'checked-in', ...stored } : { source: 'recomputed', ...await measureA9Calibration(inputs, measure) };
}

/** Only the tree class is exempt from numeric A9 floors; S4 remains unchanged. */
export function isTreeClass(spec) {
  return spec.category === 'flora' && (spec.assetClass === 'tree' || /(?:^|-)(?:tree|oak|pine|fir)(?:-|$)/i.test(spec.id));
}

export function a9FloorFailures(spec, phaseLighting, calibration) {
  if (isTreeClass(spec)) return [];
  const failures = [];
  for (const phase of A9_PHASES) {
    const measurement = phaseLighting[phase];
    const floor = calibration.floors[phase];
    if (!measurement || measurement.status === 'unmeasured' || !Number.isFinite(measurement.shadeLitRatio)) {
      failures.push({ code: 'A9_UNMEASURED', message: `${phase}: insufficient key/shade samples for a ratio estimate` });
    } else if (measurement.shadeLitRatio < floor) {
      failures.push({ code: 'A9_SHADE_RATIO', message: `${phase}: estimated shade/lit ${measurement.shadeLitRatio.toFixed(3)} is below calibrated ${floor.toFixed(3)}` });
    }
  }
  return failures;
}
