import * as THREE from 'three';
import { LANTERN_LIGHT, WINDOW_LIGHT } from './dayNightPhases';

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
    light.position.z = 0.7;
    window.add(light);
    return light;
  });
  for (const { material } of accents) {
    material.emissive.setHex(WINDOW_LIGHT.color);
    material.emissiveIntensity = 0;
  }

  const lantern = new THREE.Group();
  lantern.name = 'lantern';
  lantern.position.set(0.72, 1.05, 0.5);
  character.add(lantern);

  // A small wing connects the carried lantern to the existing character body.
  const wingStart = new THREE.Vector3(-0.4, -0.05, -0.28);
  const wingEnd = new THREE.Vector3(-0.08, -0.05, -0.06);
  const wingDirection = wingEnd.clone().sub(wingStart);
  const wing = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.055, wingDirection.length() - 0.11, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd477, roughness: 0.9 }),
  );
  wing.position.copy(wingStart).add(wingEnd).multiplyScalar(0.5);
  wing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wingDirection.normalize());
  lantern.add(wing);

  const glassMaterial = new THREE.MeshStandardMaterial({
    color: LANTERN_LIGHT.color,
    emissive: LANTERN_LIGHT.color,
    emissiveIntensity: 0,
    roughness: 0.6,
  });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.3, 8), glassMaterial);
  glass.name = 'lantern-glass';
  lantern.add(glass);

  const metal = new THREE.MeshStandardMaterial({ color: 0x554433, roughness: 0.9 });
  const capGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.04, 8);
  for (const y of [-0.17, 0.17]) {
    const cap = new THREE.Mesh(capGeometry, metal);
    cap.position.y = y;
    lantern.add(cap);
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 6, 12, Math.PI), metal);
  handle.position.y = 0.19;
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
    glassMaterial.emissiveIntensity = LANTERN_LIGHT.intensity * amount;
  }

  return { setNightAmount };
}
