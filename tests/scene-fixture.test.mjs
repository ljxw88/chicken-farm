import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { packSceneReference, unpackSceneReference } from '../tools/scene-data-dump.mjs';
import { createEbr89SceneFixture } from '../tools/ebr89-scene-fixture.mjs';

test('the compact clean-main fixture reconstructs every original scene byte', async () => {
  const fixture = await readFile('tests/fixtures/scene-a75e8db.json.gz');
  const json = unpackSceneReference(fixture);
  assert.equal(Buffer.byteLength(json), 8883483);
  assert.equal(createHash('sha256').update(json).digest('hex'), '36a011d8504058c3e62bc83608a08cc7bcee71dbb34ee3942cd814f1711ee80d');
  const { snapshots } = JSON.parse(json);
  assert.equal(Object.keys(snapshots).length, 20);
  for (const snapshot of Object.values(snapshots)) {
    assert.deepEqual([snapshot.features.hives, snapshot.features.flowerPatches, snapshot.features.flowerHeads], [2, 4, 28]);
  }
  assert.equal(snapshots['plot-valid'].features.plotSeedlings, 8);
  assert.equal(snapshots['plot-placed'].features.plotSeedlings, 16);
  for (const name of ['snow-transition', 'snow', 'night-effects-snow', 'snow-rain-crossfade']) {
    assert.equal(snapshots[name].features.snowFlakes, 160, name);
    assert.equal(snapshots[name].features.snowVisible, true, name);
  }
  assert.equal(snapshots['snow-transition'].weather.snowProgress, 0.5);
  assert.equal(snapshots.snow.features.snowOpacity, 0.8);
  assert.ok(Math.abs(snapshots['night-effects-snow'].features.snowOpacity - 0.56) < 1e-12);
  assert.deepEqual([snapshots['snow-rain-crossfade'].weather.rainAmount, snapshots['snow-rain-crossfade'].weather.snowAmount], [0.5, 0.5]);
  assert.equal(snapshots['snow-return-clear'].features.snowVisible, false);
  assert.equal(unpackSceneReference(packSceneReference(json)), json);

  const corrupt = JSON.parse(gunzipSync(fixture));
  corrupt.data.snapshots.morning.objects[0] = corrupt.pools.objects.length;
  assert.throws(() => unpackSceneReference(gzipSync(JSON.stringify(corrupt))), /Invalid objects pool index/);
});

test('the EBR-89 fixture is derived from main with only the signed detail and sunset changes', async () => {
  const original = JSON.parse(unpackSceneReference(await readFile('tests/fixtures/scene-a75e8db.json.gz')));
  const actual = unpackSceneReference(await readFile('tests/fixtures/scene-ebr89.json.gz'));
  const derived = JSON.stringify(createEbr89SceneFixture(original));
  assert.equal(actual, derived);
  assert.equal(Buffer.byteLength(actual), 8952665);
  assert.equal(createHash('sha256').update(actual).digest('hex'), '1d6150783e457af98a1e2690ac64d7b6f29508612afcf60f72c57b0d2ac983d5');
  const { snapshots } = JSON.parse(actual);
  for (const snapshot of Object.values(snapshots)) {
    assert.deepEqual(snapshot.objects.filter(({ name }) => name.startsWith('character-comb') || name.startsWith('character-wing-'))
      .map(({ name }) => name), ['character-comb', 'character-comb-bump-1', 'character-comb-bump-2',
      'character-comb-bump-3', 'character-wing-left', 'character-wing-right']);
  }
  assert.equal(snapshots.sunset.fog.density, 0.0129);
  assert.equal(snapshots.sunset.objects.find(({ name }) => name === 'day-night-directional').light.intensity, 1.38);
  assert.equal(unpackSceneReference(packSceneReference(actual)), actual);
});
