import * as THREE from 'three';
import type { FarmObstacle } from '../../character/farmCollisions';
import { BEEHIVE_FOOTPRINT, BEEHIVE_GEOMETRY as GEOMETRY, GARDEN_DRESSING } from '../../content/garden';
import { ART_SLOTS, FARM_PALETTE } from '../../content/slots';
import { createGableRoof } from '../createGableRoof';
import { GROUND_HEIGHT } from '../createIsland';

// Look Dev's corrected EBR-49a positions. The 2.4-unit strip between the
// cottage collider and island rim cannot accommodate both original clearances.
export const BEEHIVES = GARDEN_DRESSING.beehives;

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
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: ART_SLOTS.building.coop.wall, roughness: 1, flatShading: true });
  const timber = new THREE.MeshStandardMaterial({ color: ART_SLOTS.building.cottage.timber, roughness: 1, flatShading: true });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeFoliageDark, roughness: 1, flatShading: true });
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true,
    opacity: ART_SLOTS.light.contact.beehiveOpacity, depthWrite: false });
  const bodyGeometry = new THREE.BoxGeometry(...GEOMETRY.body);
  const standGeometry = new THREE.BoxGeometry(...GEOMETRY.stand);
  const entranceGeometry = new THREE.BoxGeometry(...GEOMETRY.entrance);
  const shadowGeometry = new THREE.CircleGeometry(...GEOMETRY.shadow);
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
    shadow.scale.set(...GEOMETRY.shadowScale);
    shadow.position.y = GEOMETRY.shadowY;
    hive.add(shadow);
    shadows.push(shadow);

    const stand = new THREE.Mesh(standGeometry, timber);
    stand.name = `${name}-stand`;
    stand.position.y = GEOMETRY.standY;
    hive.add(stand);
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.name = `${name}-body`;
    // Overlap the slightly inset stand rather than sharing coplanar faces.
    body.position.y = GEOMETRY.bodyY;
    hive.add(body);
    const entrance = new THREE.Mesh(entranceGeometry, timber);
    entrance.name = `${name}-entrance`;
    entrance.position.set(...GEOMETRY.entrancePosition);
    hive.add(entrance);
    const roof = createGableRoof(hive, { name, ...GEOMETRY.roof, wallMaterial: bodyMaterial, roofMaterial });
    removeRidgeFaces(roof);
    const gable = hive.getObjectByName(`${name}-gable`)!;
    gable.scale.x = GEOMETRY.gableWidth / GEOMETRY.roof.width;
    gable.position.x = GEOMETRY.gableX;
    // The approved hive spacing makes the roof overhangs meet. A tiny
    // hand-made offset keeps their end faces from z-fighting at the join.
    roof.position.x = index === 0 ? -GEOMETRY.roofNudge : GEOMETRY.roofNudge;

    obstacles.push({ kind: 'box', name, minX: x - BEEHIVE_FOOTPRINT.halfWidth, maxX: x + BEEHIVE_FOOTPRINT.halfWidth,
      minZ: z - BEEHIVE_FOOTPRINT.halfDepth, maxZ: z + BEEHIVE_FOOTPRINT.halfDepth });
  });

  function updateShadows(awayX: number, awayZ: number, offset: number, strength: number) {
    for (const shadow of shadows) {
      shadow.position.x = awayX * offset * GEOMETRY.shadowOffset;
      shadow.position.z = awayZ * offset * GEOMETRY.shadowOffset;
    }
    shadowMaterial.opacity = ART_SLOTS.light.contact.beehiveOpacity * strength;
  }
  return { group, obstacles, clickTargets, updateShadows };
}
