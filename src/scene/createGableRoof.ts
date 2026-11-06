import * as THREE from 'three';

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
  gable.moveTo(-depth / 2, wallTop - 0.04);
  gable.lineTo(0, wallTop + rise - 0.04);
  gable.lineTo(depth / 2, wallTop - 0.04);
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
    shape.lineTo(side * halfDepth, heightAt(halfDepth) - 0.14);
    shape.lineTo(0, ridge - 0.14);
    shape.closePath();
    roof.add(prism(shape, roofWidth, roofMaterial, `${name}-roof-slope`));

    if (bandMaterial) {
      const slopeScale = Math.hypot(1, slope);
      for (let along = 0.45; along < halfDepth * slopeScale - 0.1; along += 0.45) {
        const center = along / slopeScale;
        const start = Math.max(0, center - 0.06);
        const end = Math.min(halfDepth, center + 0.06);
        const band = new THREE.Shape();
        band.moveTo(side * start, heightAt(start) + 0.1);
        band.lineTo(side * end, heightAt(end) + 0.1);
        band.lineTo(side * end, heightAt(end) - 0.02);
        band.lineTo(side * start, heightAt(start) - 0.02);
        band.closePath();
        roof.add(prism(band, roofWidth, bandMaterial, `${name}-shingle-band`));
      }
    }
  }
  return roof;
}
