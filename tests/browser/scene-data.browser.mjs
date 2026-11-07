import { test } from 'node:test';
import { compareSceneData } from '../../tools/scene-data-dump.mjs';

test('scene data matches the independently captured main scene byte for byte', { timeout: 300000 }, async (t) => {
  const result = await compareSceneData();
  t.diagnostic(`${result.snapshots.length} snapshots; ${result.bytes} serialized bytes; SHA-256 ${result.sha256}`);
});
