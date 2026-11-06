import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFarmHud } = await vite.ssrLoadModule('/src/ui/createFarmHud.ts');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
after(() => vite.close());

test('the canvas-sibling HUD displays the current phase without sim or build controls', (t) => {
  const dom = new JSDOM(indexHtml);
  const { document } = dom.window;
  const canvas = document.querySelector('#scene');
  const root = document.querySelector('#farm-hud');
  const hud = createFarmHud({ root, initialPhase: 'morning' });
  t.after(() => { hud.dispose(); dom.window.close(); });

  assert.equal(canvas.nextElementSibling, root);
  assert.match(root.textContent, /Woodland.*Day 1.*Spring.*Morning/s);
  assert.equal(root.querySelectorAll('button, [data-collect], [data-supplies-count], [data-feed-count], [data-egg-count]').length, 0);
  assert.doesNotMatch(root.textContent, /\b(inventory|collect|egg|feed|supplies|buy|sell|fence|market|build)\b/i);
  const phase = root.querySelector('[data-phase]');
  for (const [name, label] of [['daytime', 'Daytime'], ['sunset', 'Sunset'], ['night', 'Night'], ['morning', 'Morning']]) {
    hud.setPhase(name);
    assert.equal(phase.textContent, label);
  }

  hud.dispose();
  assert.equal(root.childElementCount, 0);
  assert.equal(root.classList.contains('farm-hud'), false);
});
