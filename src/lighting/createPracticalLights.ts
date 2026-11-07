import * as THREE from 'three';
import { LANTERN_LIGHT, WINDOW_LIGHT } from '../content/dayNight';
import { ART_SLOTS } from '../content/slots';
import { PRACTICAL_LIGHT_GEOMETRY as GEOMETRY } from '../content/lightGeometry';

export type WindowPane = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
export interface EmissiveAccent {
  material: THREE.MeshStandardMaterial;
  strength: number;
}

export function createPracticalLights(character: THREE.Object3D, windows: readonly WindowPane[], accents: readonly EmissiveAccent[] = []) {
  const windowLights = windows.map((window, index) => {
    window.material.emissive.setHex(WINDOW_LIGHT.color);
    window.material.emissiveIntensity = 0;
    const light = new THREE.PointLight(WINDOW_LIGHT.color, 0, WINDOW_LIGHT.distance, WINDOW_LIGHT.decay);
    light.name = `window-light-${index + 1}`;
    // The pane's local +Z points out of the cottage.
    light.position.z = GEOMETRY.windowOffset;
    window.add(light);
    return light;
  });
  for (const { material } of accents) {
    material.emissive.setHex(WINDOW_LIGHT.color);
    material.emissiveIntensity = 0;
  }

  const lantern = new THREE.Group();
  lantern.name = 'lantern';
  lantern.position.set(...GEOMETRY.lanternPosition);
  character.add(lantern);

  // A small wing connects the carried lantern to the existing character body.
  const wingStart = new THREE.Vector3(...GEOMETRY.wingStart);
  const wingEnd = new THREE.Vector3(...GEOMETRY.wingEnd);
  const wingDirection = wingEnd.clone().sub(wingStart);
  // One world pixel at the default view was too thin to reliably connect the
  // cup to the body. Keep the same endpoints, but make the little wing legible.
  const wingRadius = GEOMETRY.wingRadius;
  const wing = new THREE.Mesh(
    new THREE.CapsuleGeometry(wingRadius, wingDirection.length() - 2 * wingRadius, GEOMETRY.wingCapSegments, GEOMETRY.wingRadialSegments),
    new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.lantern.wing, roughness: 0.9 }),
  );
  wing.name = 'lantern-wing';
  wing.position.copy(wingStart).add(wingEnd).multiplyScalar(0.5);
  wing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wingDirection.normalize());
  lantern.add(wing);

  const glassMaterial = new THREE.MeshStandardMaterial({
    color: LANTERN_LIGHT.color,
    emissive: LANTERN_LIGHT.color,
    emissiveIntensity: 0,
    roughness: 0.6,
  });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(...GEOMETRY.glass), glassMaterial);
  glass.name = 'lantern-glass';
  lantern.add(glass);

  const metal = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.lantern.metal, roughness: 0.9 });
  const capGeometry = new THREE.CylinderGeometry(...GEOMETRY.cap);
  for (const y of GEOMETRY.capYs) {
    const cap = new THREE.Mesh(capGeometry, metal);
    cap.position.y = y;
    lantern.add(cap);
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(...GEOMETRY.handle), metal);
  handle.position.y = GEOMETRY.handleY;
  lantern.add(handle);

  const lanternLight = new THREE.PointLight(
    LANTERN_LIGHT.color,
    0,
    LANTERN_LIGHT.distance,
    LANTERN_LIGHT.decay,
  );
  lanternLight.name = 'lantern-light';
  lantern.add(lanternLight);

  function setNightAmount(amount: number) {
    for (const light of windowLights) light.intensity = WINDOW_LIGHT.intensity * amount;
    for (const window of windows) window.material.emissiveIntensity = WINDOW_LIGHT.intensity * amount;
    for (const { material, strength } of accents) material.emissiveIntensity = WINDOW_LIGHT.intensity * strength * amount;
    lanternLight.intensity = LANTERN_LIGHT.intensity * amount;
    glassMaterial.emissiveIntensity = LANTERN_LIGHT.glassIntensity * amount;
  }

  return { setNightAmount };
}
