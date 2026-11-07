import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { packSceneReference, unpackSceneReference } from '../tools/scene-data-dump.mjs';

test('the compact clean-main fixture reconstructs every original scene byte', async () => {
  const fixture = await readFile('tests/fixtures/scene-8dd79b8.json.gz');
  const json = unpackSceneReference(fixture);
  assert.equal(Buffer.byteLength(json), 6667777);
  assert.equal(createHash('sha256').update(json).digest('hex'), 'fc88b33e0895481f4a75302790740f63e7bf9e7d5548a3332cfe1b2950910f9e');
  const { snapshots } = JSON.parse(json);
  assert.equal(Object.keys(snapshots).length, 15);
  for (const snapshot of Object.values(snapshots)) {
    assert.deepEqual([snapshot.features.hives, snapshot.features.flowerPatches, snapshot.features.flowerHeads], [2, 4, 28]);
  }
  assert.equal(snapshots['plot-valid'].features.plotSeedlings, 8);
  assert.equal(snapshots['plot-placed'].features.plotSeedlings, 16);
  assert.equal(unpackSceneReference(packSceneReference(json)), json);

  const corrupt = JSON.parse(gunzipSync(fixture));
  corrupt.data.snapshots.morning.objects[0] = corrupt.pools.objects.length;
  assert.throws(() => unpackSceneReference(gzipSync(JSON.stringify(corrupt))), /Invalid objects pool index/);
});
