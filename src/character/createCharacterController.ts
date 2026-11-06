import * as THREE from 'three';
import type { Entity, EntityWorld } from '../core/ecs';
import type { InputActions, MoveAction } from '../core/input';
import type { StoneStairs } from '../scene/createStoneStairs';
import type { FarmObstacle } from './farmCollisions';
import { createMovementSystem, type BridgeHeight, type CharacterComponents } from './movementSystem';
import { stairTarget } from './stairSurface';

interface CharacterControllerOptions {
  world: EntityWorld<CharacterComponents>;
  input: InputActions;
  character: THREE.Object3D;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  ground: THREE.Mesh;
  groundSize: number;
  groundHeight: number;
  characterRadius: number;
  obstacles?: readonly FarmObstacle[];
  stairs?: StoneStairs;
  bridgeHeight?: BridgeHeight;
  groundShadow?: THREE.Object3D;
}

/** Three.js input/pose adapter around the sole Miniplex movement implementation. */
export function createCharacterController({
  world, input, character, camera, canvas, ground, groundSize, groundHeight, characterRadius,
  obstacles = [], stairs, bridgeHeight, groundShadow,
}: CharacterControllerOptions) {
  const halfSize = groundSize / 2;
  const limit = halfSize - characterRadius;
  const bounds = stairs?.bounds ?? { minX: -halfSize, maxX: halfSize, minZ: -halfSize, maxZ: halfSize };
  const entity = world.create({
    transform: { position: [character.position.x, character.position.y, character.position.z], yaw: character.rotation.y },
    character: { radius: characterRadius, groundHeight, bounds, target: null, floorHeight: groundHeight },
  });
  const surfaceEntity = stairs && world.create({ stairSurface: stairs.surface });
  const obstacleEntities = new Map<FarmObstacle, Entity<CharacterComponents>>();
  const movementSystem = createMovementSystem(camera, bridgeHeight);
  const surfaces = stairs ? [ground, ...stairs.treads, stairs.footPad] : [ground];
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const shadowOffset = groundShadow?.position.y ?? 0;
  const lastRendered = { x: character.position.x, y: character.position.y, z: character.position.z, yaw: character.rotation.y };

  function syncObstacles() {
    const current = new Set(obstacles);
    for (const [obstacle, obstacleEntity] of obstacleEntities) {
      if (!current.has(obstacle)) {
        world.remove(obstacleEntity);
        obstacleEntities.delete(obstacle);
      }
    }
    const worldObstacles = new Set([...world.with('obstacle')].map((entry) => entry.obstacle));
    for (const obstacle of obstacles) {
      // A placed fence already owns its collision component. The shared array
      // is only the compatibility view for scene/QA consumers in that case.
      if (!obstacleEntities.has(obstacle) && !worldObstacles.has(obstacle)) {
        obstacleEntities.set(obstacle, world.create({ obstacle }));
        worldObstacles.add(obstacle);
      }
    }
  }
  syncObstacles();

  function cancelTarget() {
    entity.character!.target = null;
  }

  const unsubscribe = input.onMovement((action) => {
    if (action.type === 'cancel-move-to') {
      cancelTarget();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pointer.set(
      ((action.point.x - rect.left) / rect.width) * 2 - 1,
      -((action.point.y - rect.top) / rect.height) * 2 + 1,
    );
    camera.updateMatrixWorld();
    surfaces.forEach((surface) => surface.updateWorldMatrix(true, false));
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(surfaces)[0];
    if (!hit) return;

    if (hit.object === ground) {
      entity.character!.target = [
        THREE.MathUtils.clamp(hit.point.x, -limit, limit), groundHeight,
        THREE.MathUtils.clamp(hit.point.z, -limit, limit),
      ];
    } else {
      // Only tread and pad tops are destinations; don't walk through a riser.
      if (!stairs || !hit.face || hit.face.normal.y < 0.5) return;
      const destination = stairTarget(stairs.surface, hit.point.x, hit.point.z, characterRadius);
      entity.character!.target = [destination.x, groundHeight, destination.z];
    }
  });

  function syncExternalPose() {
    const transform = entity.transform!;
    // The existing scene and QA seam can still move the mesh externally.
    // Otherwise the entity remains authoritative and is rendered below.
    if (!Object.is(character.position.x, lastRendered.x) || !Object.is(character.position.y, lastRendered.y) ||
        !Object.is(character.position.z, lastRendered.z)) {
      transform.position[0] = character.position.x;
      transform.position[1] = character.position.y;
      transform.position[2] = character.position.z;
      lastRendered.x = character.position.x;
      lastRendered.y = character.position.y;
      lastRendered.z = character.position.z;
    }
    if (!Object.is(character.rotation.y, lastRendered.yaw)) {
      transform.yaw = character.rotation.y;
      lastRendered.yaw = character.rotation.y;
    }
  }

  function system(systemWorld: EntityWorld<CharacterComponents>, move: MoveAction, deltaSeconds: number) {
    if (systemWorld !== world) throw new Error('Character system must run in its own world');
    const transform = entity.transform!;
    syncExternalPose();
    syncObstacles();
    movementSystem(world, move, deltaSeconds);
    character.position.x = transform.position[0];
    character.position.y = transform.position[1];
    character.position.z = transform.position[2];
    if (!Object.is(character.rotation.y, transform.yaw)) character.rotation.y = transform.yaw;
    if (groundShadow) groundShadow.position.y = shadowOffset + entity.character!.floorHeight - character.position.y;
    lastRendered.x = character.position.x;
    lastRendered.y = character.position.y;
    lastRendered.z = character.position.z;
    lastRendered.yaw = character.rotation.y;
  }

  function update(deltaSeconds: number) {
    system(world, input.movement(), deltaSeconds);
  }

  function dispose() {
    unsubscribe();
    cancelTarget();
    world.remove(entity);
    if (surfaceEntity) world.remove(surfaceEntity);
    for (const obstacleEntity of obstacleEntities.values()) world.remove(obstacleEntity);
    obstacleEntities.clear();
  }

  return { system, update, cancelTarget, syncExternalPose, syncObstacles, dispose, entity };
}
