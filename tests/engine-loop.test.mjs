import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFixedStepAccumulator, FIXED_STEP_SECONDS } = await vite.ssrLoadModule('/src/core/loop/fixedStep.ts');
const { createEngine } = await vite.ssrLoadModule('/src/core/loop/createEngine.ts');
after(() => vite.close());

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('one second produces sixty identical ticks at different render rates', () => {
  for (const fps of [30, 60, 120, 144, 240]) {
    const steps = [];
    const loop = createFixedStepAccumulator({ systems: [(dt) => steps.push(dt)] });
    for (let frame = 0; frame < fps; frame++) loop.advance(1 / fps);
    assert.equal(steps.length, 60, `${fps} fps`);
    assert.ok(steps.every((dt) => dt === FIXED_STEP_SECONDS));
    near(loop.advance(0).alpha, 0);
  }
  const ticks = [];
  const uneven = createFixedStepAccumulator({ systems: [(dt) => ticks.push(dt)] });
  for (const elapsed of [0.004, 0.026, 0.045, 0.025, 0.033, 0.067]) uneven.advance(elapsed);
  assert.equal(ticks.length, 12); // 0.2 seconds with no stalled frame.
});

test('catch-up is bounded, excess stall time is dropped, and fractional time survives', () => {
  let ticks = 0;
  const loop = createFixedStepAccumulator({ systems: [() => ticks++] });
  assert.equal(loop.advance(1 / 120).steps, 0);
  const stalled = loop.advance(5);
  assert.equal(stalled.steps, 6);
  near(stalled.droppedSeconds, 4.9);
  near(stalled.alpha, 0.5);
  assert.equal(loop.advance(0).steps, 0);
  assert.equal(loop.advance(1 / 120).steps, 1);
  assert.equal(ticks, 7);
  loop.reset();
  near(loop.advance(0).alpha, 0);
});

test('systems run in their fixed order for each tick, before a caller renders', () => {
  const order = [];
  const systems = [() => order.push('input'), () => order.push('movement'), () => order.push('environment')];
  const loop = createFixedStepAccumulator({ systems });
  systems.reverse(); // The schedule is fixed at construction.
  loop.advance(2 / 60);
  order.push('render');
  assert.deepEqual(order, ['input', 'movement', 'environment', 'input', 'movement', 'environment', 'render']);
});

test('custom non-integral catch-up limits cannot leave a backlog of whole ticks', () => {
  let count = 0;
  const loop = createFixedStepAccumulator({ systems: [() => count++], stepSeconds: 0.04, maxCatchUpSeconds: 0.1 });
  loop.advance(0.03);
  const result = loop.advance(1);
  assert.equal(result.steps, 2);
  near(result.droppedSeconds, 0.94);
  near(result.alpha, 0.25);
  assert.equal(loop.advance(0).steps, 0);
  assert.equal(count, 2);
  assert.throws(() => loop.advance(-1), RangeError);
  assert.throws(() => loop.advance(NaN), RangeError);
  assert.throws(() => createFixedStepAccumulator({ systems: [], stepSeconds: 0 }), RangeError);
});

test('engine ticks once per fixed step, shares one-shots across systems, and preserves legacy frame timing', () => {
  let animation;
  const order = [];
  const systemInputs = [];
  const systems = [
    (world, input, dt) => { order.push('A'); systemInputs.push(['A', input.actions.map((a) => a.type), input.move.active]); near(dt, 1 / 60); assert.ok(world); },
    (_world, input) => { order.push('B'); systemInputs.push(['B', input.actions.map((a) => a.type), input.move.active]); },
  ];
  const engine = createEngine({
    setAnimationLoop: (callback) => { animation = callback; },
    beforeFrame: () => order.push('before'),
    update: (dt) => order.push(['legacy', dt, Math.min(dt, 0.1)]),
    render: (dt) => order.push(['render', dt]),
    systems,
  });
  systems.reverse();
  engine.start();
  engine.input.keyDown({ code: 'KeyF', target: null });
  engine.input.keyDown({ code: 'KeyW', target: null });
  animation(1000);
  animation(1005); // No simulation tick: actions must remain queued.
  assert.deepEqual(systemInputs, []);
  animation(1100); // Six ticks; no replay of one-shots on ticks two through six.
  assert.equal(systemInputs.length, 12);
  assert.deepEqual(systemInputs.slice(0, 2), [
    ['A', ['placement-select', 'cancel-move-to', 'cancel-move-to'], true],
    ['B', ['placement-select', 'cancel-move-to', 'cancel-move-to'], true],
  ]);
  assert.ok(systemInputs.slice(2).every((entry) => entry[1].length === 0 && entry[2]));
  assert.deepEqual(order.slice(0, 6), [
    'before', ['legacy', 0, 0], ['render', 0], 'before', ['legacy', 0.005, 0.005], ['render', 0.005],
  ]);
  assert.deepEqual(order.slice(6, 19), ['before', ...Array(6).fill(['A', 'B']).flat()]);
  assert.deepEqual(order.slice(19), [['legacy', 0.095, 0.095], ['render', 0.095]]);
  order.length = 0;
  animation(3600); // Legacy environment and renderer still get the full 2.5 seconds.
  assert.deepEqual(order.slice(-2), [['legacy', 2.5, 0.1], ['render', 2.5]]);
  assert.equal(order.filter((item) => item === 'A').length, 6);
  engine.stop();
  assert.equal(animation, null);
  engine.start();
  order.length = 0;
  animation(5000);
  assert.deepEqual(order, ['before', ['legacy', 0, 0], ['render', 0]]);
  engine.stop();
});

test('frame systems run once before environment and render without stealing fixed-tick actions', () => {
  let animation;
  const order = [];
  const engine = createEngine({
    setAnimationLoop: (callback) => { animation = callback; },
    systems: [(_world, input) => order.push(['fixed', input.actions.map((action) => action.type)])],
    frameSystems: [(_world, move, dt) => order.push(['character', dt, move.active])],
    update: (dt) => order.push(['environment', dt]),
    render: (dt) => order.push(['render', dt]),
  });
  engine.start();
  engine.input.keyDown({ code: 'KeyW', target: null });
  animation(1000);
  animation(1005);
  animation(1020);
  assert.deepEqual(order, [
    ['character', 0, true], ['environment', 0], ['render', 0],
    ['character', 0.005, true], ['environment', 0.005], ['render', 0.005],
    ['fixed', ['cancel-move-to']], ['character', 0.015, true], ['environment', 0.015], ['render', 0.015],
  ]);
  engine.stop();
});
