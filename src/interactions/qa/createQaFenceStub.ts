import * as THREE from 'three';
import { FARM_PALETTE } from '../../scene/farmPalette';
import { disposeQaGroup } from './disposeQaGroup';

/** One decorative, nonblocking segment at a fixed empty spot; not a placement editor. */
export function createQaFenceStub(scene: THREE.Scene, groundHeight: number) {
  let active = true;
  let segment: THREE.Group | undefined;

  function place() {
    if (!active || segment) return false;
    segment = new THREE.Group();
    segment.name = 'qa-paid-fence';
    segment.position.set(0.4, groundHeight, 2.6);

    const wood = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnWood, roughness: 1 });
    const trim = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnTrim, roughness: 1 });
    const postGeometry = new THREE.BoxGeometry(0.17, 0.95, 0.17);
    for (const x of [-0.65, 0.65]) {
      const post = new THREE.Mesh(postGeometry, trim);
      post.position.set(x, 0.475, 0);
      segment.add(post);
    }
    const railGeometry = new THREE.BoxGeometry(1.4, 0.13, 0.1);
    for (const y of [0.32, 0.67]) {
      const rail = new THREE.Mesh(railGeometry, wood);
      rail.position.set(0, y, 0.08);
      segment.add(rail);
    }
    scene.add(segment);
    return true;
  }

  function dispose() {
    if (!active) return;
    active = false;
    if (segment) disposeQaGroup(segment);
  }

  return { isPlaced: () => active && Boolean(segment), place, dispose };
}
