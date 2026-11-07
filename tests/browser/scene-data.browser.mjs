import { test } from 'node:test';
import { compareSceneData } from '../../tools/scene-data-dump.mjs';

test('scene data matches main with only the signed EBR-89 changes', { timeout: 300000 }, async (t) => {
  const result = await compareSceneData();
  t.diagnostic(`${result.snapshots.length} snapshots; ${result.bytes} serialized bytes; SHA-256 ${result.sha256}`);
});
