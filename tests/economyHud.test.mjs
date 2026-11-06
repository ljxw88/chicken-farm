import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createEconomy } = await vite.ssrLoadModule('/src/inventory/createEconomy.ts');
const { createInventory } = await vite.ssrLoadModule('/src/inventory/createInventory.ts');
const { createSupplies } = await vite.ssrLoadModule('/src/inventory/createSupplies.ts');
const { createQaFenceStub } = await vite.ssrLoadModule('/src/interactions/qa/createQaFenceStub.ts');
const { createQaFlockStubs } = await vite.ssrLoadModule('/src/interactions/qa/createQaFlockStubs.ts');
const { createFarmHud } = await vite.ssrLoadModule('/src/ui/createFarmHud.ts');
const { createEconomyControls } = await vite.ssrLoadModule('/src/ui/createEconomyControls.ts');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
after(() => vite.close());

test('HTML market actions update the existing HUD and report failures without extra charges', (t) => {
  const dom = new JSDOM(indexHtml, { url: 'http://localhost/' });
  const root = dom.window.document.querySelector('#farm-hud');
  const canvas = dom.window.document.querySelector('#scene');
  const scene = new THREE.Scene();
  const supplies = createSupplies();
  const inventory = createInventory();
  const fence = createQaFenceStub(scene, 0);
  const economy = createEconomy({ inventory, supplies, fence });
  const flock = createQaFlockStubs(scene, 0, { inventory, onEggCollected: supplies.addEgg });
  const messages = [];
  const hud = createFarmHud({
    root, supplies, inventory, initialPhase: 'morning', isEggReady: flock.isEggReady,
    collectEgg: flock.collectEgg, onCollected: (message) => messages.push(message),
  });
  const controls = createEconomyControls({ root, economy, onAction: (message) => messages.push(message) });
  t.after(() => { controls.dispose(); hud.dispose(); flock.dispose(); fence.dispose(); dom.window.close(); });
  const find = (selector) => {
    const element = root.querySelector(selector);
    assert.ok(element, selector);
    return element;
  };
  const sell = find('[data-sell-egg]');
  const buy = find('[data-buy-feed]');
  const place = find('[data-place-fence]');
  assert.equal(root.parentElement, canvas.parentElement);
  assert.ok(find('.farm-market').classList.contains('farm-glass'));
  assert.match(sell.textContent, /Sell Egg.*\+3 Supplies/);
  assert.match(buy.textContent, /Buy Feed.*−1 Supplies/);
  assert.match(place.textContent, /Place Fence.*−5 Supplies/);

  sell.click();
  buy.click();
  place.click();
  assert.match(messages.at(-3), /Can't sell/);
  assert.match(messages.at(-2), /Can't buy Feed/);
  assert.match(messages.at(-1), /Can't place fence/);
  assert.equal(find('[data-supplies-count]').textContent, '0');
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });

  const chicken = flock.interactables.find((item) => item.id === 'qa-chicken');
  chicken.interact();
  find('[data-collect]').click();
  assert.equal(find('[data-supplies-count]').textContent, '5');
  assert.equal(find('[data-feed-count]').textContent, '4');
  assert.equal(find('[data-egg-count]').textContent, '1');
  sell.click();
  assert.equal(find('[data-supplies-count]').textContent, '8');
  assert.equal(find('[data-egg-count]').textContent, '0');
  buy.click();
  assert.equal(find('[data-supplies-count]').textContent, '7');
  assert.equal(find('[data-feed-count]').textContent, '5');
  place.click();
  assert.equal(find('[data-supplies-count]').textContent, '2');
  assert.ok(scene.getObjectByName('qa-paid-fence')?.visible);

  place.click();
  assert.match(messages.at(-1), /Can't place fence/);
  buy.click();
  buy.click();
  assert.equal(find('[data-supplies-count]').textContent, '0');
  buy.click();
  assert.match(messages.at(-1), /Can't buy Feed/);
  assert.equal(find('[data-feed-count]').textContent, '7');
  controls.dispose();
  supplies.add(1);
  buy.click(); // Detached controls must no longer perform transactions.
  assert.equal(supplies.getCount(), 1);
  assert.equal(find('[data-feed-count]').textContent, '7');
});
