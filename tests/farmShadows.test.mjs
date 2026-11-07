import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createIsland } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createFarmDecorations } = await vite.ssrLoadModule('/src/render/farmDecorations.ts');
const { createFarmShadows } = await vite.ssrLoadModule('/src/scene/createFarmShadows.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
after(() => vite.close());

function fixture() {
  const scene = new THREE.Scene();
  const { stairs } = createIsland(scene);
  const character = createCharacter();
  character.position.y = 2.4;
  scene.add(character);
  const { windows, extraEmissives } = createFarmLayout(scene);
  createFarmDecorations(scene, 2.4);
  const farmShadows = createFarmShadows(scene);
  const cycle = createDayNightCycle({ scene, character, windows, extraEmissives,
    shadowSupported: stairs.supports, updateFarmShadows: farmShadows.update });
  return { scene, character, cycle };
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('tree, buildings, bridge, waterfall and chicken blobs follow the key and touch their bases', () => {
  const { scene, character, cycle } = fixture();
  const away = new THREE.Vector3(0.8, 0, -0.6);
  for (const [phase, offset] of [['morning', 0.48], ['daytime', 0.266], ['sunset', 0.48], ['night', 0.16]]) {
    cycle.setDayNightPhase(phase);
    scene.updateMatrixWorld(true);
    const playerShadow = character.getObjectByName('character-shadow');
    assert.equal(playerShadow.material.color.getHex(), 0x0a1409);
    const playerOffset = playerShadow.getWorldPosition(new THREE.Vector3())
      .sub(character.getWorldPosition(new THREE.Vector3())).setY(0);
    near(playerOffset.length(), offset);
    assert.ok(playerOffset.clone().normalize().dot(away) > 0.999999);
    for (let i = 1; i <= 4; i++) {
      const tree = scene.getObjectByName(`farm-tree-${i}`);
      const shadow = scene.getObjectByName(`farm-tree-shadow-${i}`);
      const center = shadow.getWorldPosition(new THREE.Vector3());
      const origin = tree.getWorldPosition(new THREE.Vector3());
      const delta = center.clone().sub(origin).setY(0);
      near(delta.length(), offset * 1.8);
      assert.ok(delta.normalize().dot(away) > 0.999999);
      const localBase = shadow.worldToLocal(origin);
      assert.ok(Math.hypot(localBase.x, localBase.y) <= 0.8 + 1e-6, `${phase}: tree ${i} shadow detached`);
      assert.equal(shadow.material.color.getHex(), 0x0a1409);
    }
    for (const [name, x, z, scale] of [['cottage', -3.4, -3.4, 2],
      ['ramp-coop-1', 0.15, -3.2, 1.8], ['ramp-coop-2', 1.35, -5, 1.8],
      ['wooden-bridge', 3.9, -1.95, 1.8], ['waterfall-lip', 3.6, 7.75, 1.8]]) {
      const shadow = scene.getObjectByName(`${name}-shadow`);
      assert.ok(shadow?.isMesh, `${name} ground shadow missing`);
      const delta = shadow.getWorldPosition(new THREE.Vector3()).sub(new THREE.Vector3(x, 0, z)).setY(0);
      near(delta.length(), offset * scale);
      assert.ok(delta.normalize().dot(away) > 0.999999);
      assert.equal(shadow.material.color.getHex(), 0x0a1409);
      if (name === 'wooden-bridge') {
        const base = shadow.worldToLocal(new THREE.Vector3(x, 2.4, z));
        assert.ok(Math.hypot(base.x, base.y) <= 1 + 1e-6, `${phase}: bridge shadow detached`);
      }
    }
    const chicken = scene.getObjectByName('farm-chicken');
    const chickenShadow = scene.getObjectByName('farm-chicken-shadow');
    assert.equal(chickenShadow.material.color.getHex(), 0x0a1409);
    const delta = chickenShadow.getWorldPosition(new THREE.Vector3())
      .sub(chicken.getWorldPosition(new THREE.Vector3())).setY(0);
    near(delta.length(), offset * 0.9);
    assert.ok(delta.normalize().dot(away) > 0.999999);
    const lip = scene.getObjectByName('farm-waterfall-lip');
    const fallShadow = scene.getObjectByName('waterfall-lip-shadow');
    const lipLocal = fallShadow.worldToLocal(lip.getWorldPosition(new THREE.Vector3()));
    assert.ok(Math.hypot(lipLocal.x, lipLocal.y) <= 1 + 1e-6, `${phase}: waterfall shadow detached from lip`);
  }
});

test('static shadows soften with weather, fade at night, and stay within the island', () => {
  const { scene, cycle } = fixture();
  cycle.setDayNightPhase('daytime');
  const tree = scene.getObjectByName('farm-tree-shadow-1');
  const building = scene.getObjectByName('cottage-shadow');
  const treeOrigin = scene.getObjectByName('farm-tree-1');
  const distance = () => tree.getWorldPosition(new THREE.Vector3()).sub(treeOrigin.getWorldPosition(new THREE.Vector3())).setY(0).length();
  scene.updateMatrixWorld(true);
  near(distance(), 0.266 * 1.8);
  near(tree.material.opacity, 0.16);
  near(building.material.opacity, 0.12);
  cycle.setShadowWeather(0, 1);
  scene.updateMatrixWorld(true);
  near(distance(), 0.266 * 1.8 * 0.5);
  near(tree.material.opacity, 0.08);
  near(building.material.opacity, 0.06);
  cycle.setShadowWeather(1, 0);
  scene.updateMatrixWorld(true);
  near(distance(), 0.266 * 1.8 * 0.49);
  near(tree.material.opacity, 0.032);
  cycle.setShadowWeather(0, 0);
  cycle.setDayNightPhase('night');
  near(tree.material.opacity, 0.16 * 0.09 / 0.22);

  for (const [rain, cloudy] of [[0, 0], [0, 1], [1, 0]]) {
    cycle.setShadowWeather(rain, cloudy);
    for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
      cycle.setDayNightPhase(phase);
      scene.updateMatrixWorld(true);
      for (const name of ['farm-tree-shadow-1', 'farm-tree-shadow-2', 'farm-tree-shadow-3', 'farm-tree-shadow-4',
        'cottage-shadow', 'ramp-coop-1-shadow', 'ramp-coop-2-shadow', 'wooden-bridge-shadow', 'waterfall-lip-shadow']) {
        const shadow = scene.getObjectByName(name);
        const vertices = shadow.geometry.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) {
          const point = shadow.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i));
          assert.ok(Math.abs(point.x) <= 8 + 1e-6 && Math.abs(point.z) <= 8 + 1e-6, `${name} extends over the void in ${phase}`);
        }
      }
      const lip = scene.getObjectByName('farm-waterfall-lip');
      const shadow = scene.getObjectByName('waterfall-lip-shadow');
      const lipLocal = shadow.worldToLocal(lip.getWorldPosition(new THREE.Vector3()));
      assert.ok(Math.hypot(lipLocal.x, lipLocal.y) <= 1 + 1e-6, `${phase}: waterfall shadow detached in weather`);
    }
  }
});
