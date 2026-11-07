import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installHarnessTiming } from '../tools/selfplay/timing.mjs';

test('the test-only timing scheduler forwards frame times, cancellation and next-frame requests', (t) => {
  const previous = globalThis.window;
  const pending = new Map();
  let id = 0;
  globalThis.window = {
    requestAnimationFrame(callback) { pending.set(++id, callback); return id; },
    cancelAnimationFrame(handle) { pending.delete(handle); },
  };
  t.after(() => { globalThis.window = previous; });
  installHarnessTiming();
  const events = [];
  let cancelled;
  window.requestAnimationFrame((time) => {
    events.push(['first', time]);
    window.cancelAnimationFrame(cancelled);
    window.requestAnimationFrame((next) => events.push(['next', next]));
  });
  cancelled = window.requestAnimationFrame((time) => events.push(['cancelled', time]));
  const step = (time) => {
    assert.equal(pending.size, 1);
    const [handle, callback] = pending.entries().next().value;
    pending.delete(handle);
    callback(time);
  };
  step(16);
  assert.deepEqual(events, [['first', 16]]);
  step(32);
  assert.deepEqual(events, [['first', 16], ['next', 32]]);
  assert.equal(pending.size, 0);
  assert.deepEqual(window.__selfplayTiming.timestamps, [16, 32]);
  assert.equal(window.__selfplayTiming.reads, 0);
});
