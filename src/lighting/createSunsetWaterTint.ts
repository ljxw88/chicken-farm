import * as THREE from 'three';

type TintUniform = { value: number };
const waterUniforms = new WeakMap<THREE.MeshStandardMaterial, TintUniform>();

// Engineer: tint only reflected blue on pond/stream/fall materials, never the
// locked material hexes. The shared phase weight is zero at the other anchors.
export function createSunsetWaterTint(scene: THREE.Scene) {
  const uniforms = new Set<TintUniform>();
  const attach = (object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
    const material = object.material;
    let uniform = waterUniforms.get(material);
    if (!uniform) {
      uniform = { value: 0 };
      const amount = uniform;
      const previousCompile = material.onBeforeCompile;
      const previousKey = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        // The waterfall already has its own reflected-light shader.
        previousCompile.call(material, shader, renderer);
        shader.uniforms.sunsetWaterAmount = amount;
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
          '#include <common>\nuniform float sunsetWaterAmount;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
          'outgoingLight.b *= 1.0 + 0.20 * sunsetWaterAmount;\n#include <opaque_fragment>');
      };
      material.customProgramCacheKey = () => `${previousKey}|sunset-water`;
      material.needsUpdate = true;
      waterUniforms.set(material, uniform);
    }
    uniforms.add(uniform);
  };

  scene.getObjectByName('farm-pond')?.traverse(attach);
  scene.getObjectByName('farm-water-feature')?.traverse((object) => {
    // The bridge shares this group but must not receive the water tint.
    if (object.name.startsWith('farm-stream-') || object.name.startsWith('farm-waterfall-')) attach(object);
  });
  return (amount: number) => { for (const uniform of uniforms) uniform.value = amount; };
}
