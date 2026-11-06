import * as THREE from 'three';
import type { FarmObstacle } from '../character/farmCollisions';
import type { Entity, EntityWorld } from '../core/ecs';
import type { InputActions, PlacementAction } from '../core/input';
import { createPlacementControls } from './createPlacementControls';
import { createPlacementVisual, disposePlacementVisual, makeGhost } from './createPlacementVisual';
import { TILE_SIZE } from './grid';
import { createPlacementSystem, type PlacementComponents, type PlacementHit } from './placementSystem';

interface PlacementAdapterOptions {
  world: EntityWorld<PlacementComponents>;
  input: InputActions;
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  ground: THREE.Object3D;
  groundSize: number;
  groundHeight: number;
  // The legacy scene/QA obstacle view mirrors fence components; it is not the
  // source of placement or walking collisions for placed entities.
  obstacles: FarmObstacle[];
  syncObstacles: () => void;
  syncCharacter: () => void;
  getBlockers?: () => readonly THREE.Object3D[];
  debugGrid?: boolean;
  onActiveChange?: (active: boolean) => void;
}

const VALID_WASH = new THREE.Color(0x283724);
const INVALID_WASH = new THREE.Color(0xc45a3a);
const GHOST_LIFT = 0.08;

/** Resolve pointer rays and render the placement entities, without owning gameplay state. */
export function createPlacementAdapter({
  world, input, scene, camera, canvas, ground, groundSize, groundHeight,
  obstacles, syncObstacles, syncCharacter, getBlockers = () => [], debugGrid = false, onActiveChange,
}: PlacementAdapterOptions) {
  const system = createPlacementSystem(world, groundSize, groundHeight);
  const { state, grid } = system;
  const layer = new THREE.Group();
  layer.name = 'placement-layer';
  scene.add(layer);

  const linePositions: number[] = [];
  for (let i = 0; i <= grid.count; i++) {
    const coordinate = grid.min + i * TILE_SIZE;
    linePositions.push(coordinate, groundHeight + 0.035, grid.min, coordinate, groundHeight + 0.035, grid.max);
    linePositions.push(grid.min, groundHeight + 0.035, coordinate, grid.max, groundHeight + 0.035, coordinate);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const gridMaterial = new THREE.LineBasicMaterial({ color: 0xa67c52, transparent: true, opacity: 0.7, depthWrite: false });
  const gridLines = new THREE.LineSegments(gridGeometry, gridMaterial);
  gridLines.name = 'placement-debug-grid';
  gridLines.visible = debugGrid;
  layer.add(gridLines);

  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: VALID_WASH, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  wash.name = 'placement-wash';
  wash.rotation.x = -Math.PI / 2;
  wash.renderOrder = 1;
  wash.visible = false;
  layer.add(wash);

  const view = createPlacementControls();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const blockerBounds = new THREE.Box3();
  const blockerEntities = new Map<THREE.Object3D, Entity<PlacementComponents>>();
  const visuals = new Map<string, THREE.Group>();
  const mirroredObstacles = new Map<string, FarmObstacle>();
  let ghost: THREE.Group | undefined;
  let ghostRevision = -1;
  let disposed = false;

  function syncSceneInputs() {
    syncCharacter();
    syncObstacles();
    const objects = getBlockers();
    const current = new Set(objects);
    for (const [object, entity] of blockerEntities) {
      if (!current.has(object)) {
        world.remove(entity);
        blockerEntities.delete(object);
      }
    }
    for (const object of objects) {
      object.updateWorldMatrix(true, true);
      blockerBounds.setFromObject(object);
      const previous = blockerEntities.get(object);
      if (blockerBounds.isEmpty()) {
        if (previous) world.remove(previous);
        blockerEntities.delete(object);
        continue;
      }
      const blocker: FarmObstacle = {
        kind: 'box', name: 'world-object', minX: blockerBounds.min.x, maxX: blockerBounds.max.x,
        minZ: blockerBounds.min.z, maxZ: blockerBounds.max.z,
      };
      if (previous) Object.assign(previous.placementBlocker!, blocker);
      else blockerEntities.set(object, world.create({ placementBlocker: blocker }));
    }
  }

  function hit(point: { x: number; y: number } | null): PlacementHit {
    if (!point) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    pointer.set(((point.x - rect.left) / rect.width) * 2 - 1, -((point.y - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    ground.updateWorldMatrix(true, true);
    raycaster.setFromCamera(pointer, camera);
    const result = raycaster.intersectObject(ground, true)[0];
    return result ? { x: result.point.x, z: result.point.z } : null;
  }

  function render() {
    const items = [...world.with('placed', 'transform')].sort((a, b) => a.placed.sequence - b.placed.sequence);
    const ids = new Set(items.map((item) => item.id));
    for (const [id, visual] of visuals) {
      if (!ids.has(id)) {
        disposePlacementVisual(visual);
        visuals.delete(id);
      }
    }
    for (const [id, obstacle] of mirroredObstacles) {
      if (!ids.has(id)) {
        const index = obstacles.indexOf(obstacle);
        if (index !== -1) obstacles.splice(index, 1);
        mirroredObstacles.delete(id);
      }
    }
    for (const item of items) {
      if (!visuals.has(item.id)) {
        const visual = createPlacementVisual(item.placed.kind);
        visual.name = `placed-${item.placed.kind}`;
        visual.position.set(...item.transform.position);
        visual.rotation.y = item.transform.yaw;
        layer.add(visual);
        visuals.set(item.id, visual);
      }
      if (item.obstacle && !mirroredObstacles.has(item.id)) {
        obstacles.push(item.obstacle);
        mirroredObstacles.set(item.id, item.obstacle);
      }
    }

    if (state.kind && ghostRevision !== state.ghostRevision) {
      if (ghost) disposePlacementVisual(ghost);
      ghost = createPlacementVisual(state.kind);
      ghost.name = 'placement-ghost';
      makeGhost(ghost);
      layer.add(ghost);
      ghostRevision = state.ghostRevision;
    } else if (!state.kind && ghost) {
      disposePlacementVisual(ghost);
      ghost = undefined;
    }

    if (state.kind && state.removing) {
      if (ghost) ghost.visible = false;
      const item = state.hoveredId && world.get(state.hoveredId)?.placed;
      wash.visible = Boolean(item);
      if (item) {
        wash.position.set(item.area.centerX, groundHeight + 0.17, item.area.centerZ);
        wash.scale.set(item.area.columns * TILE_SIZE, item.area.rows * TILE_SIZE, 1);
        wash.material.color.copy(INVALID_WASH);
      }
    } else if (state.kind && state.area && ghost) {
      const { area } = state;
      ghost.position.set(area.centerX, groundHeight + GHOST_LIFT, area.centerZ);
      ghost.rotation.y = state.rotation * Math.PI / 2;
      ghost.visible = true;
      wash.position.set(area.centerX, groundHeight + 0.06, area.centerZ);
      wash.scale.set(area.columns * TILE_SIZE, area.rows * TILE_SIZE, 1);
      wash.material.color.copy(state.valid ? VALID_WASH : INVALID_WASH);
      wash.visible = true;
    } else {
      if (ghost) ghost.visible = false;
      wash.visible = false;
    }
    view.update({ kind: state.kind ?? undefined, message: state.message, valid: state.valid, removing: state.removing,
      canRemove: state.removing || items.length > 0, canUndo: items.length > 0 });
  }

  function update() {
    if (disposed) return;
    syncSceneInputs();
    system.update(hit(state.pointer));
    render();
  }

  const unsubscribe = input.onPlacement((action: PlacementAction) => {
    if (disposed) return;
    const wasActive = Boolean(state.kind);
    syncSceneInputs();
    system.dispatch(action, hit(action.type === 'placement-preview' ? action.point : state.pointer));
    if (wasActive !== Boolean(state.kind)) onActiveChange?.(Boolean(state.kind));
    render();
  });
  update();

  function dispose() {
    if (disposed) return;
    if (state.kind) {
      system.dispatch({ type: 'placement-cancel' }, null);
      onActiveChange?.(false);
    }
    for (const item of [...world.with('placed')]) world.remove(item);
    render();
    disposed = true;
    unsubscribe();
    for (const entity of blockerEntities.values()) world.remove(entity);
    blockerEntities.clear();
    world.remove(system.entity);
    gridGeometry.dispose();
    gridMaterial.dispose();
    wash.geometry.dispose();
    wash.material.dispose();
    layer.removeFromParent();
    view.dispose();
  }

  return { update, isActive: () => Boolean(state.kind), isRemoving: () => state.removing, dispose };
}
