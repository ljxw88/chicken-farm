import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';
import { createServer } from 'vite';
import { evidenceDirectory, readBible } from './config.mjs';
import { inspectSignedGroup } from './geometry.mjs';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
  const { createPlacementVisual } = await vite.ssrLoadModule('/src/placement/createPlacementVisual.ts');
  const { createStoneStairs } = await vite.ssrLoadModule('/src/scene/createStoneStairs.ts');
  const { ASSET_PALETTE } = await vite.ssrLoadModule('/src/assets/palette.ts');
  const { rules } = await readBible();
  const farm = new THREE.Scene(); createFarmLayout(farm);
  const fixtures = [
    ['tree', farm.getObjectByName('farm-tree-2'), 'flora', 2.4],
    ['coop', farm.getObjectByName('farm-ramp-coop-1'), 'building', 2.4],
    ['fence', createPlacementVisual('fence'), 'prop', 0],
    ['tread', createStoneStairs(new THREE.Group(), 16, 2.4, 0).treads[0], 'terrain', 0],
  ];
  const report = { status: 'legacy-regression-only; strict golden acceptance unresolved',
    fixtures: Object.fromEntries(fixtures.map(([name, group, category, ground]) => [name, inspectSignedGroup(group, rules, ASSET_PALETTE, category, ground)])) };
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, 'signed-fixtures.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await vite.close(); }
