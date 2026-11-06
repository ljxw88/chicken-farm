import * as THREE from 'three';
import type { FarmObstacle } from '../character/farmCollisions';
import { RAIN_LOOK } from './rainSettings';

interface RainEffectOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  anchor: THREE.Object3D;
  groundHeight: number;
  groundSize: number;
  splashExclusions: readonly FarmObstacle[];
  random?: () => number;
}

export function createRainEffect({
  scene, camera, anchor, groundHeight, groundSize, splashExclusions, random = Math.random,
}: RainEffectOptions) {
  const root = new THREE.Group();
  root.name = 'weather-rain';
  const cloud = new THREE.Group();
  root.add(cloud);
  scene.add(root);

  const positions = new Float32Array(RAIN_LOOK.streakCount * 6);
  const xPositions = new Float32Array(RAIN_LOOK.streakCount);
  const yPositions = new Float32Array(RAIN_LOOK.streakCount);
  const zPositions = new Float32Array(RAIN_LOOK.streakCount);
  const speeds = new Float32Array(RAIN_LOOK.streakCount);
  const lengths = new Float32Array(RAIN_LOOK.streakCount);
  const halfField = RAIN_LOOK.fieldWidth / 2;
  const between = (min: number, max: number) => min + (max - min) * random();

  for (let i = 0; i < RAIN_LOOK.streakCount; i++) {
    xPositions[i] = between(-halfField, halfField);
    yPositions[i] = between(0, RAIN_LOOK.fieldHeight);
    zPositions[i] = between(-halfField, halfField);
    speeds[i] = between(RAIN_LOOK.fallSpeedMin, RAIN_LOOK.fallSpeedMax);
    lengths[i] = between(RAIN_LOOK.streakLengthMin, RAIN_LOOK.streakLengthMax);
  }

  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const material = new THREE.LineBasicMaterial({
    color: RAIN_LOOK.color, transparent: true, opacity: 0, depthWrite: false,
  });
  const streaks = new THREE.LineSegments(geometry, material);
  streaks.name = 'rain-streaks';
  streaks.frustumCulled = false;
  streaks.visible = false;
  cloud.add(streaks);

  const ringGeometry = new THREE.RingGeometry(RAIN_LOOK.splashInnerRadiusRatio, 1, RAIN_LOOK.splashSegments);
  const splashes = Array.from({ length: RAIN_LOOK.splashCapacity }, (_, index) => {
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: RAIN_LOOK.color, transparent: true, opacity: 0, depthWrite: false,
    });
    const mesh = new THREE.Mesh(ringGeometry, ringMaterial);
    mesh.name = `rain-splash-${index + 1}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    root.add(mesh);
    return { mesh, material: ringMaterial, age: 0, lifetime: 0 };
  });

  const anchorPosition = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const screenRight = new THREE.Vector3();
  anchor.getWorldPosition(anchorPosition);
  cloud.position.set(anchorPosition.x, groundHeight, anchorPosition.z);

  function isExcluded(x: number, z: number) {
    const margin = RAIN_LOOK.splashRadiusMax + RAIN_LOOK.splashSafetyMargin;
    const groundLimit = groundSize / 2 - margin;
    if (Math.abs(x) > groundLimit || Math.abs(z) > groundLimit) return true;
    return splashExclusions.some((obstacle) => {
      if (obstacle.kind === 'circle') {
        return Math.hypot(x - obstacle.x, z - obstacle.z) <= obstacle.radius + margin;
      }
      return x >= obstacle.minX - margin && x <= obstacle.maxX + margin &&
        z >= obstacle.minZ - margin && z <= obstacle.maxZ + margin;
    });
  }

  function spawnSplash(x: number, z: number, amount: number) {
    if (isExcluded(x, z)) return;
    const splash = splashes.find((item) => !item.mesh.visible);
    if (!splash) return;
    splash.age = 0;
    splash.lifetime = between(RAIN_LOOK.splashLifetimeMin, RAIN_LOOK.splashLifetimeMax);
    splash.mesh.position.set(x, groundHeight + RAIN_LOOK.splashHeight, z);
    splash.mesh.scale.setScalar(RAIN_LOOK.splashRadiusMin);
    splash.material.opacity = RAIN_LOOK.splashOpacity * amount;
    splash.mesh.visible = true;
  }

  const wrap = (value: number, size: number) => ((value % size) + size) % size;

  function update(deltaSeconds: number, amount: number) {
    anchor.getWorldPosition(anchorPosition);
    const anchorDeltaX = anchorPosition.x - cloud.position.x;
    const anchorDeltaZ = anchorPosition.z - cloud.position.z;
    cloud.position.set(anchorPosition.x, groundHeight, anchorPosition.z);
    material.opacity = RAIN_LOOK.opacity * amount;
    streaks.visible = amount > 0;

    if (amount === 0) {
      for (const splash of splashes) splash.mesh.visible = false;
      return;
    }

    for (const splash of splashes) {
      if (!splash.mesh.visible) continue;
      splash.age += deltaSeconds;
      if (splash.age >= splash.lifetime) {
        splash.mesh.visible = false;
        continue;
      }
      const age = splash.age / splash.lifetime;
      splash.mesh.scale.setScalar(THREE.MathUtils.lerp(RAIN_LOOK.splashRadiusMin, RAIN_LOOK.splashRadiusMax, age));
      splash.material.opacity = RAIN_LOOK.splashOpacity * amount * (1 - age);
    }

    // World vertical is foreshortened in the isometric view. Adjust horizontal
    // drift so the streaks appear tilted by the requested angle on screen.
    camera.getWorldDirection(forward);
    screenRight.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const verticalProjection = Math.sqrt(Math.max(0, 1 - forward.y * forward.y));
    const drift = Math.tan(THREE.MathUtils.degToRad(RAIN_LOOK.streakTiltDegrees)) * verticalProjection;

    for (let i = 0; i < RAIN_LOOK.streakCount; i++) {
      const fall = speeds[i] * deltaSeconds;
      const x = wrap(xPositions[i] - anchorDeltaX + screenRight.x * fall * drift + halfField, RAIN_LOOK.fieldWidth) - halfField;
      const z = wrap(zPositions[i] - anchorDeltaZ + screenRight.z * fall * drift + halfField, RAIN_LOOK.fieldWidth) - halfField;
      let y = yPositions[i] - fall;
      if (y <= 0) {
        // Avoid a burst of old impacts after a background tab resumes.
        if (deltaSeconds <= RAIN_LOOK.maxSplashFrameSeconds && random() < RAIN_LOOK.splashChancePerImpact * amount) {
          spawnSplash(anchorPosition.x + x, anchorPosition.z + z, amount);
        }
        y = wrap(y, RAIN_LOOK.fieldHeight);
      }
      xPositions[i] = x;
      yPositions[i] = y;
      zPositions[i] = z;
      const offset = i * 6;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      positions[offset + 3] = x + screenRight.x * lengths[i] * drift;
      positions[offset + 4] = y - lengths[i];
      positions[offset + 5] = z + screenRight.z * lengths[i] * drift;
    }
    attribute.needsUpdate = true;
  }

  function dispose() {
    scene.remove(root);
    geometry.dispose();
    material.dispose();
    ringGeometry.dispose();
    for (const splash of splashes) splash.material.dispose();
  }

  return { update, dispose };
}
