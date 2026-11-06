import * as THREE from 'three';
import { ECONOMY_RATES, type Economy } from '../../inventory/createEconomy';
import type { Interactable } from '../Interactable';
import { disposeQaGroup } from './disposeQaGroup';

// The sign and bin share transactions with the on-screen market controls.
export function createQaWorldStubs(scene: THREE.Scene, groundHeight: number, economy: Economy) {
  const group = new THREE.Group();
  group.name = 'qa-world-action-stubs';
  scene.add(group);
  let active = true;
  let binOpen = false;

  const wood = new THREE.MeshStandardMaterial({ color: 0x96714a, roughness: 1 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x684a32, roughness: 1 });
  const lettering = new THREE.MeshStandardMaterial({ color: 0xf3dfb2, roughness: 1 });
  const bin = new THREE.Group();
  bin.name = 'qa-feed-bin-stub';
  bin.position.set(-2.8, groundHeight, -1.2);
  group.add(bin);
  const binBody = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.58, 0.6), wood);
  binBody.position.y = 0.33;
  bin.add(binBody);
  const lidHinge = new THREE.Group();
  lidHinge.position.set(0, 0.64, -0.3);
  bin.add(lidHinge);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.66), darkWood);
  lid.position.z = 0.3;
  lidHinge.add(lid);

  const sign = new THREE.Group();
  sign.name = 'qa-sign-stub';
  sign.position.set(0.95, groundHeight, -2.35);
  group.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 0.12), darkWood);
  post.position.y = 0.525;
  sign.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.48, 0.1), wood);
  board.position.y = 1.05;
  sign.add(board);
  for (const [y, width] of [[1.13, 0.5], [0.98, 0.32]]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, 0.015), lettering);
    line.position.set(0, y, 0.059);
    sign.add(line);
  }

  const interactables: Interactable[] = [
    {
      id: 'qa-feed-bin', object: bin, label: `Buy feed (−${ECONOMY_RATES.buyFeed} Supplies)`,
      range: 1.3, promptHeight: 0.95,
      isAvailable: () => active,
      interact() {
        const result = economy.buyFeed();
        if (result.ok) {
          binOpen = !binOpen;
          lidHinge.rotation.x = binOpen ? -1.1 : 0;
        }
        return result.message;
      },
    },
    {
      id: 'qa-sign', object: sign, label: `Market: sell egg (+${ECONOMY_RATES.sellEgg} Supplies)`, range: 1.25, promptHeight: 1.4,
      isAvailable: () => active,
      interact() {
        return economy.sellEgg().message;
      },
    },
  ];

  function dispose() {
    if (!active) return;
    active = false;
    disposeQaGroup(group);
  }

  return { interactables, dispose };
}
