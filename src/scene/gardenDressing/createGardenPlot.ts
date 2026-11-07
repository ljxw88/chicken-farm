import * as THREE from 'three';
import { PLACEMENT_GEOMETRY } from '../../content/placementGeometry';
import { ART_SLOTS, FARM_PALETTE } from '../../content/slots';
import { GRID } from '../../content/world';
import { TILE_SIZE } from '../../placement/grid';

const GEOMETRY = PLACEMENT_GEOMETRY.plot;

// The visual stays inside the existing two-tile placement footprint. Both the
// placed plot and its translucent ghost use these same parts.
export function createGardenPlot() {
  const group = new THREE.Group();
  group.name = 'placement-plot-visual';
  const width = TILE_SIZE * GRID.footprints.plot.columns - GEOMETRY.tileInset;
  const depth = TILE_SIZE - GEOMETRY.tileInset;
  const edgeWidth = GEOMETRY.edgeWidth;
  const soil = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.soil, roughness: 1, flatShading: true });
  const timber = new THREE.MeshStandardMaterial({ color: ART_SLOTS.building.cottage.timber, roughness: 1, flatShading: true });
  const foliage = [FARM_PALETTE.treeFoliage, FARM_PALETTE.treeFoliageLight]
    .map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));

  // A substantial soil base supports the edges; its top is 0.04 above the
  // inner base of the overlapping frame, without a wafer-thin soil slab.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(width - GEOMETRY.bedInset, GEOMETRY.bedHeight, depth - GEOMETRY.bedInset), soil);
  bed.name = 'garden-plot-soil';
  bed.position.y = GEOMETRY.bedY;
  group.add(bed);

  const longEdge = new THREE.BoxGeometry(width, GEOMETRY.frameHeight, edgeWidth);
  const shortEdge = new THREE.BoxGeometry(edgeWidth, GEOMETRY.frameHeight, depth - 2 * edgeWidth);
  // The long edges close these ends. Removing the hidden caps avoids
  // coplanar faces and ghost overdraw at the four timber joints.
  const index = shortEdge.getIndex()!;
  const normals = shortEdge.getAttribute('normal');
  const visibleFaces: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    if (Math.abs(normals.getZ(index.getX(i))) > 0.5) continue;
    visibleFaces.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  shortEdge.setIndex(visibleFaces);
  shortEdge.clearGroups();
  for (const z of [-(depth - edgeWidth) / 2, (depth - edgeWidth) / 2]) {
    const edge = new THREE.Mesh(longEdge, timber);
    edge.name = 'garden-plot-frame';
    edge.position.set(0, GEOMETRY.frameY, z);
    group.add(edge);
  }
  for (const x of [-(width - edgeWidth) / 2, (width - edgeWidth) / 2]) {
    const edge = new THREE.Mesh(shortEdge, timber);
    edge.name = 'garden-plot-frame';
    edge.position.set(x, GEOMETRY.frameY, 0);
    group.add(edge);
  }

  const nub = new THREE.BoxGeometry(...GEOMETRY.seedling);
  for (const [row, z] of GEOMETRY.seedlingRows.entries()) {
    for (const [column, x] of GEOMETRY.seedlingColumns.entries()) {
      const seedling = new THREE.Mesh(nub, foliage[(row + column) % 2]);
      seedling.name = 'garden-plot-seedling';
      seedling.position.set(x, GEOMETRY.seedlingY, z);
      group.add(seedling);
    }
  }
  return group;
}
