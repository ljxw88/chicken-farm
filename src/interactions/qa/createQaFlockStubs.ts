import * as THREE from 'three';
import type { Interactable } from '../Interactable';
import { disposeQaGroup } from './disposeQaGroup';

// Temporary, static QA stand-ins. They deliberately do not implement flock AI,
// egg production, persistent inventory, or buying and selling.
export function createQaFlockStubs(
  scene: THREE.Scene,
  groundHeight: number,
  { onEggCollected }: { onEggCollected?: () => void } = {},
) {
  const group = new THREE.Group();
  group.name = 'qa-flock-stubs';
  scene.add(group);
  let active = true;
  let feed = 1; // A free, in-memory QA seed; feeding does not spend coins.
  let eggs = 0;
  let collected = false;

  const chicken = new THREE.Group();
  chicken.name = 'qa-chicken-stub';
  chicken.position.set(1.75, groundHeight, 1.75);
  group.add(chicken);

  const visual = new THREE.Group();
  visual.name = 'qa-chicken-clickable';
  chicken.add(visual);
  const feathers = new THREE.MeshStandardMaterial({ color: 0xfff1d7, roughness: 1 });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xe4d1ae, roughness: 1 });
  const combMaterial = new THREE.MeshStandardMaterial({ color: 0xc75b46, roughness: 1 });
  const beakMaterial = new THREE.MeshStandardMaterial({ color: 0xe9a048, roughness: 1 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x332820, roughness: 1 });

  function oval(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    visual.add(mesh);
    return mesh;
  }

  oval(feathers, 0, 0.44, 0, 0.4, 0.34, 0.48);
  oval(feathers, 0, 0.78, 0.27, 0.27, 0.28, 0.27);
  for (const side of [-1, 1]) {
    oval(wingMaterial, side * 0.34, 0.46, -0.05, 0.12, 0.2, 0.28);
    oval(eyeMaterial, side * 0.12, 0.83, 0.5, 0.035, 0.035, 0.035);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), beakMaterial);
    leg.position.set(side * 0.15, 0.13, 0.02);
    visual.add(leg);
  }
  for (const z of [0.16, 0.28, 0.4]) oval(combMaterial, 0, 1.05, z, 0.08, 0.105, 0.08);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), beakMaterial);
  beak.position.set(0, 0.72, 0.57);
  beak.rotation.x = Math.PI / 2;
  visual.add(beak);

  // The shadow is decorative, not a click target or an interaction pad.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.43, 20),
    new THREE.MeshBasicMaterial({ color: 0x263b20, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.7;
  shadow.position.set(1.75, groundHeight + 0.04, 1.75);
  group.add(shadow);

  const egg = new THREE.Group();
  egg.name = 'qa-egg-stub';
  egg.position.set(3.2, groundHeight, 1.2);
  group.add(egg);
  const nest = new THREE.Mesh(
    new THREE.RingGeometry(0.17, 0.29, 20),
    new THREE.MeshStandardMaterial({ color: 0xb8925b, roughness: 1 }),
  );
  nest.rotation.x = -Math.PI / 2;
  nest.position.y = 0.045;
  egg.add(nest);
  const eggMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff5db, roughness: 1 }),
  );
  eggMesh.name = 'qa-egg';
  eggMesh.scale.set(0.85, 1.2, 0.85);
  eggMesh.position.y = 0.24;
  egg.add(eggMesh);

  function isEggReady() {
    return active && !collected;
  }

  // The world interaction and the Growing list share this guard and action.
  // The list may collect remotely, but neither path can collect the egg twice.
  function collectEgg() {
    if (!isEggReady()) return;
    collected = true;
    egg.visible = false;
    eggs++;
    onEggCollected?.();
    return `Collected egg (QA stub). Eggs: ${eggs}.`;
  }

  const interactables: Interactable[] = [
    {
      id: 'qa-chicken', object: chicken, clickTargets: [visual], label: 'Feed chicken (stub)',
      range: 1.35, promptHeight: 1.3, isAvailable: () => active,
      interact() {
        if (feed === 0) return 'No feed left (QA stub). Refresh to reset.';
        feed--;
        return `Fed chicken (QA stub). Feed: ${feed}.`;
      },
    },
    {
      id: 'qa-egg', object: egg, label: 'Collect egg (stub)',
      range: 1.15, promptHeight: 0.6, isAvailable: isEggReady, interact: collectEgg,
    },
  ];

  function dispose() {
    if (!active) return;
    active = false;
    disposeQaGroup(group);
  }

  return { interactables, isEggReady, collectEgg, dispose };
}
