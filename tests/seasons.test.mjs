import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { ART_SLOTS, DEFAULT_SEASON, FARM_PALETTE, SEASON_SLOTS } = await vite.ssrLoadModule('/src/content/slots.ts');
const { STARTUP_OPTIONS } = await vite.ssrLoadModule('/src/content/startup.ts');
const { parseSeason, parseStartupOptions } = await vite.ssrLoadModule('/src/startupOptions.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createGardenPlot } = await vite.ssrLoadModule('/src/scene/gardenDressing/createGardenPlot.ts');
const { createFarmHud } = await vite.ssrLoadModule('/src/ui/createFarmHud.ts');
after(() => vite.close());

test('season crown slots preserve spring and contain the approved autumn colours', () => {
  assert.equal(DEFAULT_SEASON, 'spring');
  assert.equal(ART_SLOTS.palette.season, SEASON_SLOTS);
  assert.deepEqual(SEASON_SLOTS, {
    spring: { crown: { mid: 0x5fa846, light: 0x7cbc5a, dark: 0x3d7a3a } },
    autumn: { crown: { mid: 0xcf9a38, light: 0xe2b94e, dark: 0xa8722c } },
  });
  assert.deepEqual(SEASON_SLOTS.spring.crown, {
    mid: FARM_PALETTE.treeFoliage, light: FARM_PALETTE.treeFoliageLight, dark: FARM_PALETTE.treeFoliageDark,
  });
  for (const color of Object.values(SEASON_SLOTS.autumn.crown)) {
    for (const shift of [16, 8, 0]) assert.ok(((color >> shift) & 0xff) < 250);
  }
});

test('the season query accepts only autumn and leaves other startup options alone', () => {
  assert.equal(STARTUP_OPTIONS.seasonKey, 'season');
  for (const search of ['', '?season=spring', '?season=', '?season=summer', '?season=AUTUMN', '?season=toString']) {
    assert.equal(parseSeason(search), 'spring', search);
  }
  assert.equal(parseSeason('?phase=sunset&season=autumn&weather=rain'), 'autumn');
  assert.equal(parseSeason('?season=%61utumn'), 'autumn');
  assert.deepEqual(parseStartupOptions('?phase=sunset&season=autumn&weather=rain'), { phase: 'sunset', weather: 'rain' });
});

test('only crown materials change: four trees, geometry, shadows and other farm colours stay fixed', () => {
  const spring = new THREE.Scene();
  const autumn = new THREE.Scene();
  const defaultLayout = createFarmLayout(spring);
  const autumnLayout = createFarmLayout(autumn, undefined, SEASON_SLOTS.autumn.crown);
  assert.deepEqual(autumnLayout.obstacles, defaultLayout.obstacles);
  assert.deepEqual(autumnLayout.splashExclusions, defaultLayout.splashExclusions);

  const crowns = new Set();
  for (let index = 1; index <= 4; index++) {
    const before = spring.getObjectByName(`farm-tree-${index}`);
    const after = autumn.getObjectByName(`farm-tree-${index}`);
    assert.ok(before && after);
    const beforeCrowns = before.children.filter((child) => child.isMesh && !child.name);
    const afterCrowns = after.children.filter((child) => child.isMesh && !child.name);
    assert.equal(beforeCrowns.length, 4);
    assert.equal(afterCrowns.length, 4);
    assert.deepEqual(beforeCrowns.map((child) => child.material.color.getHex()), [0x5fa846, 0x7cbc5a, 0x3d7a3a, 0x7cbc5a]);
    assert.deepEqual(afterCrowns.map((child) => child.material.color.getHex()), [0xcf9a38, 0xe2b94e, 0xa8722c, 0xe2b94e]);
    afterCrowns.forEach((child) => crowns.add(child));
    assert.equal(after.getObjectByName(`farm-tree-trunk-${index}`).material.color.getHex(), 0x6b4a2e);
    assert.equal(after.getObjectByName(`farm-tree-shadow-${index}`).material.color.getHex(), 0x0a1409);
  }

  const flatten = (scene) => { const result = []; scene.traverse((object) => result.push(object)); return result; };
  const before = flatten(spring), after = flatten(autumn);
  assert.equal(after.length, before.length);
  const geometryHash = (geometry) => {
    if (!geometry) return null;
    const hash = createHash('sha256');
    for (const key of Object.keys(geometry.attributes).sort()) {
      const array = geometry.attributes[key].array;
      hash.update(key).update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    }
    if (geometry.index) {
      const array = geometry.index.array;
      hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    }
    return hash.digest('hex');
  };
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = after[i];
    assert.deepEqual([b.name, b.type, b.position.toArray(), b.quaternion.toArray(), b.scale.toArray()],
      [a.name, a.type, a.position.toArray(), a.quaternion.toArray(), a.scale.toArray()]);
    assert.equal(geometryHash(b.geometry), geometryHash(a.geometry), `geometry ${b.name}`);
    if (a.material && !crowns.has(b)) {
      const colors = (material) => (Array.isArray(material) ? material : [material]).map((value) => value.color?.getHex());
      assert.deepEqual(colors(b.material), colors(a.material), `non-crown material ${b.name}`);
    }
  }
  assert.equal(autumn.getObjectByName('farm-grass-tufts').material.color.getHex(), 0x3d7a3a);
  const plot = createGardenPlot();
  assert.deepEqual(new Set(plot.children.filter((child) => child.name === 'garden-plot-seedling')
    .map((child) => child.material.color.getHex())), new Set([0x5fa846, 0x7cbc5a]));
});

test('the HTML biome label follows the initial season without adding a control', () => {
  for (const [season, expected] of [['spring', 'Spring'], ['autumn', 'Autumn']]) {
    const dom = new JSDOM('<div id="hud"></div>');
    const root = dom.window.document.querySelector('#hud');
    const hud = createFarmHud({ root, initialPhase: 'daytime', season });
    const label = root.querySelector('[data-season]');
    if (season === 'autumn') {
      assert.equal(label.textContent, expected);
      assert.equal(label.previousElementSibling.getAttribute('aria-hidden'), 'true');
      assert.equal(label.previousElementSibling.style.visibility, 'hidden');
      assert.doesNotMatch(root.textContent, /Spring/);
    } else {
      assert.equal(label, null);
      assert.match(root.textContent, /Spring/);
    }
    assert.equal(root.querySelectorAll('button').length, 0);
    hud.setPhase('night');
    assert.equal(root.querySelector('[data-phase]').textContent, 'Night');
    hud.dispose();
    dom.window.close();
  }
});
