import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { formatFarmDayLength } = await vite.ssrLoadModule('/src/ui/format.ts');
const { createSkyStateAdapter } = await vite.ssrLoadModule('/src/ui/skyStateAdapter.ts');
const { createPanel, createSelector, createToggle } = await vite.ssrLoadModule('/src/ui/controls.ts');
after(() => vite.close());

function sceneFixture() {
  const state = { phase: 'morning', following: true, cycleSeconds: 8, mode: 'clear' };
  const calls = [];
  const api = {
    getDayNightState: () => ({ phase: state.phase, following: state.following, cycleSeconds: state.cycleSeconds }),
    setDayNightPhase: (phase) => { calls.push(['phase', phase]); state.phase = phase; },
    setDayNightFollowing: (following) => { calls.push(['following', following]); state.following = following; },
    getWeather: () => ({ mode: state.mode }),
    setWeather: (mode) => { calls.push(['weather', mode]); state.mode = mode; },
  };
  return { state, calls, api, adapter: createSkyStateAdapter(api) };
}

test('the footer describes the actual configured cycle length', () => {
  assert.equal(formatFarmDayLength(1440), 'One farm day lasts 24 minutes.');
  assert.equal(formatFarmDayLength(72), 'One farm day lasts 1 minute 12 seconds.');
  assert.equal(formatFarmDayLength(60), 'One farm day lasts 1 minute.');
  assert.equal(formatFarmDayLength(1), 'One farm day lasts 1 second.');
  assert.equal(formatFarmDayLength(0.0001), 'One farm day lasts 0.0001 seconds.');
});

test('the sky adapter delegates time controls and follows authoritative scene state', () => {
  const { state, calls, adapter } = sceneFixture();
  assert.deepEqual(adapter.dayNight.phases, ['morning', 'daytime', 'sunset', 'night']);
  adapter.dayNight.setPhase('sunset');
  adapter.dayNight.setFollowing(false);
  assert.deepEqual(calls, [['phase', 'sunset'], ['following', false]]);
  state.phase = 'night';
  state.cycleSeconds = 1440;
  assert.deepEqual(adapter.dayNight.getState(), { phase: 'night', following: false, cycleSeconds: 1440 });
});

test('weather selectors cycle Clear skies, Cloudy, Gentle rain, Soft snow and wrap in both directions', () => {
  const { state, calls, adapter } = sceneFixture();
  const weather = adapter.weather;
  assert.equal(weather.status, 'ready');
  assert.deepEqual(weather.getState(), { mode: 'clear', label: 'Clear skies', automatic: false });
  weather.previous();
  assert.equal(weather.getState().label, 'Soft snow');
  weather.next();
  weather.next();
  assert.equal(weather.getState().label, 'Cloudy');
  weather.next();
  assert.equal(weather.getState().label, 'Gentle rain');
  weather.next();
  assert.equal(weather.getState().label, 'Soft snow');
  weather.next();
  assert.equal(weather.getState().label, 'Clear skies');
  assert.deepEqual(calls, [['weather', 'snow'], ['weather', 'clear'], ['weather', 'cloudy'], ['weather', 'rain'],
    ['weather', 'snow'], ['weather', 'clear']]);
  state.mode = 'snow';
  assert.equal(weather.getState().label, 'Soft snow');
  state.mode = 'clear';
  assert.equal(weather.getState().label, 'Clear skies');
});

test('automatic weather uses the real setter and never changes before 90 seconds', () => {
  const { calls, adapter } = sceneFixture();
  const weather = adapter.weather;
  weather.setAutomatic(true);
  assert.equal(weather.getState().automatic, true);
  adapter.update(100); // The enabling frame cannot include time before the toggle.
  adapter.update(89);
  assert.deepEqual(calls, []);
  adapter.update(1);
  assert.deepEqual(calls, [['weather', 'cloudy']]);
  adapter.update(180.5);
  assert.equal(weather.getState().label, 'Gentle rain');
  adapter.update(89);
  assert.equal(weather.getState().label, 'Gentle rain');
  adapter.update(1);
  assert.equal(weather.getState().label, 'Soft snow');
  adapter.update(90);
  assert.equal(weather.getState().label, 'Clear skies');
  weather.next(); // An explicit choice stops automation.
  assert.equal(weather.getState().automatic, false);
  adapter.update(100);
  assert.equal(weather.getState().label, 'Cloudy');
  assert.throws(() => weather.setAutomatic('yes'), TypeError);
  assert.throws(() => adapter.update(-1), RangeError);
});

test('automatic weather restarts its dwell after an external weather change', () => {
  const { api, calls, adapter } = sceneFixture();
  const weather = adapter.weather;
  weather.setAutomatic(true);
  adapter.update(0);
  adapter.update(80);
  api.setWeather('rain');
  adapter.update(30); // This frame may include time before the external setter.
  adapter.update(89);
  assert.equal(weather.getState().label, 'Gentle rain');
  assert.equal(weather.getState().automatic, true);
  adapter.update(1);
  assert.deepEqual(calls, [['weather', 'rain'], ['weather', 'snow']]);
});

test('the default 24-minute farm day gives automatic weather a six-minute dwell', () => {
  const { state, calls, adapter } = sceneFixture();
  state.cycleSeconds = 1440;
  adapter.weather.setAutomatic(true);
  adapter.update(0);
  adapter.update(359);
  assert.deepEqual(calls, []);
  adapter.update(1);
  assert.deepEqual(calls, [['weather', 'cloudy']]);
});

test('missing weather capabilities are not presented as working controls', () => {
  const { api } = sceneFixture();
  const pending = createSkyStateAdapter({ ...api, getWeather: undefined }).weather;
  assert.equal(pending.status, 'pending');
  assert.equal('next' in pending, false);
  const readOnly = createSkyStateAdapter({ ...api, setWeather: undefined }).weather;
  assert.equal(readOnly.status, 'ready');
  assert.equal(readOnly.getState().label, 'Clear skies');
  assert.equal(readOnly.getState().automatic, undefined);
  assert.equal('next' in readOnly, false);
  assert.equal('setAutomatic' in readOnly, false);
});

test('reusable panels, selectors and switches expose accessible state and real callbacks', (t) => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const oldDocument = globalThis.document;
  globalThis.document = dom.window.document;
  t.after(() => { globalThis.document = oldDocument; dom.window.close(); });
  const panel = createPanel({ id: 'sample-panel', title: 'Sample', closeLabel: 'Close sample' });
  assert.equal(panel.element.getAttribute('aria-labelledby'), 'sample-panel-title');
  assert.equal(panel.element.querySelector('h1').textContent, 'Sample');
  assert.equal(panel.close.getAttribute('aria-label'), 'Close sample');
  const calls = [];
  const selector = createSelector({ name: 'weather', onPrevious: () => calls.push('previous'), onNext: () => calls.push('next') });
  selector.setState({ value: 'Clear', previousDisabled: true, disabledReason: 'Not supported' });
  const [previous, next] = selector.element.querySelectorAll('button');
  assert.equal(previous.disabled, true);
  assert.equal(previous.title, 'Not supported');
  previous.click();
  next.click();
  assert.deepEqual(calls, ['next']);
  next.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.deepEqual(calls, ['next']); // The previous control is really disabled.
  next.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.deepEqual(calls, ['next', 'next']);
  assert.equal(selector.element.querySelector('[aria-live]').textContent, 'Clear');

  const toggle = createToggle({ id: 'automatic', label: 'Let it change', onChange: (value) => calls.push(value) });
  toggle.setState({ checked: false });
  const button = toggle.element.querySelector('button');
  assert.equal(button.getAttribute('role'), 'switch');
  button.click();
  assert.deepEqual(calls, ['next', 'next', true]);
  toggle.setState({ checked: true, disabled: true, disabledReason: 'Unavailable' });
  button.click();
  assert.equal(button.getAttribute('aria-checked'), 'true');
  assert.equal(button.title, 'Unavailable');
  assert.deepEqual(calls, ['next', 'next', true]);
});
