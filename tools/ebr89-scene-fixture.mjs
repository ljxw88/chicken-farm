import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

// Independent, signed EBR-89 additions to the immutable a75e8db scene fixture.
// The other scene bytes are copied verbatim; only reference indices shift.
const COMB = [[-0.1, 0.62, 0.17], [0, 0.62, 0.17], [0.1, 0.62, 0.17]];
const WINGS = [[-0.36, 0.1, 0], [0.36, 0.1, 0]];
const COMB_SCALE = [0.07, 0.06, 0.07];
const WING_SCALE = [0.05, 0.15, 0.11];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function attribute(value) {
  const array = value.array;
  return { itemSize: value.itemSize, count: value.count, normalized: value.normalized,
    arrayType: array.constructor.name, byteLength: array.byteLength,
    sha256: hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength)) };
}

function ovalGeometry() {
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  geometry.computeBoundingBox();
  const min = geometry.boundingBox.min.toArray(), max = geometry.boundingBox.max.toArray();
  return { type: geometry.type, bounds: { min, max, size: max.map((value, i) => value - min[i]) },
    groups: geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex })),
    index: attribute(geometry.index),
    attributes: Object.fromEntries(Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [name, attribute(value)])) };
}

function standardMaterial(color) {
  const value = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const rgb = (item) => item?.isColor ? item.toArray() : null;
  return { type: value.type, color: rgb(value.color), emissive: rgb(value.emissive), specular: rgb(value.specular),
    opacity: value.opacity, transparent: value.transparent, visible: value.visible, depthWrite: value.depthWrite,
    depthTest: value.depthTest, side: value.side, blending: value.blending, alphaTest: value.alphaTest,
    vertexColors: value.vertexColors, toneMapped: value.toneMapped, roughness: value.roughness ?? null,
    metalness: value.metalness ?? null, emissiveIntensity: value.emissiveIntensity ?? null,
    flatShading: value.flatShading ?? null, polygonOffset: value.polygonOffset,
    polygonOffsetFactor: value.polygonOffsetFactor, polygonOffsetUnits: value.polygonOffsetUnits, uniforms: null };
}

function objectRecord(bodyMatrix, name, position, scale, geometry, material) {
  const world = new THREE.Matrix4().fromArray(bodyMatrix).multiply(new THREE.Matrix4().compose(
    new THREE.Vector3(...position), new THREE.Quaternion(), new THREE.Vector3(...scale),
  ));
  const object = { type: geometry === undefined ? 'Group' : 'Mesh', name, visible: true,
    position: [...position], quaternion: [0, 0, 0, 1], scale: [...scale], matrixWorld: world.toArray(), renderOrder: 0,
    castShadow: false, receiveShadow: false };
  if (geometry !== undefined) { object.geometry = geometry; object.materials = [material]; }
  return object;
}

/** Derive the EBR-89 expected scene from the independently captured main. */
export function createEbr89SceneFixture(reference) {
  const result = structuredClone(reference);
  for (const [name, snapshot] of Object.entries(result.snapshots)) {
    const characterIndex = snapshot.objects.findIndex((object) => object.name === 'character');
    assert.ok(characterIndex >= 0, `${name}: character missing`);
    const bodyIndex = characterIndex + 1, body = snapshot.objects[bodyIndex];
    assert.equal(body.type, 'Mesh', `${name}: character body missing`);
    assert.equal(snapshot.geometries[body.geometry].type, 'CapsuleGeometry', `${name}: body is not a capsule`);
    assert.equal(body.materials.length, 1);
    const geometryId = body.geometry + 1, combMaterialId = body.materials[0] + 1, wingMaterialId = combMaterialId + 1;
    for (const object of snapshot.objects) {
      if (object.geometry !== undefined && object.geometry >= geometryId) object.geometry++;
      if (object.materials) object.materials = object.materials.map((id) => id >= combMaterialId ? id + 2 : id);
    }
    snapshot.geometries.splice(geometryId, 0, ovalGeometry());
    snapshot.materials.splice(combMaterialId, 0, standardMaterial(0xc75b46), standardMaterial(0xbd8b31));
    const additions = [objectRecord(body.matrixWorld, 'character-comb', [0, 0, 0], [1, 1, 1]),
      ...COMB.map((position, index) => objectRecord(body.matrixWorld, `character-comb-bump-${index + 1}`,
        position, COMB_SCALE, geometryId, combMaterialId)),
      ...WINGS.map((position, index) => objectRecord(body.matrixWorld, `character-wing-${index ? 'right' : 'left'}`,
        position, WING_SCALE, geometryId, wingMaterialId))];
    snapshot.objects.splice(bodyIndex + 1, 0, ...additions);
    if (name === 'sunset') {
      assert.equal(snapshot.fog.density, 0.015);
      snapshot.fog.density = 0.0129;
      const key = snapshot.objects.find((object) => object.name === 'day-night-directional');
      assert.equal(key.light.intensity, 1.2);
      key.light.intensity = 1.38;
    }
  }
  return result;
}
