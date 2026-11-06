import assert from 'node:assert/strict';

// Keep an explicit bridge approach for the existing controlled stairs tests,
// independently of the new single-click route planner.
export async function approachStairs(page, stateName) {
  for (const [x, z] of [[2.5, -1.7], [3.4, -1.93], [4.3, -1.95], [5.15, -1.65], [6, -0.9], [7.2, 0.75]]) {
    const point = await page.evaluate(({ stateName, x, z }) => {
      const { camera, character } = window[stateName];
      camera.updateMatrixWorld();
      const point = character.position.clone().set(x, 2.4, z).project(camera);
      const rect = document.querySelector('#scene').getBoundingClientRect();
      return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
    }, { stateName, x, z });
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(({ stateName, x, z }) => {
      const p = window[stateName].character.position;
      return Math.hypot(p.x - x, p.z - z) < 0.04;
    }, { stateName, x, z }, { timeout: 15000 });
  }
}
