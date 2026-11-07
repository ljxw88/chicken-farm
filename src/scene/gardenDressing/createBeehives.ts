import * as THREE from 'three';
import type { FarmObstacle } from '../../character/farmCollisions';
import { CONTACT_SHADOW_COLOR } from '../contactShadowStyle';
import { createGableRoof } from '../createGableRoof';
import { GROUND_HEIGHT } from '../createIsland';
import { BUILDING_PALETTE } from '../farmBuildingMaterials';
import { FARM_PALETTE } from '../farmPalette';

// Look Dev's corrected EBR-49a positions. The 2.4-unit strip between the
// cottage collider and island rim cannot accommodate both original clearances.
export const BEEHIVES = [
  { x: -6.7, z: -3.5 },
  { x: -6.7, z: -4.3 },
] as const;

// The two slopes meet at the ridge; their hidden interior faces must not
// occupy the same plane. Their visible roof surfaces and overhang are intact.
function removeRidgeFaces(roof: THREE.Group) {
  for (const slope of roof.children) {
    if (!(slope instanceof THREE.Mesh)) continue;
    const geometry = slope.geometry;
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const visibleFaces: number[] = [];
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const vertices = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset);
      if (vertices.every((vertex) => Math.abs(positions.getZ(vertex)) < 1e-6)) continue;
      visibleFaces.push(...vertices);
    }
    geometry.setIndex(visibleFaces);
    geometry.clearGroups();
  }
}

export function createBeehives(parent: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = 'garden-beehives';
  parent.add(group);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: BUILDING_PALETTE.coopWall, roughness: 1, flatShading: true });
  const timber = new THREE.MeshStandardMaterial({ color: BUILDING_PALETTE.timber, roughness: 1, flatShading: true });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeFoliageDark, roughness: 1, flatShading: true });
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: CONTACT_SHADOW_COLOR, transparent: true, opacity: 0.12, depthWrite: false });
  const bodyGeometry = new THREE.BoxGeometry(0.7, 0.45, 0.7);
  const standGeometry = new THREE.BoxGeometry(0.68, 0.1, 0.68);
  const entranceGeometry = new THREE.BoxGeometry(0.3, 0.1, 0.1);
  const shadowGeometry = new THREE.CircleGeometry(1, 16);
  const obstacles: FarmObstacle[] = [];
  const shadows: THREE.Mesh[] = [];
  const clickTargets: THREE.Group[] = [];

  BEEHIVES.forEach(({ x, z }, index) => {
    const name = `beehive-${index + 1}`;
    const hive = new THREE.Group();
    hive.name = name;
    hive.position.set(x, GROUND_HEIGHT, z);
    group.add(hive);
    clickTargets.push(hive);

    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.name = `${name}-shadow`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.52, 0.4, 1);
    shadow.position.y = 0.012;
    hive.add(shadow);
    shadows.push(shadow);

    const stand = new THREE.Mesh(standGeometry, timber);
    stand.name = `${name}-stand`;
    stand.position.y = 0.05;
    hive.add(stand);
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.name = `${name}-body`;
    // Overlap the slightly inset stand rather than sharing coplanar faces.
    body.position.y = 0.315;
    hive.add(body);
    const entrance = new THREE.Mesh(entranceGeometry, timber);
    entrance.name = `${name}-entrance`;
    entrance.position.set(0, 0.27, 0.38);
    hive.add(entrance);
    const roof = createGableRoof(hive, { name, width: 0.7, depth: 0.7, wallTop: 0.55, rise: 0.25,
      overhang: 0.08, wallMaterial: bodyMaterial, roofMaterial });
    removeRidgeFaces(roof);
    const gable = hive.getObjectByName(`${name}-gable`)!;
    gable.scale.x = 0.68 / 0.7;
    gable.position.x = -0.34;
    // The approved hive spacing makes the roof overhangs meet. A tiny
    // hand-made offset keeps their end faces from z-fighting at the join.
    roof.position.x = index === 0 ? -0.01 : 0.01;

    obstacles.push({ kind: 'box', name, minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
  });

  function updateShadows(awayX: number, awayZ: number, offset: number, strength: number) {
    for (const shadow of shadows) {
      shadow.position.x = awayX * offset * 0.5;
      shadow.position.z = awayZ * offset * 0.5;
    }
    shadowMaterial.opacity = 0.12 * strength;
  }
  return { group, obstacles, clickTargets, updateShadows };
}
