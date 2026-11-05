import * as THREE from 'three';
import { moveWithFarmCollisions, type FarmObstacle } from '../scene/farmCollisions';

interface CharacterControlsOptions {
  character: THREE.Object3D;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  ground: THREE.Mesh;
  groundSize: number;
  groundHeight: number;
  characterRadius: number;
  obstacles?: readonly FarmObstacle[];
}

const WALK_SPEED = 3.5;
const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const UP = new THREE.Vector3(0, 1, 0);

export function createCharacterControls({
  character,
  camera,
  canvas,
  ground,
  groundSize,
  groundHeight,
  characterRadius,
  obstacles = [],
}: CharacterControlsOptions) {
  const keys = new Set<string>();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const target = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const limit = groundSize / 2 - characterRadius;
  let hasTarget = false;

  function handleKeyDown(event: KeyboardEvent) {
    if (!MOVEMENT_KEYS.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    const element = event.target;
    if (element instanceof HTMLElement &&
      (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))) return;

    event.preventDefault();
    keys.add(event.code);
    hasTarget = false;
  }

  function handleKeyUp(event: KeyboardEvent) {
    keys.delete(event.code);
  }

  function handlePointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || keys.size > 0) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    camera.updateMatrixWorld();
    ground.updateWorldMatrix(true, false);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(ground)[0];
    if (!hit) return;

    target.set(
      THREE.MathUtils.clamp(hit.point.x, -limit, limit),
      groundHeight,
      THREE.MathUtils.clamp(hit.point.z, -limit, limit),
    );
    hasTarget = true;
  }

  function stop() {
    keys.clear();
    hasTarget = false;
  }

  function update(deltaSeconds: number) {
    const startX = character.position.x;
    const startZ = character.position.z;
    let step = 0;
    let movingToTarget = false;

    if (keys.size > 0) {
      const forwardInput = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const rightInput = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      if (forwardInput !== 0 || rightInput !== 0) {
        camera.getWorldDirection(forward).setY(0).normalize();
        right.crossVectors(forward, UP).normalize();
        direction.copy(forward).multiplyScalar(forwardInput).addScaledVector(right, rightInput).normalize();
        step = WALK_SPEED * deltaSeconds;
      }
    } else if (hasTarget) {
      direction.subVectors(target, character.position).setY(0);
      const distance = direction.length();
      if (distance > 0.0001) {
        direction.multiplyScalar(1 / distance);
        step = Math.min(WALK_SPEED * deltaSeconds, distance);
        movingToTarget = true;
      } else {
        hasTarget = false;
      }
    }

    const next = moveWithFarmCollisions(
      startX, startZ, direction.x * step, direction.z * step, characterRadius, obstacles,
    );
    character.position.x = THREE.MathUtils.clamp(next.x, -limit, limit);
    character.position.y = groundHeight;
    character.position.z = THREE.MathUtils.clamp(next.z, -limit, limit);
    const movedX = character.position.x - startX;
    const movedZ = character.position.z - startZ;
    const moving = Math.hypot(movedX, movedZ) > 0.000001;
    if (moving) character.rotation.y = Math.atan2(movedX, movedZ);
    if (movingToTarget && step > 0 && (
      !moving || Math.hypot(target.x - character.position.x, target.z - character.position.z) < 0.0001
    )) hasTarget = false;
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', stop);
  canvas.addEventListener('pointerdown', handlePointerDown);

  function dispose() {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', stop);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    stop();
  }

  return { update, dispose };
}
