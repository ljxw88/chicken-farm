import * as THREE from 'three';
import type { WindowPane } from '../lighting/createPracticalLights';

// Small scenery stubs until the farm buildings are implemented.
export function createShedStubs(scene: THREE.Scene): WindowPane[] {
  const windows: WindowPane[] = [];
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb9835d, roughness: 1 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x694a3a, roughness: 1 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x574332, roughness: 1 });
  const width = 2.2;
  const depth = 1.9;
  const wallHeight = 1.8;

  for (const [index, [x, z]] of [[-3.5, 1], [1, -3.5]].entries()) {
    const shed = new THREE.Group();
    shed.name = `shed-${index + 1}`;
    shed.position.set(x, 0, z);
    scene.add(shed);

    const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), wallMaterial);
    walls.position.y = wallHeight / 2;
    shed.add(walls);

    const roofShape = new THREE.Shape();
    roofShape.moveTo(-width / 2 - 0.15, wallHeight);
    roofShape.lineTo(0, wallHeight + 0.65);
    roofShape.lineTo(width / 2 + 0.15, wallHeight);
    roofShape.closePath();
    const roof = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roofShape, { depth: depth + 0.2, bevelEnabled: false }),
      roofMaterial,
    );
    roof.position.z = -depth / 2 - 0.1;
    shed.add(roof);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.06), frameMaterial);
    frame.position.set(0.15, 1.15, depth / 2 + 0.03);
    shed.add(frame);

    const pane: WindowPane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x627a80, roughness: 0.7 }),
    );
    pane.name = `shed-window-${index + 1}`;
    pane.position.set(0.15, 1.15, depth / 2 + 0.065);
    shed.add(pane);
    windows.push(pane);

    const verticalBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 0.02), frameMaterial);
    verticalBar.position.set(0.15, 1.15, depth / 2 + 0.08);
    shed.add(verticalBar);
    const horizontalBar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 0.02), frameMaterial);
    horizontalBar.position.set(0.15, 1.15, depth / 2 + 0.08);
    shed.add(horizontalBar);
  }

  return windows;
}
