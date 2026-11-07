import * as THREE from 'three';
import { createVisualRandom } from './createVisualRandom';

// Grass beside the trees, stream and pond. Each loop and its projection stay
// on the island, away from buildings and the stair rim.
const HOMES = [
  [-2.8, 2.7, 1.2], [1.3, 3.4, 1.2], [4.9, 3.1, 1.2], [6.2, -3.6, 0.7],
  [-5.0, 1.4, 0.9], [4.1, 5.0, 1.2], [-0.8, 2.8, 1.2], [-4.3, 1.1, 1.2],
  [1.4, 5.4, 1.2], [5.1, 0.6, 1.2], [-3.8, 3.9, 1.2], [-5.0, 3.0, 0.9],
  [5.8, -1.5, 0.9], [0.2, 2.7, 1.2],
] as const;

interface FireflyOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  groundHeight: number;
  random?: () => number;
}

/** A single unlit instanced draw, with independent opacity and motion per mote. */
export function createFireflies({ scene, camera, groundHeight, random = createVisualRandom(0x464c4945) }: FireflyOptions) {
  const between = (min: number, max: number) => min + (max - min) * random();
  const motes = HOMES.map(([x, z, maxRadius]) => {
    // Reserve room for the vertical bob within a 1.2-unit 3-D loop radius.
    const radius = between(0.5, Math.min(maxRadius, 1.19));
    return {
      x: x + between(-0.08, 0.08), z: z + between(-0.08, 0.08), radius,
      height: between(0.75, 1.35), heightAmplitude: between(0.08, 0.12),
      angularSpeed: between(0.16, 0.29) / radius, motionPhase: between(0, Math.PI * 2),
      heightPhase: between(0, Math.PI * 2), pulsePeriod: between(2.5, 4.5), pulsePhase: between(0, Math.PI * 2),
    };
  });

  const geometry = new THREE.PlaneGeometry(0.22, 0.22);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(motes.length), 1)
    .setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceOpacity', opacity);
  const material = new THREE.ShaderMaterial({
    uniforms: { coreColor: { value: new THREE.Color(0xf2e27a) } },
    vertexShader: `
      attribute float instanceOpacity;
      varying float moteOpacity;
      void main() {
        moteOpacity = instanceOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 coreColor;
      varying float moteOpacity;
      void main() {
        gl_FragColor = vec4(coreColor, moteOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, motes.length);
  mesh.name = 'night-fireflies';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.raycast = () => {};
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  const cameraRotation = new THREE.Quaternion();
  let elapsed = 0;

  function update(deltaSeconds: number, nightAmount: number, rainAmount: number, cloudyAmount: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 ||
      [nightAmount, rainAmount, cloudyAmount].some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 1) ||
      rainAmount + cloudyAmount > 1 + 1e-9) {
      throw new RangeError('Fireflies need non-negative elapsed time and valid phase/weather amounts');
    }
    elapsed += deltaSeconds;
    mesh.visible = nightAmount > 0;
    camera.getWorldQuaternion(cameraRotation);
    dummy.quaternion.copy(cameraRotation);
    for (const [index, mote] of motes.entries()) {
      // A closed 3-D Lissajous: circular horizontal orbit and a gentle bob,
      // with an upper speed bound below 0.35 units/s including the bob.
      const angle = mote.motionPhase + elapsed * mote.angularSpeed;
      dummy.position.set(
        mote.x + mote.radius * Math.cos(angle),
        groundHeight + mote.height + mote.heightAmplitude * Math.sin(2 * angle + mote.heightPhase),
        mote.z + mote.radius * Math.sin(angle),
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      const pulse = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(elapsed * Math.PI * 2 / mote.pulsePeriod + mote.pulsePhase));
      // Six survive rain, four more survive cloud, and four are clear-only.
      // The weather envelopes fade each group instead of popping on a mode change.
      const weatherWeight = index < 6 ? 1 : index < 10 ? 1 - rainAmount : Math.max(0, 1 - rainAmount - cloudyAmount);
      opacity.setX(index, pulse * nightAmount * (1 - 0.4 * rainAmount) * weatherWeight);
    }
    mesh.instanceMatrix.needsUpdate = true;
    opacity.needsUpdate = true;
  }

  function dispose() {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  update(0, 0, 0, 0);
  return { update, dispose };
}
