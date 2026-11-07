import * as THREE from 'three';
import { GABLE_GEOMETRY as GEOMETRY } from '../content/buildingGeometry';

interface GableRoofOptions {
  name: string;
  width: number;
  depth: number;
  wallTop: number;
  rise: number;
  overhang: number;
  wallMaterial: THREE.Material;
  roofMaterial: THREE.Material;
  bandMaterial?: THREE.Material;
}

// Shape X becomes world -Z and extrusion becomes world +X: the ridge runs X.
function prism(shape: THREE.Shape, width: number, material: THREE.Material, name: string) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.x = -width / 2;
  return mesh;
}

export function createGableRoof(parent: THREE.Group, {
  name, width, depth, wallTop, rise, overhang, wallMaterial, roofMaterial, bandMaterial,
}: GableRoofOptions) {
  const gable = new THREE.Shape();
  // The gable fills the roof from below; coplanar top faces otherwise
  // z-fight and expose pale wall stripes across the shingles.
  gable.moveTo(-depth / 2, wallTop - GEOMETRY.gableInset);
  gable.lineTo(0, wallTop + rise - GEOMETRY.gableInset);
  gable.lineTo(depth / 2, wallTop - GEOMETRY.gableInset);
  gable.closePath();
  parent.add(prism(gable, width, wallMaterial, `${name}-gable`));

  const roof = new THREE.Group();
  roof.name = `${name}-roof`;
  parent.add(roof);
  const halfDepth = depth / 2 + overhang;
  const roofWidth = width + overhang * 2;
  const slope = rise / (depth / 2);
  const ridge = wallTop + rise;
  const heightAt = (distance: number) => ridge - slope * distance;

  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, ridge);
    shape.lineTo(side * halfDepth, heightAt(halfDepth));
    shape.lineTo(side * halfDepth, heightAt(halfDepth) - GEOMETRY.roofThickness);
    shape.lineTo(0, ridge - GEOMETRY.roofThickness);
    shape.closePath();
    roof.add(prism(shape, roofWidth, roofMaterial, `${name}-roof-slope`));

    if (bandMaterial) {
      const slopeScale = Math.hypot(1, slope);
      for (let along = GEOMETRY.bandSpacing; along < halfDepth * slopeScale - GEOMETRY.bandEndClearance; along += GEOMETRY.bandSpacing) {
        const center = along / slopeScale;
        const start = Math.max(0, center - GEOMETRY.bandHalfWidth);
        const end = Math.min(halfDepth, center + GEOMETRY.bandHalfWidth);
        const band = new THREE.Shape();
        band.moveTo(side * start, heightAt(start) + GEOMETRY.bandTopOffset);
        band.lineTo(side * end, heightAt(end) + GEOMETRY.bandTopOffset);
        band.lineTo(side * end, heightAt(end) - GEOMETRY.bandBottomOffset);
        band.lineTo(side * start, heightAt(start) - GEOMETRY.bandBottomOffset);
        band.closePath();
        roof.add(prism(band, roofWidth, bandMaterial, `${name}-shingle-band`));
      }
    }
  }
  return roof;
}
