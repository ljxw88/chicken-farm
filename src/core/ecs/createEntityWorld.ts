import { World } from 'miniplex';

// Components are serializable game data, never Three.js objects. More component
// types can be supplied to createEntityWorld as features migrate to the ECS.
export type PlainData = null | boolean | number | string | PlainData[] | { [key: string]: PlainData };
export type EntityId = string;
export type Transform = { position: [number, number, number]; yaw: number };
export type CoreComponents = { transform?: Transform; assetId?: string };
export type Entity<Components extends object = CoreComponents> = { readonly id: EntityId } & Components;

function assertPlainData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object') throw new TypeError('Components must contain only plain, finite JSON data');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Components must not contain class instances');
  }
  if (ancestors.has(value)) throw new TypeError('Components must not contain cycles');
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Components must not contain symbol keys');
  for (const child of Array.isArray(value) ? value : Object.values(value)) assertPlainData(child, ancestors);
  ancestors.delete(value);
}

/** A Miniplex-backed world with project-owned, never-reused IDs. */
export function createEntityWorld<Components extends object = CoreComponents>() {
  type GameEntity = Entity<Components>;
  const world = new World<GameEntity>();
  const byId = new Map<EntityId, GameEntity>();
  // Retired IDs cannot accidentally refer to a different entity later in this world.
  const issued = new Set<EntityId>();
  let nextId = 1;

  function create(components: Components, restoredId?: EntityId): GameEntity {
    if (!components || typeof components !== 'object' || Array.isArray(components)) {
      throw new TypeError('Entity components must be a plain object');
    }
    if ('id' in components) throw new TypeError('The entity ID is owned by the world');
    assertPlainData(components);
    if (restoredId !== undefined && (typeof restoredId !== 'string' || restoredId.length === 0)) {
      throw new TypeError('Entity ID must be a non-empty string');
    }
    let id = restoredId;
    if (id === undefined) {
      do id = `entity-${nextId++}`; while (issued.has(id));
    }
    if (issued.has(id)) throw new Error(`Entity ID already used: ${id}`);
    const entity = { ...components } as GameEntity;
    Object.defineProperty(entity, 'id', { value: id, enumerable: true, writable: false, configurable: false });
    issued.add(id);
    byId.set(id, entity);
    world.add(entity);
    return entity;
  }

  function get(id: EntityId) {
    return byId.get(id);
  }

  function remove(entity: GameEntity) {
    if (byId.get(entity.id) !== entity) return false;
    byId.delete(entity.id);
    world.remove(entity);
    return true;
  }

  function assertMember(entity: GameEntity) {
    if (byId.get(entity.id) !== entity) throw new Error('Entity is not in this world');
  }

  // Component membership must go through Miniplex, otherwise its live queries
  // will not be reindexed. Mutating a component's plain data is fine.
  function addComponent<Key extends keyof Components>(entity: GameEntity, key: Key, value: Components[Key]) {
    assertMember(entity);
    if (key === 'id') throw new TypeError('The entity ID cannot be changed');
    assertPlainData(value);
    world.addComponent(entity, key, value as GameEntity[Key]);
  }

  function removeComponent<Key extends keyof Components>(entity: GameEntity, key: Key) {
    assertMember(entity);
    if (key === 'id') throw new TypeError('The entity ID cannot be changed');
    world.removeComponent(entity, key);
  }

  function withComponents<Key extends keyof GameEntity>(...keys: Key[]) {
    return world.with(...keys);
  }

  function withoutComponents<Key extends keyof GameEntity>(...keys: Key[]) {
    return world.without(...keys);
  }

  return { create, get, remove, addComponent, removeComponent, with: withComponents, without: withoutComponents };
}

export type EntityWorld<Components extends object = CoreComponents> = ReturnType<typeof createEntityWorld<Components>>;
