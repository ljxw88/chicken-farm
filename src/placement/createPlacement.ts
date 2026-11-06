import * as THREE from 'three';
import type { FarmObstacle } from '../scene/farmCollisions';
import { createPlacementControls } from './createPlacementControls';
import { createPlacementVisual, disposePlacementVisual, makeGhost } from './createPlacementVisual';
import {
  cellKey, createGrid, fenceCollision, footprintCells, intersectsFootprint, TILE_SIZE,
  type Cell, type Footprint, type PlacementKind,
} from './grid';

interface PlacementOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  ground: THREE.Object3D;
  groundSize: number;
  groundHeight: number;
  character: THREE.Object3D;
  characterRadius: number;
  // The walking controls read this same array, so changes take effect immediately.
  obstacles: FarmObstacle[];
  getBlockers?: () => readonly THREE.Object3D[];
  debugGrid?: boolean;
  onActiveChange?: (active: boolean) => void;
}

interface PlacedItem {
  visual: THREE.Group;
  area: Footprint;
  cells: string[];
  collision?: FarmObstacle;
}

const VALID_WASH = new THREE.Color(0x283724);
const INVALID_WASH = new THREE.Color(0xc45a3a);
const GHOST_LIFT = 0.08;

export function createPlacement({
  scene, camera, canvas, ground, groundSize, groundHeight, character, characterRadius,
  obstacles, getBlockers = () => [], debugGrid = false, onActiveChange,
}: PlacementOptions) {
  const grid = createGrid(groundSize);
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

  // The wash occupies the full snapped footprint, so it remains legible after
  // the 4-CSS-pixel world pass. The actual ghost retains its wood/dirt material.
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: VALID_WASH, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  wash.name = 'placement-wash';
  wash.rotation.x = -Math.PI / 2;
  wash.renderOrder = 1;
  wash.visible = false;
  layer.add(wash);

  const placed: PlacedItem[] = [];
  const occupied = new Map<string, PlacedItem>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const characterPosition = new THREE.Vector3();
  const blockerBounds = new THREE.Box3();
  let lastPointer: { x: number; y: number } | undefined;
  let kind: PlacementKind | undefined;
  let rotation = 0;
  let ghost: THREE.Group | undefined;
  let tintGhost: ((color: THREE.Color) => void) | undefined;
  let cell: Cell | undefined;
  let area: Footprint | undefined;
  let valid = false;
  let removing = false;
  let nextId = 1;
  let disposed = false;

  function blockerIntersects(candidate: Footprint) {
    if (obstacles.some((obstacle) => intersectsFootprint(candidate, obstacle))) return true;
    for (const object of getBlockers()) {
      object.updateWorldMatrix(true, true);
      blockerBounds.setFromObject(object);
      if (blockerBounds.isEmpty()) continue;
      const blocker: FarmObstacle = {
        kind: 'box', name: 'world-object', minX: blockerBounds.min.x, maxX: blockerBounds.max.x,
        minZ: blockerBounds.min.z, maxZ: blockerBounds.max.z,
      };
      if (intersectsFootprint(candidate, blocker)) return true;
    }
    return false;
  }

  function validate(candidate: Footprint) {
    if (!grid.contains(candidate)) return 'Outside the buildable island';
    if (footprintCells(candidate).some((entry) => occupied.has(cellKey(entry)))) return 'Space already occupied';
    if (blockerIntersects(candidate)) return 'Blocked by a farm object';
    character.getWorldPosition(characterPosition);
    if (intersectsFootprint(candidate, {
      kind: 'circle', name: 'character', x: characterPosition.x, z: characterPosition.z, radius: characterRadius,
    })) return 'Move away from the footprint';
    return undefined;
  }

  function updateView(message: string) {
    view.update({ kind, message, valid, removing, canRemove: removing || placed.length > 0, canUndo: placed.length > 0 });
  }

  function update() {
    if (disposed) return;
    if (!kind || !ghost || !lastPointer) {
      cell = undefined;
      area = undefined;
      valid = false;
      if (ghost) ghost.visible = false;
      wash.visible = false;
      updateView(kind ? (removing ? 'Remove · Point at a placed tile' : 'Point at the island to preview') : '');
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointer.set(((lastPointer.x - rect.left) / rect.width) * 2 - 1, -((lastPointer.y - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    ground.updateWorldMatrix(true, true);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(ground, true)[0];
    if (!hit) {
      cell = undefined;
      area = undefined;
      valid = false;
      ghost.visible = false;
      wash.visible = false;
      updateView(removing ? 'Remove · Point at a placed tile' : 'Point at the island to preview');
      return;
    }

    cell = grid.cellAt(hit.point.x, hit.point.z);
    if (removing) {
      area = undefined;
      valid = false;
      ghost.visible = false;
      const item = occupied.get(cellKey(cell));
      wash.visible = Boolean(item);
      if (item) {
        // Above the shallow plot surface as well as the ground beneath fences.
        wash.position.set(item.area.centerX, groundHeight + 0.17, item.area.centerZ);
        wash.scale.set(item.area.columns * TILE_SIZE, item.area.rows * TILE_SIZE, 1);
        wash.material.color.copy(INVALID_WASH);
      }
      updateView(item ? 'Remove · Click or tap the highlighted tile' : 'Remove · Point at a placed tile');
      return;
    }
    area = grid.footprint(cell, kind, rotation);
    const reason = validate(area);
    valid = !reason;
    const color = valid ? VALID_WASH : INVALID_WASH;
    tintGhost?.(color);
    ghost.position.set(area.centerX, groundHeight + GHOST_LIFT, area.centerZ);
    ghost.rotation.y = rotation * Math.PI / 2;
    ghost.visible = true;
    wash.position.set(area.centerX, groundHeight + 0.06, area.centerZ);
    wash.scale.set(area.columns * TILE_SIZE, area.rows * TILE_SIZE, 1);
    wash.material.color.copy(color);
    wash.visible = true;
    const label = kind === 'fence' ? 'Fence' : 'Plot';
    updateView(`${label} · ${reason ?? 'Ready to place'}`);
  }

  function select(nextKind: PlacementKind) {
    if (disposed) return;
    const wasActive = Boolean(kind);
    if (ghost) disposePlacementVisual(ghost);
    kind = nextKind;
    rotation = 0;
    removing = false;
    ghost = createPlacementVisual(kind);
    ghost.name = 'placement-ghost';
    tintGhost = makeGhost(ghost);
    layer.add(ghost);
    if (!wasActive) onActiveChange?.(true);
    update();
  }

  function rotate() {
    if (!kind || removing) return;
    rotation = (rotation + 1) % 4;
    update();
  }

  function confirm() {
    if (!kind || removing) return;
    update(); // Never place using stale validity if the player or a blocker moved.
    if (!valid || !area) return;
    const visual = createPlacementVisual(kind);
    visual.name = `placed-${kind}`;
    visual.position.set(area.centerX, groundHeight, area.centerZ);
    visual.rotation.y = rotation * Math.PI / 2;
    layer.add(visual);
    const collision = kind === 'fence' ? fenceCollision(area, rotation, `placed-fence-${nextId++}`) : undefined;
    const item: PlacedItem = { visual, area, cells: footprintCells(area).map(cellKey), collision };
    if (collision) obstacles.push(collision);
    for (const key of item.cells) occupied.set(key, item);
    placed.push(item);
    update();
  }

  function removeItem(item: PlacedItem) {
    for (const key of item.cells) occupied.delete(key);
    if (item.collision) {
      const index = obstacles.indexOf(item.collision);
      if (index !== -1) obstacles.splice(index, 1);
    }
    const index = placed.indexOf(item);
    if (index !== -1) placed.splice(index, 1);
    disposePlacementVisual(item.visual);
  }

  function removeHovered() {
    if (!kind) return;
    update();
    const item = cell && occupied.get(cellKey(cell));
    if (item) removeItem(item);
    if (placed.length === 0) removing = false;
    update();
  }

  function toggleRemove() {
    if (!kind || (!removing && placed.length === 0)) return;
    removing = !removing;
    update();
  }

  function undo() {
    const item = placed.at(-1);
    if (item) removeItem(item);
    if (placed.length === 0) removing = false;
    update();
  }

  function cancel() {
    if (!kind) return;
    kind = undefined;
    removing = false;
    if (ghost) disposePlacementVisual(ghost);
    ghost = undefined;
    tintGhost = undefined;
    wash.visible = false;
    onActiveChange?.(false);
    update();
  }

  const view = createPlacementControls({ select, rotate, confirm, remove: toggleRemove, undo, cancel });

  function handlePointerMove(event: PointerEvent) {
    if (!event.isPrimary) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (kind) update();
  }

  // The walking controller calls this before interactions or click-to-move.
  function handlePointerDown(event: PointerEvent) {
    if (!kind || !event.isPrimary || event.button !== 0) return false;
    event.preventDefault();
    lastPointer = { x: event.clientX, y: event.clientY };
    update();
    if (removing) {
      removeHovered();
      return true;
    }
    // Touch and pen need a chance to see/rotate the preview before confirming.
    if (!event.pointerType || event.pointerType === 'mouse') confirm();
    return true;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const element = event.target;
    if (element instanceof HTMLElement &&
      (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))) return;

    let action: (() => void) | undefined;
    if (event.code === 'KeyF') action = () => select('fence');
    else if (event.code === 'KeyP') action = () => select('plot');
    else if (event.code === 'KeyZ') action = undo;
    else if (kind && event.code === 'KeyR') action = rotate;
    else if (kind && event.code === 'Delete') action = removeHovered;
    else if (kind && event.code === 'Escape') action = cancel;
    else if (kind && event.code === 'Enter' &&
      !(element instanceof HTMLElement && (['BUTTON', 'A'].includes(element.tagName) || view.contains(element)))) action = confirm;
    if (!action) return;
    event.preventDefault();
    action();
  }

  canvas.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('keydown', handleKeyDown);
  update();

  function dispose() {
    if (disposed) return;
    cancel();
    disposed = true;
    canvas.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('keydown', handleKeyDown);
    while (placed.length) removeItem(placed[placed.length - 1]);
    gridGeometry.dispose();
    gridMaterial.dispose();
    wash.geometry.dispose();
    wash.material.dispose();
    layer.removeFromParent();
    view.dispose();
  }

  return { update, handlePointerDown, isActive: () => Boolean(kind), dispose };
}
