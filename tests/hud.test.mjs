import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { formatFarmDayLength } = await vite.ssrLoadModule('/src/ui/format.ts');
const { createPendingWeatherAdapter } = await vite.ssrLoadModule('/src/ui/weatherAdapter.ts');
after(() => vite.close());

test('the footer describes the actual configured cycle length', () => {
  assert.equal(formatFarmDayLength(1440), 'One farm day lasts 24 minutes');
  assert.equal(formatFarmDayLength(72), 'One farm day lasts 1 minute 12 seconds');
  assert.equal(formatFarmDayLength(60), 'One farm day lasts 1 minute');
  assert.equal(formatFarmDayLength(1), 'One farm day lasts 1 second');
  assert.equal(formatFarmDayLength(0.0001), 'One farm day lasts 0.0001 seconds');
});

test('the EBR-35 boundary has no pretend weather state or actions while pending', () => {
  const weather = createPendingWeatherAdapter();
  assert.equal(weather.status, 'pending');
  assert.match(weather.reason, /EBR-35/);
  assert.equal('getState' in weather, false);
  assert.equal('previous' in weather, false);
  assert.equal('next' in weather, false);
  assert.equal('setAutomatic' in weather, false);
});
