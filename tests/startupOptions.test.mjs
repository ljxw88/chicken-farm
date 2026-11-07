import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createStartupPhaseController, parseSheepSeed, parseStartupOptions, parseVisualSeed } = await vite.ssrLoadModule('/src/startupOptions.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { VOID_COLOR } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

test('URL options accept every weather and day/night phase combination', () => {
  for (const weather of ['clear', 'cloudy', 'rain']) {
    for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
      assert.deepEqual(parseStartupOptions(`?weather=${weather}&phase=${phase}`), { weather, phase });
    }
  }
  assert.deepEqual(parseStartupOptions('?phase=night&weather=%63loudy&other=ignored'), {
    weather: 'cloudy', phase: 'night',
  });
});

test('missing and invalid URL options are ignored independently', () => {
  assert.deepEqual(parseStartupOptions(''), { weather: undefined, phase: undefined });
  assert.deepEqual(parseStartupOptions('?weather=storm&phase=night'), { weather: undefined, phase: 'night' });
  assert.deepEqual(parseStartupOptions('?weather=rain&phase=midnight'), { weather: 'rain', phase: undefined });
  assert.deepEqual(parseStartupOptions('?weather=Cloudy&phase='), { weather: undefined, phase: undefined });
});

test('the optional sheep seed accepts integer URLs without changing other startup options', () => {
  assert.equal(parseSheepSeed(''), undefined);
  assert.equal(parseSheepSeed('?seed=123'), 123);
  assert.equal(parseSheepSeed('?seed=-1'), 0xffffffff);
  assert.equal(parseSheepSeed('?seed=4294967296'), 0);
  assert.equal(parseVisualSeed('?seed=123'), 123);
  assert.equal(parseVisualSeed('?seed=-1'), undefined);
  assert.equal(parseVisualSeed('?seed=4294967296'), undefined);
  assert.equal(parseSheepSeed('?seed=0xeb730001'), undefined);
  assert.equal(parseVisualSeed('?seed=0xeb730001'), 0xeb730001);
  for (const seed of ['', '1.5', 'nan', '999999999999999999999']) {
    assert.equal(parseSheepSeed(`?seed=${seed}`), undefined);
  }
  assert.deepEqual(parseStartupOptions('?seed=123&weather=rain&phase=night'), { weather: 'rain', phase: 'night' });
});

test('a URL phase stays fixed until a valid console phase or cycle setter resumes it', () => {
  function fixture(phase) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VOID_COLOR);
    const character = new THREE.Group();
    const cycle = createDayNightCycle({ scene, character, windows: [] });
    return {
      scene,
      hemisphere: scene.getObjectByName('day-night-hemisphere'),
      controller: createStartupPhaseController(cycle, phase),
    };
  }

  const pinned = fixture('night');
  pinned.controller.update(18);
  assert.equal(pinned.hemisphere.color.getHex(), 0x2a2848);
  assert.equal(pinned.scene.background.getHex(), VOID_COLOR);
  assert.throws(() => pinned.controller.setDayNightCycleSeconds(0), RangeError);
  assert.throws(() => pinned.controller.setDayNightPhase('midnight'), RangeError);
  pinned.controller.update(18);
  assert.equal(pinned.hemisphere.color.getHex(), 0x2a2848);
  pinned.controller.setDayNightCycleSeconds(72);
  pinned.controller.update(18);
  assert.equal(pinned.hemisphere.color.getHex(), 0xe8d4c8);
  assert.equal(pinned.scene.background.getHex(), VOID_COLOR);

  const phaseSetter = fixture('night');
  phaseSetter.controller.setDayNightPhase('daytime');
  phaseSetter.controller.update(18);
  assert.equal(phaseSetter.hemisphere.color.getHex(), 0xe8dec6);

  const defaultCycle = fixture(undefined);
  defaultCycle.controller.update(18);
  assert.equal(defaultCycle.hemisphere.color.getHex(), 0xa8d4f0);
});
