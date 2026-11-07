// Browser-evaluated helpers for the old EBR-74/75 replay screenshots. They
// isolate only the intentional EBR-49a visual changes; real gameplay state,
// colliders, placement validation and input traces remain active throughout.
export function isolateHistoricalGarden({ contextName, hidePlots }) {
  const { scene } = window[contextName];
  const state = { hidden: [], tree: null };
  function hide(object) {
    if (!object || state.hidden.some((entry) => entry.uuid === object.uuid)) return;
    state.hidden.push({ uuid: object.uuid, visible: object.visible });
    object.visible = false;
  }
  const hives = scene.getObjectByName('garden-beehives');
  const flowers = scene.getObjectByName('garden-flower-patches');
  hide(hives);
  hide(flowers);
  if (hives || flowers) {
    const tree = scene.getObjectByName('farm-tree-4');
    const shadow = scene.getObjectByName('farm-tree-shadow-4');
    if (!tree || !shadow) throw new Error('Tree 4 or its shadow is missing');
    state.tree = { position: tree.position.toArray(), scale: tree.scale.toArray(),
      shadowPosition: shadow.position.toArray(), shadowScale: shadow.scale.toArray() };
    const scale = tree.scale.x;
    const oldScale = 0.95;
    const distance = Math.hypot(shadow.position.x, shadow.position.z) * scale;
    tree.position.x = 0.05;
    tree.position.z = -5.6;
    tree.scale.setScalar(oldScale);
    shadow.position.x *= scale / oldScale;
    shadow.position.z *= scale / oldScale;
    shadow.scale.x = Math.max(1, (distance + 0.15 * oldScale) / (0.8 * oldScale));
  }
  if (hidePlots) {
    scene.getObjectsByProperty('name', 'placed-plot').forEach(hide);
    if (document.querySelector('[data-plot]')?.getAttribute('aria-pressed') === 'true') {
      hide(scene.getObjectByName('placement-ghost'));
    }
  }
  return state;
}

export function restoreHistoricalGarden({ contextName, state }) {
  const { scene } = window[contextName];
  for (const { uuid, visible } of state.hidden) {
    const object = scene.getObjectByProperty('uuid', uuid);
    if (!object) throw new Error(`Historical capture lost object ${uuid}`);
    object.visible = visible;
  }
  if (state.tree) {
    const tree = scene.getObjectByName('farm-tree-4');
    const shadow = scene.getObjectByName('farm-tree-shadow-4');
    tree.position.fromArray(state.tree.position);
    tree.scale.fromArray(state.tree.scale);
    shadow.position.fromArray(state.tree.shadowPosition);
    shadow.scale.fromArray(state.tree.shadowScale);
  }
}
