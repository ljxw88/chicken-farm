import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';
import { createServer } from 'vite';
import { outputDirectory } from './evidence-path.mjs';

// The winding fix does not redesign the folded ribbon. Quantify overlapping
// same-height triangles for a follow-up, without touching the visible layout.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const results = [];
  for (const name of ['farm-path-edge', 'farm-path-surface']) {
    const mesh = scene.getObjectByName(name);
    let overlappingPoints = 0;
    let example;
    for (let ix = 0; ix < 120; ix++) for (let iz = 0; iz < 120; iz++) {
      const x = -0.6 + (ix + 0.37) * 0.01;
      const z = -0.8 + (iz + 0.31) * 0.01;
      ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(mesh);
      if (hits.length > 1) {
        overlappingPoints++;
        example ??= { x, z, triangles: hits.map((hit) => hit.faceIndex) };
      }
    }
    results.push({ name, step: 0.01, overlappingPoints, example });
  }
  const output = outputDirectory('path-overlap-audit');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'path-overlap.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
} finally {
  await vite.close();
}
