import type { DayNightPhaseName } from '../lighting';
import type { DayNightHudAdapter, WeatherHudAdapter } from './adapters';
import { createIconButton, createSelector, createToggle } from './controls';
import { formatFarmDayLength } from './format';
import {
  CLOSE_ICON, COLLAPSE_ICON, EXPAND_ICON, MOON_ICON, MORE_ICON, PENDING_WEATHER_ARTWORK,
  PHASE_ARTWORK, SPEAKER_ICON, SUN_ICON,
} from './icons';

const PHASE_LABELS: Record<DayNightPhaseName, string> = {
  morning: 'Morning',
  daytime: 'Daytime',
  sunset: 'Sunset',
  night: 'Night',
};

interface SkyHudOptions {
  root: HTMLElement;
  dayNight: DayNightHudAdapter;
  weather: WeatherHudAdapter;
}

function createColumn(title: string, id: string) {
  const element = document.createElement('section');
  element.className = 'hud-column';
  element.setAttribute('aria-labelledby', `${id}-heading`);
  const heading = document.createElement('h2');
  heading.className = 'hud-column__heading';
  heading.id = `${id}-heading`;
  heading.textContent = title;
  const artwork = document.createElement('div');
  artwork.className = 'hud-column__artwork';
  artwork.setAttribute('aria-hidden', 'true');
  const hint = document.createElement('p');
  hint.className = 'hud-column__hint';
  hint.id = `${id}-hint`;
  element.append(heading, artwork);
  return { element, artwork, hint };
}

export function createSkyHud({ root, dayNight, weather }: SkyHudOptions) {
  if (dayNight.phases.length === 0) throw new Error('The sky HUD needs at least one day/night phase');

  const panel = document.createElement('section');
  panel.id = 'sky-panel';
  panel.className = 'hud-panel';
  panel.setAttribute('aria-labelledby', 'sky-title');
  const header = document.createElement('header');
  header.className = 'hud-panel__header';
  const title = document.createElement('h1');
  title.id = 'sky-title';
  title.textContent = 'A changing sky';
  const close = createIconButton('Close sky settings', CLOSE_ICON, 'hud-panel__close');
  header.append(title, close);

  const columns = document.createElement('div');
  columns.className = 'hud-columns';
  const timeColumn = createColumn('Time of day', 'time');
  const weatherColumn = createColumn('Weather', 'weather');
  weatherColumn.element.classList.toggle('hud-column--pending', weather.status === 'pending');
  weatherColumn.element.setAttribute('aria-describedby', weatherColumn.hint.id);
  weatherColumn.artwork.innerHTML = PENDING_WEATHER_ARTWORK;
  timeColumn.hint.textContent = 'Choosing a time pauses the day';

  function selectTime(direction: number) {
    const index = dayNight.phases.indexOf(dayNight.getState().phase);
    const nextIndex = (Math.max(index, 0) + direction + dayNight.phases.length) % dayNight.phases.length;
    dayNight.setPhase(dayNight.phases[nextIndex]);
    dayNight.setFollowing(false);
    update();
  }

  const timeSelector = createSelector({
    name: 'time of day',
    onPrevious: () => selectTime(-1),
    onNext: () => selectTime(1),
  });
  const timeToggle = createToggle({
    id: 'follow-day',
    label: 'Follow the day',
    onChange: (checked) => {
      dayNight.setFollowing(checked);
      update();
    },
  });
  const weatherSelector = createSelector({
    name: 'weather',
    onPrevious: () => {
      if (weather.status === 'ready') weather.previous?.();
      update();
    },
    onNext: () => {
      if (weather.status === 'ready') weather.next?.();
      update();
    },
  });
  const weatherToggle = createToggle({
    id: 'change-weather',
    label: 'Let it change',
    onChange: (checked) => {
      if (weather.status === 'ready') weather.setAutomatic?.(checked);
      update();
    },
  });
  timeColumn.element.append(timeSelector.element, timeColumn.hint, timeToggle.element);
  weatherColumn.element.append(weatherSelector.element, weatherColumn.hint, weatherToggle.element);
  columns.append(timeColumn.element, weatherColumn.element);

  const footer = document.createElement('footer');
  footer.className = 'hud-panel__footer';
  panel.append(header, columns, footer);

  const toolbar = document.createElement('div');
  toolbar.className = 'hud-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Farm controls');
  const sound = createIconButton('Sound unavailable', SPEAKER_ICON, 'hud-toolbar__button');
  sound.disabled = true;
  sound.title = 'Sound is not available yet.';
  const fullscreen = createIconButton('Enter fullscreen', EXPAND_ICON, 'hud-toolbar__button');
  fullscreen.dataset.action = 'fullscreen';
  const sky = createIconButton('Close sky settings', SUN_ICON, 'hud-toolbar__button');
  sky.dataset.action = 'sky';
  sky.setAttribute('aria-controls', panel.id);
  const more = createIconButton('More options unavailable', MORE_ICON, 'hud-toolbar__button');
  more.disabled = true;
  more.title = 'More options are not available yet.';
  toolbar.append(sound, fullscreen, sky, more);

  const status = document.createElement('p');
  status.className = 'hud-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  root.replaceChildren(panel, status, toolbar);

  let panelOpen = true;
  let lastPhase: DayNightPhaseName | undefined;
  let lastCycleSeconds: number | undefined;
  let fullscreenUnavailable = !document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== 'function';

  function updateSkyButton(phase: DayNightPhaseName) {
    const label = `${panelOpen ? 'Close' : 'Open'} sky settings (${PHASE_LABELS[phase]})`;
    if (sky.getAttribute('aria-label') !== label) sky.setAttribute('aria-label', label);
    if (sky.title !== label) sky.title = label;
    if (sky.getAttribute('aria-expanded') !== String(panelOpen)) sky.setAttribute('aria-expanded', String(panelOpen));
    if (sky.dataset.phase !== phase) sky.dataset.phase = phase;
  }

  function setPanelOpen(open: boolean) {
    const returnFocus = !open && panel.contains(document.activeElement);
    panelOpen = open;
    panel.hidden = !open;
    updateSkyButton(dayNight.getState().phase);
    if (returnFocus) sky.focus({ preventScroll: true });
  }

  function syncFullscreen() {
    const active = Boolean(document.fullscreenElement);
    const label = fullscreenUnavailable ? 'Fullscreen unavailable' : active ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreen.disabled = fullscreenUnavailable;
    fullscreen.setAttribute('aria-label', label);
    fullscreen.title = label;
    fullscreen.innerHTML = active ? COLLAPSE_ICON : EXPAND_ICON;
  }

  close.addEventListener('click', () => setPanelOpen(false));
  sky.addEventListener('click', () => setPanelOpen(!panelOpen));
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreenUnavailable = true;
      status.textContent = 'Fullscreen is unavailable in this browser.';
      status.hidden = false;
    }
    syncFullscreen();
  });
  document.addEventListener('fullscreenchange', syncFullscreen);

  function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape' && panelOpen && root.contains(document.activeElement)) {
      event.preventDefault();
      setPanelOpen(false);
    }
  }
  window.addEventListener('keydown', handleEscape);

  function update() {
    const time = dayNight.getState();
    if (lastPhase !== time.phase) {
      timeColumn.artwork.innerHTML = PHASE_ARTWORK[time.phase];
      sky.innerHTML = time.phase === 'night' ? MOON_ICON : SUN_ICON;
      lastPhase = time.phase;
    }
    updateSkyButton(time.phase);
    timeSelector.setState({ value: PHASE_LABELS[time.phase] });
    timeToggle.setState({ checked: time.following });
    if (lastCycleSeconds !== time.cycleSeconds) {
      footer.textContent = formatFarmDayLength(time.cycleSeconds);
      lastCycleSeconds = time.cycleSeconds;
    }

    if (weather.status === 'pending') {
      weatherSelector.setState({
        value: 'Pending', previousDisabled: true, nextDisabled: true, disabledReason: weather.reason,
      });
      weatherToggle.setState({ checked: false, disabled: true, disabledReason: weather.reason });
      if (weatherColumn.hint.textContent !== 'Awaiting EBR-35') weatherColumn.hint.textContent = 'Awaiting EBR-35';
    } else {
      const state = weather.getState();
      const unavailable = 'This weather control is not available.';
      weatherSelector.setState({
        value: state.label, previousDisabled: !weather.previous, nextDisabled: !weather.next, disabledReason: unavailable,
      });
      weatherToggle.setState({
        checked: state.automatic === true,
        disabled: state.automatic === undefined || !weather.setAutomatic,
        disabledReason: unavailable,
      });
      const hint = state.automatic === undefined ? 'Automatic change unavailable' : '';
      if (weatherColumn.hint.textContent !== hint) weatherColumn.hint.textContent = hint;
    }
  }

  syncFullscreen();
  setPanelOpen(true);
  update();

  function dispose() {
    document.removeEventListener('fullscreenchange', syncFullscreen);
    window.removeEventListener('keydown', handleEscape);
    root.replaceChildren();
  }

  return { update, dispose };
}
