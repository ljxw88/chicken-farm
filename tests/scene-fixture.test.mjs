import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { packSceneReference, unpackSceneReference } from '../tools/scene-data-dump.mjs';

test('the compact clean-main fixture reconstructs every original scene byte', async () => {
  const fixture = await readFile('tests/fixtures/scene-b41492e.json.gz');
  const json = unpackSceneReference(fixture);
  assert.equal(Buffer.byteLength(json), 6042729);
  assert.equal(createHash('sha256').update(json).digest('hex'), '88a6888483130b6b22db355260591d3036abcada07a646385db0b994c884242b');
  assert.equal(Object.keys(JSON.parse(json).snapshots).length, 15);
  assert.equal(unpackSceneReference(packSceneReference(json)), json);

  const corrupt = JSON.parse(gunzipSync(fixture));
  corrupt.data.snapshots.morning.objects[0] = corrupt.pools.objects.length;
  assert.throws(() => unpackSceneReference(gzipSync(JSON.stringify(corrupt))), /Invalid objects pool index/);
});
