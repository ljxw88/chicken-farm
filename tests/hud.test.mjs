import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFarmHud } = await vite.ssrLoadModule('/src/ui/createFarmHud.ts');
const { createInventory } = await vite.ssrLoadModule('/src/inventory/createInventory.ts');
const { createSupplies } = await vite.ssrLoadModule('/src/inventory/createSupplies.ts');
const { createQaFlockStubs } = await vite.ssrLoadModule('/src/interactions/qa/createQaFlockStubs.ts');
const { createInteractionRegistry } = await vite.ssrLoadModule('/src/interactions/createInteractionRegistry.ts');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
after(() => vite.close());

function fixture(t) {
  const dom = new JSDOM(indexHtml, { url: 'http://localhost/' });
  const { document } = dom.window;
  const canvas = document.querySelector('#scene');
  const root = document.querySelector('#farm-hud');
  const scene = new THREE.Scene();
  const character = new THREE.Group();
  scene.add(character);
  const supplies = createSupplies();
  const inventory = createInventory();
  const flock = createQaFlockStubs(scene, 0, { inventory, onEggCollected: supplies.addEgg });
  const registry = createInteractionRegistry(character);
  flock.interactables.forEach(registry.register);
  const messages = [];
  const hud = createFarmHud({
    root, supplies, inventory, initialPhase: 'morning', isEggReady: flock.isEggReady,
    collectEgg: flock.collectEgg, onCollected: (message) => messages.push(message),
  });
  t.after(() => { hud.dispose(); flock.dispose(); dom.window.close(); });
  const find = (selector) => {
    const element = root.querySelector(selector);
    assert.ok(element, selector);
    return element;
  };
  return { dom, canvas, root, scene, character, supplies, inventory, flock, registry, messages, hud, find };
}

test('the mounted HTML HUD is a canvas sibling and list Collect updates the shared egg and supplies', (t) => {
  const { canvas, root, supplies, inventory, flock, messages, find } = fixture(t);
  const egg = flock.interactables.find((item) => item.id === 'qa-egg');
  const collect = find('[data-collect]');
  assert.equal(root.parentElement, canvas.parentElement);
  assert.equal(canvas.nextElementSibling, root);
  assert.match(find('#farm-growing-title').textContent, /Growing on your farm/);
  assert.match(find('.farm-biome').textContent, /Woodland.*Day 1.*Spring.*Morning/s);
  assert.equal(find('[data-supplies-count]').textContent, '0');
  assert.equal(find('[data-feed-count]').textContent, '5');
  assert.equal(find('[data-egg-count]').textContent, '0');
  assert.equal(find('[data-ready-count]').textContent, '1 ready');
  assert.equal(find('[data-progress]').getAttribute('aria-label'), 'Ready to collect');
  assert.match(find('[data-producer]').textContent, /Hen coop.*\+5 Supplies.*Next egg: —/s);
  assert.equal(collect.disabled, false);

  collect.click();
  assert.equal(supplies.getCount(), 5);
  assert.equal(find('[data-supplies-count]').textContent, '5');
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
  assert.equal(find('[data-ready-count]').textContent, '0 ready');
  assert.equal(find('[data-producer]').dataset.state, 'collected');
  assert.equal(find('[data-progress]').getAttribute('aria-label'), 'Timer unavailable');
  assert.equal(find('[data-egg-status]').textContent, 'Collected');
  assert.equal(find('[data-collected-note]').hidden, false);
  assert.equal(collect.disabled, true);
  assert.equal(egg.object.visible, false);
  assert.equal(flock.isEggReady(), false);
  assert.match(messages[0], /Collected world egg/);
  collect.click();
  assert.equal(flock.collectEgg(), undefined);
  assert.equal(supplies.getCount(), 5);
  assert.equal(messages.length, 1);
});

test('world Collect synchronously updates the mounted list and capsule', (t) => {
  const { character, flock, registry, supplies, find } = fixture(t);
  const egg = flock.interactables.find((item) => item.id === 'qa-egg');
  character.position.copy(egg.object.position);
  assert.equal(registry.interact(egg).performed, true);
  assert.equal(supplies.getCount(), 5);
  assert.equal(find('[data-supplies-count]').textContent, '5');
  assert.equal(find('[data-collect]').disabled, true);
  find('[data-collect]').click();
  assert.equal(supplies.getCount(), 5);
});

test('HTML inventory tracks feeding and pickup without changing Supplies', (t) => {
  const { root, character, supplies, inventory, flock, registry, find } = fixture(t);
  const chicken = flock.interactables.find((item) => item.id === 'qa-chicken');
  character.position.copy(chicken.object.position);
  assert.match(registry.interact(chicken).message, /Fed chicken/);
  assert.equal(find('[data-feed-count]').textContent, '4');
  assert.equal(find('[data-egg-count]').textContent, '1');
  assert.equal(find('[data-feed-count]').getAttribute('aria-label'), '4 Feed');
  assert.equal(find('[data-supplies-count]').textContent, '0');
  for (let i = 0; i < 4; i++) assert.match(registry.interact(chicken).message, /Fed chicken/);
  assert.equal(find('[data-feed-count]').textContent, '0');
  assert.equal(find('[data-egg-count]').textContent, '5');
  assert.match(registry.interact(chicken).message, /Can't feed.*no Feed/);
  assert.deepEqual(inventory.getCounts(), { feed: 0, egg: 5 });
  assert.equal(supplies.getCount(), 0);
  inventory.pickup('feed', 2);
  assert.equal(find('[data-feed-count]').textContent, '2');
  assert.match(registry.interact(chicken).message, /Fed chicken/);
  assert.deepEqual(inventory.getCounts(), { feed: 1, egg: 6 });
  assert.equal(find('[data-egg-count]').textContent, '6');
  assert.equal(root.querySelector('.farm-market'), null);
});

test('Growing, placeholder buff tips, Build sheet and phase label are usable without the canvas', (t) => {
  const { dom, hud, find } = fixture(t);
  const toggle = find('[data-growing-toggle]');
  const content = find('#farm-growing-content');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(content.hidden, true);
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(content.hidden, false);

  const spring = find('[aria-controls="farm-spring-tip"]');
  const bee = find('[aria-controls="farm-bee-tip"]');
  spring.click();
  assert.equal(spring.getAttribute('aria-expanded'), 'true');
  assert.equal(find('#farm-spring-tip').hidden, false);
  assert.match(find('#farm-spring-tip').textContent, /placeholder.*no growth bonus/i);
  bee.click();
  assert.equal(spring.getAttribute('aria-expanded'), 'false');
  assert.equal(find('#farm-spring-tip').hidden, true);
  assert.equal(find('#farm-bee-tip').hidden, false);
  assert.match(find('#farm-bee-tip').textContent, /placeholder.*no pollination bonus/i);
  bee.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(find('#farm-bee-tip').hidden, true);

  const build = find('[data-build-toggle]');
  const sheet = find('#farm-build-sheet');
  build.click();
  assert.equal(build.getAttribute('aria-expanded'), 'true');
  assert.equal(sheet.hidden, false);
  assert.match(sheet.textContent, /Building is not available/);
  find('[data-build-close]').click();
  assert.equal(sheet.hidden, true);
  assert.equal(build.getAttribute('aria-expanded'), 'false');
  build.click();
  build.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(sheet.hidden, true);

  hud.setPhase('sunset');
  assert.equal(find('[data-phase]').textContent, 'Sunset');
  hud.setPhase('night');
  assert.equal(find('[data-phase]').textContent, 'Night');
});
