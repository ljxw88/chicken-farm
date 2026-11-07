import type { DayNightHudAdapter, SkyPhase, SkySceneApi, SkyWeather, WeatherHudAdapter } from './adapters';

const PHASES: readonly SkyPhase[] = ['morning', 'daytime', 'sunset', 'night'];
// Look Dev's selector order, independent of the weather driver's internal order.
const WEATHER: readonly SkyWeather[] = ['clear', 'cloudy', 'rain'];
const WEATHER_LABELS: Record<SkyWeather, string> = {
  clear: 'Clear skies', cloudy: 'Cloudy', rain: 'Gentle rain',
};

/** Translate only public scene controls into the small interface used by the HUD. */
export function createSkyStateAdapter(api: SkySceneApi) {
  const dayNight: DayNightHudAdapter = {
    phases: PHASES,
    getState: () => api.getDayNightState(),
    setPhase: (phase) => api.setDayNightPhase(phase),
    setFollowing: (following) => api.setDayNightFollowing(following),
  };

  let automatic = false;
  let elapsed = 0;
  let skipFirstDelta = false;
  let observedMode = api.getWeather?.().mode;

  function setAutomatic(next: boolean) {
    if (typeof next !== 'boolean') throw new TypeError('Automatic weather must be a boolean');
    if (automatic === next) return;
    automatic = next;
    elapsed = 0;
    observedMode = api.getWeather?.().mode;
    // A frame may include time from before the user enabled automation.
    skipFirstDelta = next;
  }

  function changeWeather(steps: number) {
    if (!api.getWeather || !api.setWeather) return;
    const current = WEATHER.indexOf(api.getWeather().mode);
    const index = ((Math.max(current, 0) + steps) % WEATHER.length + WEATHER.length) % WEATHER.length;
    const next = WEATHER[index];
    api.setWeather(next);
    observedMode = next;
  }

  const weather: WeatherHudAdapter = !api.getWeather
    ? { status: 'pending', reason: 'Weather is not available.' }
    : {
      status: 'ready',
      getState: () => {
        const mode = api.getWeather!().mode;
        return { mode, label: WEATHER_LABELS[mode], automatic: api.setWeather ? automatic : undefined };
      },
      ...(api.setWeather ? {
        previous: () => { setAutomatic(false); changeWeather(-1); },
        next: () => { setAutomatic(false); changeWeather(1); },
        setAutomatic,
      } : {}),
    };

  function update(deltaSeconds: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Elapsed time must be finite and non-negative');
    if (!automatic) return;
    const current = api.getWeather?.().mode;
    if (current !== observedMode) {
      // An external setter changed the scene; start a fresh dwell from the
      // observed change rather than counting time before it.
      observedMode = current;
      elapsed = 0;
      skipFirstDelta = false;
      return;
    }
    if (skipFirstDelta) {
      skipFirstDelta = false;
      return;
    }
    // Never change more often than the specified 90-second dwell, even when
    // a console override accelerates the day. No new random source is needed.
    const interval = Math.max(90, api.getDayNightState().cycleSeconds / 4);
    elapsed += deltaSeconds;
    if (elapsed >= interval) {
      // After a stalled/background frame, make at most one real change and
      // start a full new dwell; never bunch changes together on resume.
      elapsed = 0;
      changeWeather(1);
    }
  }

  return { dayNight, weather, update };
}
