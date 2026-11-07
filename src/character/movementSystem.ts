import * as THREE from 'three';
import type { CoreComponents, EntityWorld, Transform } from '../core/ecs';
import type { MoveAction } from '../core/input';
import { moveWithFarmCollisions, type FarmBounds, type FarmObstacle } from './farmCollisions';
import {
  stairCharacterHeight, stairFloorHeight, stairSupports, slideStairPadCorner, slideStairTopEntry, type StairSurface,
} from './stairSurface';

export interface CharacterMotion {
  radius: number;
  groundHeight: number;
  bounds: FarmBounds;
  target: [number, number, number] | null;
  waypoints?: [number, number, number][];
  floorHeight: number;
}

export interface CharacterComponents extends CoreComponents {
  transform?: Transform;
  character?: CharacterMotion;
  obstacle?: FarmObstacle;
  stairSurface?: StairSurface;
}

export type BridgeHeight = (x: number, z: number, radius?: number) => number | undefined;

const WALK_SPEED = 3.5;
const UP = new THREE.Vector3(0, 1, 0);

/** Variable-frame movement over Miniplex character, obstacle and surface entities. */
export function createMovementSystem(camera: THREE.Camera, bridgeHeight?: BridgeHeight) {
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const target = new THREE.Vector3();
  const position = new THREE.Vector3();

  return (world: EntityWorld<CharacterComponents>, move: MoveAction, deltaSeconds: number) => {
    const obstacles = [...world.with('obstacle')].map((entity) => entity.obstacle);
    const surface = [...world.with('stairSurface')][0]?.stairSurface;
    for (const entity of world.with('character', 'transform')) {
      const motion = entity.character;
      const transform = entity.transform;
      const coordinates = transform.position;
      position.set(coordinates[0], coordinates[1], coordinates[2]);
      const startX = position.x;
      const startZ = position.z;
      let step = 0;
      let movingToTarget = false;

      if (move.active) {
        if (move.forward !== 0 || move.right !== 0) {
          camera.getWorldDirection(forward).setY(0).normalize();
          right.crossVectors(forward, UP).normalize();
          direction.copy(forward).multiplyScalar(move.forward).addScaledVector(right, move.right).normalize();
          step = WALK_SPEED * deltaSeconds;
        }
      } else if (motion.target) {
        target.set(motion.target[0], motion.target[1], motion.target[2]);
        direction.subVectors(target, position).setY(0);
        const distance = direction.length();
        if (distance > 0.0001) {
          direction.multiplyScalar(1 / distance);
          step = Math.min(WALK_SPEED * deltaSeconds, distance);
          movingToTarget = true;
        } else motion.target = motion.waypoints?.shift() ?? null;
      }

      const next = moveWithFarmCollisions(
        startX, startZ, direction.x * step, direction.z * step, motion.radius, obstacles, motion.bounds,
        surface && ((x, z, radius) => stairSupports(surface, x, z, radius)),
        surface && ((x, z, radius, distance, directionX) => directionX < 0
          ? slideStairPadCorner(surface, x, z, radius, distance)
          : slideStairTopEntry(surface, x, z, radius, distance)),
      );
      coordinates[0] = next.x;
      const bridgeFloor = bridgeHeight?.(next.x, next.z);
      const bridgeCapsule = bridgeHeight?.(next.x, next.z, motion.radius);
      motion.floorHeight = bridgeFloor ?? (surface && stairFloorHeight(surface, next.x)) ?? motion.groundHeight;
      coordinates[1] = bridgeCapsule ?? (surface && stairCharacterHeight(surface, next.x, motion.radius)) ?? motion.groundHeight;
      coordinates[2] = next.z;
      const movedX = coordinates[0] - startX;
      const movedZ = coordinates[2] - startZ;
      const moving = Math.hypot(movedX, movedZ) > 0.000001;
      if (moving) transform.yaw = Math.atan2(movedX, movedZ);
      if (movingToTarget && step > 0) {
        if (!moving) {
          motion.target = null;
          motion.waypoints = [];
        } else if (Math.hypot(target.x - coordinates[0], target.z - coordinates[2]) < 0.0001) {
          motion.target = motion.waypoints?.shift() ?? null;
        }
      }
    }
  };
}
