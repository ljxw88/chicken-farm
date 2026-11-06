import assert from 'node:assert/strict';

// EBR-48 puts water across the old direct-to-stairs click. Exercise the real
// bridge approach with the parity harness's manually stepped animation loop;
// never teleport or re-record the signed reference frame.
export async function approachStairsAcrossBridge(page, stateName, stepName) {
  const targets = [[2.5, -1.7], [3.4, -1.93], [4.3, -1.95], [5.15, -1.65], [6, -0.9], [7.2, 0.75]];
  const pad = await page.evaluate((name) => {
    const { stairs } = window[name];
    return [stairs.footPad.position.x, stairs.footPad.position.z];
  }, stateName);
  targets.push(pad);
  let time = 0;
  for (const [x, z] of targets) {
    const point = await page.evaluate(({ stateName, x, z, isPad }) => {
      const { camera, character, stairs } = window[stateName];
      const y = isPad ? stairs.footPad.position.y + stairs.footPad.geometry.parameters.height / 2 : 2.4;
      const projected = character.position.clone().set(x, y, z).project(camera);
      const rect = document.querySelector('#scene').getBoundingClientRect();
      return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
    }, { stateName, x, z, isPad: x === pad[0] && z === pad[1] });
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
    await page.mouse.click(point.x, point.y);
    let distance = Infinity;
    for (let i = 0; i < 70; i++) {
      time += 100;
      await page.evaluate(({ stepName, time }) => window[stepName](time), { stepName, time });
      distance = await page.evaluate(({ stateName, x, z }) => {
        const p = window[stateName].character.position;
        return Math.hypot(p.x - x, p.z - z);
      }, { stateName, x, z });
      if (distance < 0.03) break;
    }
    assert.ok(distance < 0.03, `Parity bridge approach failed at ${x},${z}: ${distance}`);
  }
}
