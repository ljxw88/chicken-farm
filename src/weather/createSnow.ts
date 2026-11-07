import * as THREE from 'three';
import { SNOW_LOOK } from '../content/snowSettings';
import { SNOW_VISUAL } from '../content/weatherVisual';

export { SNOW_LOOK } from '../content/snowSettings';

interface SnowOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  anchor: THREE.Object3D;
  groundHeight: number;
  random?: () => number;
}

/** Independent, camera-facing square flakes in the same following field as rain. */
export function createSnow({ scene, camera, anchor, groundHeight, random = Math.random }: SnowOptions) {
  const root = new THREE.Group();
  root.name = 'weather-snow';
  scene.add(root);

  const between = (min: number, max: number) => min + (max - min) * random();
  const halfField = SNOW_LOOK.fieldWidth / 2;
  const flakes = Array.from({ length: SNOW_LOOK.flakeCount }, () => ({
    x: between(-halfField, halfField),
    y: between(0, SNOW_LOOK.fieldHeight),
    z: between(-halfField, halfField),
    speed: between(SNOW_LOOK.fallSpeedMin, SNOW_LOOK.fallSpeedMax),
    size: between(SNOW_LOOK.sizeMin, SNOW_LOOK.sizeMax),
    period: between(SNOW_LOOK.swayPeriodMin, SNOW_LOOK.swayPeriodMax),
    phase: between(0, Math.PI * 2),
  }));

  const geometry = new THREE.PlaneGeometry(...SNOW_VISUAL.plane);
  const material = new THREE.MeshBasicMaterial({
    color: SNOW_LOOK.color, transparent: true, opacity: SNOW_VISUAL.initialOpacity, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, flakes.length);
  mesh.name = 'snow-flakes';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.raycast = () => {};
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(mesh);

  const anchorPosition = new THREE.Vector3();
  const cameraRotation = new THREE.Quaternion();
  const dummy = new THREE.Object3D();
  const wrap = (value: number, size: number) => ((value % size) + size) % size;
  anchor.getWorldPosition(anchorPosition);
  root.position.set(anchorPosition.x, groundHeight, anchorPosition.z);
  let elapsed = 0;

  function update(deltaSeconds: number, amount: number, nightAmount: number) {
    anchor.getWorldPosition(anchorPosition);
    const anchorDeltaX = anchorPosition.x - root.position.x;
    const anchorDeltaZ = anchorPosition.z - root.position.z;
    root.position.set(anchorPosition.x, groundHeight, anchorPosition.z);
    material.opacity = SNOW_LOOK.opacity * amount * (1 - (1 - SNOW_LOOK.nightOpacityMultiplier) * nightAmount);
    mesh.visible = amount > 0;
    if (amount === 0) return;

    elapsed += deltaSeconds;
    camera.getWorldQuaternion(cameraRotation);
    dummy.quaternion.copy(cameraRotation);
    for (const [index, flake] of flakes.entries()) {
      const fall = flake.speed * deltaSeconds;
      flake.x = wrap(flake.x - anchorDeltaX + SNOW_LOOK.windX * fall * SNOW_LOOK.windDriftPerFall + halfField, SNOW_LOOK.fieldWidth) - halfField;
      flake.z = wrap(flake.z - anchorDeltaZ + SNOW_LOOK.windZ * fall * SNOW_LOOK.windDriftPerFall + halfField, SNOW_LOOK.fieldWidth) - halfField;
      flake.y = wrap(flake.y - fall, SNOW_LOOK.fieldHeight);
      const sway = SNOW_LOOK.swayAmplitude * Math.sin(flake.phase + elapsed * Math.PI * 2 / flake.period);
      // Sway across the wind, independently of the slow downwind drift.
      dummy.position.set(
        wrap(flake.x - SNOW_LOOK.windZ * sway + halfField, SNOW_LOOK.fieldWidth) - halfField,
        flake.y,
        wrap(flake.z + SNOW_LOOK.windX * sway + halfField, SNOW_LOOK.fieldWidth) - halfField,
      );
      dummy.scale.set(flake.size, flake.size, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    scene.remove(root);
    mesh.dispose();
    geometry.dispose();
    material.dispose();
  }

  return { update, dispose };
}
