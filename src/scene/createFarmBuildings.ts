import * as THREE from 'three';
import type { WindowPane } from '../lighting/createPracticalLights';
import { GROUND_HEIGHT } from './createIsland';
import type { FarmObstacle } from './farmCollisions';
import { FARM_PALETTE } from './farmPalette';

// Phase 1 placeholders, NOT Look Dev dimensions. The three adjacent boxes
// partition the one barn footprint on origin/main; no coop locations existed.
// Replace these positions and dimensions together when Look Dev supplies them.
export const FARM_BUILDINGS = [
  { name: 'cottage', x: -3.4, z: -3.4, width: 2, depth: 2.6, height: 2 },
  { name: 'ramp-coop-1', x: -4.9, z: -3.4, width: 1, depth: 2.6, height: 1 },
  { name: 'ramp-coop-2', x: -1.9, z: -3.4, width: 1, depth: 2.6, height: 1 },
] as const;

export function createFarmBuildings(parent: THREE.Group) {
  const windows: WindowPane[] = [];
  const material = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnWood, roughness: 1 });

  const obstacles = FARM_BUILDINGS.map(({ name, x, z, width, depth, height }): FarmObstacle => {
    const building = new THREE.Group();
    building.name = `farm-${name}`;
    building.position.set(x, GROUND_HEIGHT, z);
    parent.add(building);

    const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    box.name = `${name}-placeholder`;
    box.position.y = height / 2;
    building.add(box);

    if (name === 'cottage') {
      for (const [index, side] of [-1, 1].entries()) {
        // Flush panes keep the placeholder's visible footprint identical to its
        // collision box. Polygon offset avoids z-fighting with the front face.
        const pane: WindowPane = new THREE.Mesh(
          new THREE.PlaneGeometry(width * 0.285, height * 0.285),
          new THREE.MeshStandardMaterial({
            color: FARM_PALETTE.barnWindow, roughness: 0.7,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
          }),
        );
        pane.name = `cottage-window-${index + 1}`;
        pane.position.set(side * width * 0.3, height * 0.66, depth / 2);
        building.add(pane);
        windows.push(pane);
      }
    }

    return { kind: 'box', name, minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
  });

  return { windows, obstacles };
}
