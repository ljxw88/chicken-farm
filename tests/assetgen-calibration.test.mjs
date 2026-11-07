import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashText } from '../tools/assetgen/bundle.mjs';
import { a9FloorFailures, isTreeClass, makeA9Calibration, parseA9Calibration, resolveA9Calibration } from '../tools/assetgen/a9-calibration.mjs';

const signedHashes = { coop: 'a'.repeat(64), fence: 'b'.repeat(64), tread: 'c'.repeat(64) };
const sourceHash = 'd'.repeat(64);
const measurements = {
  coop: { daytime: 0.4, morning: 0.6, sunset: 0.7 },
  fence: { daytime: 0.3, morning: 0.8, sunset: 0.5 },
  tread: { daytime: 0.2, morning: 0.9, sunset: 0.9 },
};
const table = () => makeA9Calibration({ signedHashes, sourceHash, measurements });

test('A9 floors are exact per-phase minima of the three signed props', () => {
  assert.deepEqual(table().floors, { daytime: 0.2, morning: 0.6, sunset: 0.5 });
});

test('calibration fails closed on edited bytes and forged inconsistent floors', () => {
  const text = `${JSON.stringify(table(), null, 2)}\n`, digest = hashText(text);
  assert.deepEqual(parseA9Calibration(text, digest), table());
  assert.throws(() => parseA9Calibration(`${text} `, digest), /A9_CALIBRATION_TAMPERED/);
  const forged = table(); forged.floors.daytime = 0;
  const forgedText = `${JSON.stringify(forged, null, 2)}\n`;
  assert.throws(() => parseA9Calibration(forgedText, hashText(forgedText)), /A9_CALIBRATION_INVALID/);
});

test('changed signed geometry or measurement source remeasures all three references', async () => {
  const inputs = { signedHashes: { ...signedHashes }, sourceHash };
  let calls = [];
  const measure = async (name) => { calls.push(name); return measurements[name]; };
  assert.equal((await resolveA9Calibration({ stored: table(), inputs, measure })).source, 'checked-in');
  assert.deepEqual(calls, []);
  const changed = { ...inputs, signedHashes: { ...signedHashes, fence: 'e'.repeat(64) } };
  const refreshed = await resolveA9Calibration({ stored: table(), inputs: changed, measure });
  assert.equal(refreshed.source, 'recomputed');
  assert.deepEqual(calls, ['coop', 'fence', 'tread']);
  assert.equal(refreshed.signedHashes.fence, changed.signedHashes.fence);
  assert.deepEqual(refreshed.floors, table().floors);
  calls = [];
  const remeasured = await resolveA9Calibration({ stored: table(), inputs: { ...inputs, sourceHash: 'f'.repeat(64) },
    measure: async (name) => { calls.push(name); return { ...measurements[name], ...(name === 'fence' ? { morning: 0.1 } : {}) }; } });
  assert.deepEqual(calls, ['coop', 'fence', 'tread']);
  assert.equal(remeasured.floors.morning, 0.1);
  await assert.rejects(resolveA9Calibration({ stored: table(), inputs: changed,
    measure: async (name) => name === 'fence' ? { ...measurements[name], daytime: NaN } : measurements[name] }), /A9_CALIBRATION_UNMEASURED/);
});

test('A9 floor applies to props and bushes, but tree ratios are by eye', () => {
  const phases = { daytime: { status: 'pass', shadeLitRatio: 0.19 }, morning: { status: 'pass', shadeLitRatio: 0.6 },
    sunset: { status: 'pass', shadeLitRatio: 0.5 } };
  assert.deepEqual(a9FloorFailures({ id: 'barrel', category: 'prop' }, phases, table()).map((f) => f.code), ['A9_SHADE_RATIO']);
  assert.deepEqual(a9FloorFailures({ id: 'small-bush', category: 'flora', brief: 'A bush near a tree.' }, phases, table()).map((f) => f.code), ['A9_SHADE_RATIO']);
  assert.equal(isTreeClass({ id: 'round-oak', category: 'flora' }), true);
  assert.equal(isTreeClass({ id: 'pine', category: 'flora' }), true);
  assert.equal(isTreeClass({ id: 'tree-shaped-crate', category: 'prop' }), false);
  assert.deepEqual(a9FloorFailures({ id: 'round-oak', category: 'flora' }, phases, table()), []);
  assert.deepEqual(a9FloorFailures({ id: 'barrel', category: 'prop' }, { ...phases, daytime: { status: 'unmeasured' } }, table()).map((f) => f.code), ['A9_UNMEASURED']);
});
