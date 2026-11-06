import type { DayNightPhaseName } from '../lighting';

interface FarmHudOptions {
  root: HTMLElement;
  initialPhase: DayNightPhaseName;
}

const PHASE_LABELS: Record<DayNightPhaseName, string> = {
  morning: 'Morning',
  daytime: 'Daytime',
  sunset: 'Sunset',
  night: 'Night',
};

/** Mount ordinary HTML next to the scene canvas, not into the renderer. */
export function createFarmHud({ root, initialPhase }: FarmHudOptions) {
  root.classList.add('farm-hud');
  root.innerHTML = `
    <div class="farm-biome farm-glass" aria-label="Farm location and time">
      <span class="farm-biome__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M19 4C11 4 5 7 5 14a5 5 0 0 0 5 5c7 0 10-6 9-15Z" fill="currentColor" opacity=".3"/><path d="M5 20c2-5 5-8 10-11M5 14C5 7 11 4 19 4c1 9-2 15-9 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <div>
        <p class="farm-biome__name">Woodland</p>
        <p class="farm-biome__time">Day 1 <span aria-hidden="true">·</span> Spring <span aria-hidden="true">·</span> <span data-phase>Morning</span></p>
      </div>
    </div>
  `;

  const phaseElement = root.querySelector<HTMLElement>('[data-phase]');
  if (!phaseElement) throw new Error('Farm HUD phase element not found');
  const phase = phaseElement;

  let currentPhase: DayNightPhaseName | undefined;
  function setPhase(name: DayNightPhaseName) {
    if (name === currentPhase) return;
    currentPhase = name;
    phase.textContent = PHASE_LABELS[name];
  }
  setPhase(initialPhase);

  function dispose() {
    root.replaceChildren();
    root.classList.remove('farm-hud');
  }

  return { setPhase, dispose };
}
