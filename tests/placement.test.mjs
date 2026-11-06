import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createGrid, TILE_SIZE, footprintCells, intersectsFootprint, fenceCollision } =
  await vite.ssrLoadModule('/src/placement/grid.ts');
const { createPlacement } = await vite.ssrLoadModule('/src/placement/createPlacement.ts');
const { createCharacterControls } = await vite.ssrLoadModule('/src/character/createCharacterControls.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { moveWithFarmCollisions } = await vite.ssrLoadModule('/src/scene/farmCollisions.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
after(() => vite.close());

function fixture(t, { debugGrid = false, getBlockers, farm = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><canvas id="scene"></canvas></body>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  const canvas = document.querySelector('#scene');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 2.4;
  scene.add(ground);
  const character = new THREE.Group();
  character.position.y = 2.4;
  scene.add(character);
  const { camera, follow, resize } = createIsometricCamera();
  resize(800, 600);
  follow(character.position);
  const obstacles = farm ? createFarmLayout(scene).obstacles :
    [{ kind: 'box', name: 'existing', minX: -5, maxX: -4, minZ: 3, maxZ: 4 }];
  const placement = createPlacement({
    scene, camera, canvas, ground, groundSize: 16, groundHeight: 2.4, character, characterRadius: 0.4,
    obstacles, getBlockers, debugGrid,
  });
  const controls = createCharacterControls({
    character, camera, canvas, ground, groundSize: 16, groundHeight: 2.4, characterRadius: 0.4,
    obstacles, onPointerDown: placement.handlePointerDown,
  });
  t.after(() => { controls.dispose(); placement.dispose(); dom.window.close(); });

  function pointer(type, x, z, pointerType = 'mouse') {
    camera.updateMatrixWorld();
    const projected = new THREE.Vector3(x, 2.4, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    const event = new dom.window.MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0,
      clientX: rect.left + (projected.x + 1) * rect.width / 2,
      clientY: rect.top + (1 - projected.y) * rect.height / 2,
    });
    Object.defineProperties(event, { isPrimary: { value: true }, pointerType: { value: pointerType } });
    canvas.dispatchEvent(event);
    return event;
  }
  function key(code, options = {}) {
    const event = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, code, ...options });
    window.dispatchEvent(event);
    return event;
  }
  const status = () => document.querySelector('.placement-status').textContent;
  const layer = scene.getObjectByName('placement-layer');
  const count = (name) => layer.children.filter((child) => child.name === name).length;
  return { scene, character, controls, placement, obstacles, layer, pointer, key, status, count };
}

test('complete tiles are centred on the island and plots rotate between two occupied cells', () => {
  const grid = createGrid(16);
  assert.equal(TILE_SIZE, 1.5); // Existing fence including its posts is 1.47 units wide.
  assert.deepEqual([grid.count, grid.min, grid.max], [10, -7.5, 7.5]);
  assert.deepEqual(grid.cellAt(-7.49, -7.49), { column: 0, row: 0 });
  assert.deepEqual(grid.cellAt(-0.01, 0.01), { column: 4, row: 5 });
  assert.deepEqual(grid.cellAt(7.8, -7.8), { column: 10, row: -1 });
  const cell = { column: 2, row: 4 };
  const horizontal = grid.footprint(cell, 'plot', 0);
  const vertical = grid.footprint(cell, 'plot', 1);
  assert.deepEqual([horizontal.columns, horizontal.rows, horizontal.maxX - horizontal.minX, horizontal.maxZ - horizontal.minZ], [2, 1, 3, 1.5]);
  assert.deepEqual([vertical.columns, vertical.rows, vertical.maxX - vertical.minX, vertical.maxZ - vertical.minZ], [1, 2, 1.5, 3]);
  assert.deepEqual(footprintCells(horizontal), [{ column: 2, row: 4 }, { column: 3, row: 4 }]);
  assert.deepEqual(footprintCells(vertical), [{ column: 2, row: 4 }, { column: 2, row: 5 }]);
  assert.equal(grid.contains(grid.footprint({ column: 9, row: 9 }, 'fence', 0)), true);
  assert.equal(grid.contains(grid.footprint({ column: 9, row: 9 }, 'plot', 0)), false);
  assert.equal(grid.contains(grid.footprint({ column: 10, row: 0 }, 'fence', 0)), false);
});

test('whole tiles reserve space around boxes and circles; fences collide only at their narrow physical footprint', () => {
  const area = createGrid(16).footprint({ column: 5, row: 5 }, 'fence', 0);
  assert.equal(intersectsFootprint(area, { kind: 'box', name: 'inside', minX: 1.4, maxX: 2, minZ: 0, maxZ: 1 }), true);
  assert.equal(intersectsFootprint(area, { kind: 'box', name: 'touching', minX: 1.5, maxX: 2, minZ: 0, maxZ: 1 }), false);
  assert.equal(intersectsFootprint(area, { kind: 'circle', name: 'corner', x: -0.2, z: -0.2, radius: 0.3 }), true);
  assert.equal(intersectsFootprint(area, { kind: 'circle', name: 'away', x: -0.3, z: -0.3, radius: 0.3 }), false);
  const straight = fenceCollision(area, 0, 'straight');
  const rotated = fenceCollision(area, 1, 'rotated');
  assert.ok(Math.abs((straight.maxX - straight.minX) - 1.47) < 1e-10);
  assert.ok(Math.abs((straight.maxZ - straight.minZ) - 0.26) < 1e-10);
  assert.ok(Math.abs((rotated.maxX - rotated.minX) - 0.26) < 1e-10);
  assert.ok(Math.abs((rotated.maxZ - rotated.minZ) - 1.47) < 1e-10);
});

test('fence and plot ghosts reject partial overlap with each wall, coop body and ramp in every rotation', (t) => {
  const f = fixture(t, { farm: true });
  const grid = createGrid(16);
  const original = f.obstacles.slice();
  f.scene.updateMatrixWorld(true);
  for (const [name, meshName] of [
    ['cottage', 'cottage-walls'],
    ['ramp-coop-1-body', 'ramp-coop-1-body'], ['ramp-coop-1-ramp', 'ramp-coop-1-ramp'],
    ['ramp-coop-2-body', 'ramp-coop-2-body'], ['ramp-coop-2-ramp', 'ramp-coop-2-ramp'],
  ]) {
    const mesh = f.scene.getObjectByName(meshName);
    const box = new THREE.Box3().setFromObject(mesh);
    const obstacle = original.find((entry) => entry.name === name);
    assert.ok(obstacle, name);
    // Isolate each real obstacle so another building cannot mask a missing
    // wall/body/ramp rejection. Rendered bounds are the independent oracle.
    f.obstacles.splice(0, f.obstacles.length, obstacle);
    for (const kind of ['fence', 'plot']) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const candidates = [];
        for (let column = 0; column < grid.count; column++) for (let row = 0; row < grid.count; row++) {
          const area = grid.footprint({ column, row }, kind, rotation);
          const overlaps = area.minX < box.max.x && area.maxX > box.min.x && area.minZ < box.max.z && area.maxZ > box.min.z;
          const centerOutside = area.centerX < box.min.x || area.centerX > box.max.x || area.centerZ < box.min.z || area.centerZ > box.max.z;
          if (grid.contains(area) && overlaps && centerOutside) candidates.push(area);
        }
        assert.ok(candidates.length, `no partial-overlap ${kind} candidate for ${name}`);
        const area = candidates[0];
        const x = grid.min + (area.cell.column + 0.5) * TILE_SIZE;
        const z = grid.min + (area.cell.row + 0.5) * TILE_SIZE;
        f.key(kind === 'fence' ? 'KeyF' : 'KeyP');
        for (let turn = 0; turn < rotation; turn++) f.key('KeyR');
        f.pointer('pointermove', x, z);
        assert.match(f.status(), /Blocked by a farm object/, `${name} ${kind} rotation ${rotation}`);
        assert.equal(f.layer.getObjectByName('placement-wash').material.color.getHex(), 0xc45a3a);
        assert.equal(document.querySelector('[data-confirm]').disabled, true);
        f.pointer('pointerdown', x, z);
        f.key('Enter');
        assert.equal(f.count(`placed-${kind}`), 0);
      }
    }
  }
  f.obstacles.splice(0, f.obstacles.length, ...original);
  f.key('KeyF');
  f.pointer('pointermove', -6.75, -6.75);
  assert.match(f.status(), /Ready to place/);
  f.pointer('pointerdown', -6.75, -6.75);
  assert.equal(f.count('placed-fence'), 1);
  f.key('KeyZ');
  assert.deepEqual(f.obstacles, original);
});

test('fence and plot ghosts reject partial water and walkable bridge tiles in every rotation', (t) => {
  const f = fixture(t, { farm: true });
  const original = f.obstacles.slice();
  const water = original.filter((entry) => entry.name.startsWith('stream-'));
  const bridge = original.find((entry) => entry.name === 'wooden-bridge');
  assert.ok(water.length);
  assert.equal(bridge.blocksWalking, false);
  for (const [name, zones] of [['water', water], ['bridge', [bridge]]]) {
    // Isolate each feature so another object cannot hide a missing keep-out.
    f.obstacles.splice(0, f.obstacles.length, ...zones);
    for (const kind of ['fence', 'plot']) for (let rotation = 0; rotation < 4; rotation++) {
      f.key(kind === 'fence' ? 'KeyF' : 'KeyP');
      for (let turn = 0; turn < rotation; turn++) f.key('KeyR');
      const x = name === 'bridge' && (kind === 'fence' || rotation % 2 === 1) ? 6.75 : 5.25;
      f.pointer('pointermove', x, -6.75);
      assert.match(f.status(), /Blocked by a farm object/, `${name} ${kind} rotation ${rotation}`);
      assert.equal(f.layer.getObjectByName('placement-wash').material.color.getHex(), 0xc45a3a);
      assert.equal(document.querySelector('[data-confirm]').disabled, true);
      f.pointer('pointerdown', x, -6.75);
      f.key('Enter');
      assert.equal(f.count(`placed-${kind}`), 0);
    }
  }
  f.obstacles.splice(0, f.obstacles.length, ...original);
});

test('placement previews, validates, rotates only the ghost, and updates and removes live walking collisions', (t) => {
  const f = fixture(t);
  assert.equal(f.layer.getObjectByName('placement-debug-grid').visible, false);
  f.key('KeyF');
  f.pointer('pointermove', 0.75, 0.75);
  assert.match(f.status(), /Move away/);
  f.pointer('pointerdown', 0.75, 0.75);
  assert.equal(f.count('placed-fence'), 0);
  f.pointer('pointermove', -3.75, 3.75);
  assert.match(f.status(), /Blocked by a farm object/);
  f.pointer('pointermove', 7.8, 3.75);
  assert.match(f.status(), /Outside the buildable island/);
  f.pointer('pointermove', 9, 3.75);
  assert.match(f.status(), /Point at the island/);
  assert.equal(f.layer.getObjectByName('placement-ghost').visible, false);

  f.pointer('pointermove', 3.75, 3.75);
  assert.match(f.status(), /Ready to place/);
  const ghost = f.layer.getObjectByName('placement-ghost');
  const wash = f.layer.getObjectByName('placement-wash');
  assert.equal(wash.material.color.getHex(), 0x283724);
  assert.equal(wash.material.opacity, 0.5);
  assert.ok(Math.abs(ghost.position.y - 2.48) < 1e-10);
  assert.ok(ghost.children.every((part) => part.material.transparent && part.material.opacity === 0.5));
  assert.deepEqual(ghost.children.map((part) => part.material.color.getHex()), [0x8b6914, 0x8b6914, 0xd4a574, 0xd4a574]);
  assert.equal(f.pointer('pointerdown', 3.75, 3.75).defaultPrevented, true);
  assert.equal(f.count('placed-fence'), 1);
  assert.equal(f.obstacles.length, 2);
  assert.match(f.status(), /Space already occupied/);
  assert.equal(wash.material.color.getHex(), 0xc45a3a);
  assert.deepEqual(ghost.children.map((part) => part.material.color.getHex()), [0x8b6914, 0x8b6914, 0xd4a574, 0xd4a574]);
  f.pointer('pointerdown', 3.75, 3.75);
  assert.equal(f.count('placed-fence'), 1);
  f.controls.update(1);
  assert.deepEqual(f.character.position.toArray(), [0, 2.4, 0]); // No accidental click-to-walk.

  const blocked = moveWithFarmCollisions(3.75, 2, 0, 4, 0.4, f.obstacles);
  assert.ok(blocked.z <= 3.22 && blocked.z > 3.1);
  const firstFence = f.layer.children.find((child) => child.name === 'placed-fence');
  f.pointer('pointermove', 2.25, 3.75);
  f.key('KeyR');
  assert.equal(ghost.rotation.y, Math.PI / 2);
  assert.equal(firstFence.rotation.y, 0);
  f.pointer('pointerdown', 2.25, 3.75);
  assert.equal(f.count('placed-fence'), 2);
  assert.equal(f.obstacles.length, 3);

  f.key('KeyP');
  f.pointer('pointermove', -3.75, -0.75);
  assert.deepEqual(f.layer.getObjectByName('placement-ghost').children.map((part) => part.material.color.getHex()),
    [0x7a5a3a, 0xa67c52, 0x7a5a3a, 0x7a5a3a, 0x7a5a3a]);
  f.key('KeyR');
  f.pointer('pointerdown', -3.75, -0.75);
  assert.equal(f.count('placed-plot'), 1);
  assert.equal(f.obstacles.length, 3); // Dirt is walkable, not a solid box.
  assert.equal(f.layer.children.find((child) => child.name === 'placed-plot').rotation.y, Math.PI / 2);
  assert.deepEqual(f.layer.children.find((child) => child.name === 'placed-plot').children.map((part) => part.material.color.getHex()),
    [0x7a5a3a, 0xa67c52, 0x7a5a3a, 0x7a5a3a, 0x7a5a3a]);
  const acrossDirt = moveWithFarmCollisions(-5, 0, 3, 0, 0.4, f.obstacles);
  assert.ok(Math.abs(acrossDirt.x + 2) < 1e-8);

  f.pointer('pointermove', 3.75, 3.75);
  f.key('Delete'); // Remove an older item, not just the latest one.
  assert.equal(f.count('placed-fence'), 1);
  assert.equal(f.obstacles.length, 2);
  const unblocked = moveWithFarmCollisions(3.75, 2, 0, 4, 0.4, f.obstacles);
  assert.ok(unblocked.z > 5.99);
  f.key('Escape');
  assert.equal(f.placement.isActive(), false);
  f.pointer('pointermove', 2.25, 3.75);
  assert.equal(f.key('Delete').defaultPrevented, false);
  assert.equal(f.count('placed-fence'), 1);
  assert.equal(f.count('placed-plot'), 1);
  f.key('KeyZ');
  assert.equal(f.count('placed-plot'), 0);
  f.key('KeyZ');
  assert.equal(f.count('placed-fence'), 0);
  assert.equal(f.obstacles.length, 1); // The pre-existing obstacle is untouched.
});

test('extra world objects and a moving player are rechecked before confirming; touch previews before Place', (t) => {
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), new THREE.MeshBasicMaterial());
  blocker.position.set(-3.75, 2.9, -3.75);
  const f = fixture(t, { getBlockers: () => [blocker] });
  f.key('KeyF');
  f.pointer('pointermove', -3.75, -3.75);
  assert.match(f.status(), /Blocked by a farm object/);
  f.pointer('pointerdown', -3.75, -3.75);
  assert.equal(f.count('placed-fence'), 0);

  f.pointer('pointermove', 3.75, 3.75);
  assert.match(f.status(), /Ready/);
  f.character.position.set(3.75, 2.4, 3.75);
  f.key('Enter');
  assert.match(f.status(), /Move away/);
  assert.equal(f.count('placed-fence'), 0);
  f.character.position.set(0, 2.4, 0);
  f.pointer('pointerdown', 3.75, 3.75, 'touch');
  assert.equal(f.count('placed-fence'), 0);
  document.querySelector('[data-confirm]').click();
  assert.equal(f.count('placed-fence'), 1);
});

test('Remove selects a target after the button is pressed and removes a whole plot from either tile', (t) => {
  const f = fixture(t);
  f.key('KeyP');
  f.pointer('pointermove', -3.75, -0.75);
  f.pointer('pointerdown', -3.75, -0.75);
  assert.equal(f.count('placed-plot'), 1);
  const remove = document.querySelector('[data-remove]');
  remove.click();
  assert.equal(remove.getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('[data-confirm]').disabled, true);
  f.pointer('pointermove', 3.75, 3.75);
  f.pointer('pointerdown', 3.75, 3.75); // An empty tile must not place or remove anything.
  assert.equal(f.count('placed-plot'), 1);
  assert.equal(f.count('placed-fence'), 0);
  f.pointer('pointermove', -2.25, -0.75); // The plot's second reserved tile.
  assert.match(f.status(), /highlighted tile/);
  assert.equal(f.layer.getObjectByName('placement-ghost').visible, false);
  f.pointer('pointerdown', -2.25, -0.75, 'touch');
  assert.equal(f.count('placed-plot'), 0);
  assert.equal(remove.getAttribute('aria-pressed'), 'false');
  assert.equal(f.obstacles.length, 1);
});

test('the optional debug grid uses the dirt hairline and disposal restores only placement collisions', (t) => {
  const f = fixture(t, { debugGrid: true });
  const lines = f.layer.getObjectByName('placement-debug-grid');
  assert.equal(lines.visible, true);
  assert.equal(lines.material.color.getHex(), 0xa67c52);
  f.key('KeyF');
  f.pointer('pointermove', 3.75, 3.75);
  f.pointer('pointerdown', 3.75, 3.75);
  assert.equal(f.obstacles.length, 2);
  f.placement.dispose();
  assert.equal(f.obstacles.length, 1);
  assert.equal(f.scene.getObjectByName('placement-layer'), undefined);
  assert.equal(document.querySelector('.placement-controls'), null);
});
