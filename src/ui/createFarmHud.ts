import type { DayNightPhaseName } from '../lighting';
import type { Season } from '../content/slots';

interface FarmHudOptions {
  root: HTMLElement;
  initialPhase: DayNightPhaseName;
  season?: Season;
}

const PHASE_LABELS: Record<DayNightPhaseName, string> = {
  morning: 'Morning',
  daytime: 'Daytime',
  sunset: 'Sunset',
  night: 'Night',
};

/** Mount ordinary HTML next to the scene canvas, not into the renderer. */
export function createFarmHud({ root, initialPhase, season = 'spring' }: FarmHudOptions) {
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

  if (season === 'autumn') {
    // Keep the original Spring layout, including fractional font metrics, so
    // neither the phase nor the glass edge/shadow moves. Only the text changes.
    const time = root.querySelector<HTMLElement>('.farm-biome__time')!;
    const spring = [...time.childNodes].find((node) => node.nodeType === 3 && node.textContent?.includes('Spring'))!;
    const [before, after] = spring.textContent!.split('Spring');
    const phaseX = phase.getBoundingClientRect().x;
    const slot = root.ownerDocument.createElement('span');
    slot.style.cssText = 'display:inline-block;position:relative';
    slot.innerHTML = '<span aria-hidden="true" style="visibility:hidden;margin:0">Spring</span><span data-season style="position:absolute;left:0;transform-origin:left">Autumn</span>';
    spring.replaceWith(root.ownerDocument.createTextNode(before), slot, root.ownerDocument.createTextNode(after));
    const label = slot.querySelector<HTMLElement>('[data-season]')!;
    const reserved = slot.getBoundingClientRect().width - (phase.getBoundingClientRect().x - phaseX);
    const natural = label.getBoundingClientRect().width;
    if (reserved > 0 && natural > 0) {
      const fontSize = Number.parseFloat(root.ownerDocument.defaultView?.getComputedStyle(slot).fontSize ?? '');
      slot.style.width = fontSize > 0 ? `${reserved / fontSize}em` : `${reserved}px`;
      label.style.transform = `scaleX(${Math.min(1, reserved / natural)})`;
    }
    // The measurement placeholder is not part of the displayed/accessibility text.
    slot.firstElementChild!.textContent = '\u00a0';
  }

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
