import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { FARM_PALETTE } = await vite.ssrLoadModule('/src/scene/farmPalette.ts');
after(() => vite.close());

function bodyAndDetails() {
  const character = createCharacter();
  const body = character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
  return { character, body, comb: body.getObjectByName('character-comb'),
    wings: ['left', 'right'].map((side) => body.getObjectByName(`character-wing-${side}`)) };
}

// Check the oval intersects and extends through the capsule surface rather
// than floating away or being buried entirely inside it.
function checkSurfaceContact(mesh) {
  const center = mesh.position.clone();
  const closestAxisPoint = new THREE.Vector3(0, THREE.MathUtils.clamp(center.y, -0.3, 0.3), 0);
  const radial = center.sub(closestAxisPoint);
  const distance = radial.length();
  const normal = radial.normalize();
  const support = Math.hypot(normal.x * mesh.scale.x, normal.y * mesh.scale.y, normal.z * mesh.scale.z);
  assert.ok(distance < 0.4, `${mesh.name}: center is detached from the body`);
  assert.ok(distance + support > 0.4, `${mesh.name}: oval does not reach the surface`);
}

test('the comb has three chunky red bumps, centered across the forward crown', () => {
  const { body, comb } = bodyAndDetails();
  assert.equal(comb.parent, body);
  assert.equal(comb.children.length, 3);
  assert.deepEqual(comb.children.map((bump) => bump.name),
    ['character-comb-bump-1', 'character-comb-bump-2', 'character-comb-bump-3']);
  assert.equal(FARM_PALETTE.flowerRed, 0xc75b46);
  for (const [index, bump] of comb.children.entries()) {
    assert.equal(bump.geometry.type, 'SphereGeometry');
    assert.deepEqual(bump.scale.toArray(), [0.07, 0.06, 0.07]);
    assert.equal(bump.position.x, [-0.1, 0, 0.1][index]);
    assert.ok(bump.position.z > 0 && bump.position.y > 0.3);
    assert.equal(bump.material.color.getHex(), FARM_PALETTE.flowerRed);
    assert.equal(bump.material.emissive.getHex(), 0);
    checkSurfaceContact(bump);
  }
  assert.ok(Math.abs(comb.children[2].position.x - comb.children[0].position.x + 0.14 - 0.34) < 1e-9);
});

test('both gold wing patches are flush with the body, non-emissive and symmetric', () => {
  const { body, wings } = bodyAndDetails();
  assert.equal(FARM_PALETTE.characterWingGold, 0xd9b45a);
  assert.equal(wings.length, 2);
  for (const [index, wing] of wings.entries()) {
    assert.equal(wing.parent, body);
    assert.equal(wing.geometry.type, 'SphereGeometry');
    assert.deepEqual(wing.scale.toArray(), [0.05, 0.15, 0.11]);
    assert.equal(wing.position.x, index === 0 ? -0.36 : 0.36);
    assert.equal(wing.material.color.getHex(), FARM_PALETTE.characterWingGold);
    assert.equal(wing.material.emissive.getHex(), 0);
    checkSurfaceContact(wing);
  }
  assert.equal(wings[0].position.y, wings[1].position.y);
  assert.equal(wings[0].position.z, wings[1].position.z);
});

test('details do not replace the signed body, face or contact shadow', () => {
  const { character, body } = bodyAndDetails();
  assert.equal(body.material.color.getHex(), 0xffd477);
  assert.equal(body.material.vertexColors, true);
  assert.equal(body.material.emissive.getHex(), 0);
  assert.equal(character.getObjectByName('character-shadow').material.opacity, 0.22);
  const face = character.children.filter((child) => child.geometry?.type === 'SphereGeometry');
  assert.equal(face.length, 3, 'two eyes and the existing beak remain in place');
  assert.deepEqual(face.map((mesh) => mesh.material.color.getHex()), [0x302820, 0x302820, 0xe99049]);
});
