import type { CharacterComponents } from '../character/movementSystem';
import type { Entity, EntityWorld } from '../core/ecs';
import type { PlacementAction } from '../core/input';
import type { FarmObstacle } from '../character/farmCollisions';
import {
  cellKey, createGrid, fenceCollision, footprintCells, intersectsFootprint,
  type Cell, type Footprint, type PlacementKind,
} from './grid';

export interface PlacementState {
  kind: PlacementKind | null;
  rotation: number;
  removing: boolean;
  pointer: { x: number; y: number } | null;
  cell: Cell | null;
  area: Footprint | null;
  hoveredId: string | null;
  valid: boolean;
  message: string;
  ghostRevision: number;
  nextFenceId: number;
  nextSequence: number;
}

export interface PlacedItem {
  kind: PlacementKind;
  rotation: number;
  area: Footprint;
  cells: string[];
  sequence: number;
}

export interface PlacementComponents extends CharacterComponents {
  placement?: PlacementState;
  placed?: PlacedItem;
  // Decorative objects reserve build space but do not block walking.
  placementBlocker?: FarmObstacle;
}

// undefined means an unavailable canvas; null means a ray that missed ground.
export type PlacementHit = { x: number; z: number } | null | undefined;

/** Event-time placement over plain entities; no scene objects or DOM listeners. */
export function createPlacementSystem(world: EntityWorld<PlacementComponents>, groundSize: number, groundHeight: number) {
  const grid = createGrid(groundSize);
  const entity = world.create({
    placement: {
      kind: null, rotation: 0, removing: false, pointer: null, cell: null, area: null, hoveredId: null,
      valid: false, message: '', ghostRevision: 0, nextFenceId: 1, nextSequence: 1,
    },
  });
  const state = entity.placement!;

  function placed() {
    return [...world.with('placed')];
  }

  function occupied(cell: Cell) {
    const key = cellKey(cell);
    return placed().find((item) => item.placed.cells.includes(key));
  }

  function validate(candidate: Footprint) {
    if (!grid.contains(candidate)) return 'Outside the buildable island';
    if (footprintCells(candidate).some((cell) => occupied(cell))) return 'Space already occupied';
    for (const item of world.with('obstacle')) {
      if (intersectsFootprint(candidate, item.obstacle)) return 'Blocked by a farm object';
    }
    for (const item of world.with('placementBlocker')) {
      if (intersectsFootprint(candidate, item.placementBlocker)) return 'Blocked by a farm object';
    }
    for (const player of world.with('character', 'transform')) {
      const [x, , z] = player.transform.position;
      if (intersectsFootprint(candidate, { kind: 'circle', name: 'character', x, z, radius: player.character.radius })) {
        return 'Move away from the footprint';
      }
    }
    return null;
  }

  function clearPreview() {
    state.cell = null;
    state.area = null;
    state.hoveredId = null;
    state.valid = false;
  }

  function update(hit: PlacementHit) {
    if (!state.kind || !state.pointer) {
      clearPreview();
      state.message = state.kind ? (state.removing ? 'Remove · Point at a placed tile' : 'Point at the island to preview') : '';
      return;
    }
    if (hit === undefined) return;
    if (hit === null) {
      clearPreview();
      state.message = state.removing ? 'Remove · Point at a placed tile' : 'Point at the island to preview';
      return;
    }

    state.cell = grid.cellAt(hit.x, hit.z);
    if (state.removing) {
      state.area = null;
      state.valid = false;
      const item = occupied(state.cell);
      state.hoveredId = item?.id ?? null;
      state.message = item ? 'Remove · Click or tap the highlighted tile' : 'Remove · Point at a placed tile';
      return;
    }
    state.hoveredId = null;
    state.area = grid.footprint(state.cell, state.kind, state.rotation);
    const reason = validate(state.area);
    state.valid = !reason;
    const label = state.kind === 'fence' ? 'Fence' : 'Plot';
    state.message = `${label} · ${reason ?? 'Ready to place'}`;
  }

  function remove(item: Entity<PlacementComponents>) {
    world.remove(item);
  }

  function dispatch(action: PlacementAction, hit: PlacementHit) {
    switch (action.type) {
      case 'placement-preview':
        state.pointer = { x: action.point.x, y: action.point.y };
        if (state.kind) update(hit);
        return;
      case 'placement-select':
        state.kind = action.kind;
        state.rotation = 0;
        state.removing = false;
        state.ghostRevision++;
        update(hit);
        return;
      case 'placement-rotate':
        if (!state.kind || state.removing) return;
        state.rotation = (state.rotation + 1) % 4;
        update(hit);
        return;
      case 'placement-confirm': {
        if (!state.kind || state.removing) return;
        update(hit); // Recheck moving players and blockers before placing.
        if (!state.valid || !state.area) return;
        const { kind, rotation, area } = state;
        const components: PlacementComponents = {
          assetId: kind,
          transform: { position: [area.centerX, groundHeight, area.centerZ], yaw: rotation * Math.PI / 2 },
          placed: { kind, rotation, area, cells: footprintCells(area).map(cellKey), sequence: state.nextSequence++ },
        };
        if (kind === 'fence') components.obstacle = fenceCollision(area, rotation, `placed-fence-${state.nextFenceId++}`);
        world.create(components);
        update(hit);
        return;
      }
      case 'placement-remove': {
        if (!state.kind) return;
        if (action.mode === 'toggle') {
          if (!state.removing && placed().length === 0) return;
          state.removing = !state.removing;
        } else {
          update(hit);
          const item = state.cell && occupied(state.cell);
          if (item) remove(item);
          if (placed().length === 0) state.removing = false;
        }
        update(hit);
        return;
      }
      case 'placement-undo': {
        // Miniplex uses swap-removal, so query order is not the undo order.
        const item = placed().reduce<Entity<PlacementComponents> | undefined>(
          (last, entry) => !last || entry.placed.sequence > last.placed!.sequence ? entry : last, undefined,
        );
        if (item) remove(item);
        if (placed().length === 0) state.removing = false;
        update(hit);
        return;
      }
      case 'placement-cancel':
        if (!state.kind) return;
        state.kind = null;
        state.removing = false;
        update(hit);
    }
  }

  return { entity, state, grid, update, dispatch };
}
