import { resolve } from 'node:path';
import { test } from 'node:test';
import { compareCharacterParity } from '../../tools/character-parity.mjs';

test('scripted key, mouse and touch traces match main outside the visual effects', { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  const report = await compareCharacterParity({ candidateRoot: root,
    evidenceDir: process.env.EBR74_ROUTE_EVIDENCE_DIR && resolve(process.env.EBR74_ROUTE_EVIDENCE_DIR) });
  t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.frames}`).join(', ')}`);
  t.diagnostic(`Intended effect pixels: ${Object.entries(report.frameResults).map(([name, count]) => `${name}=${count}`).join(', ')}`);
  t.diagnostic(`Changed pixels with effects hidden: ${Object.entries(report.unaffectedFrameResults).map(([name, count]) => `${name}=${count}`).join(', ')}`);
});
