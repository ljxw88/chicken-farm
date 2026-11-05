import { EGG_SUPPLIES_YIELD, type Supplies } from '../inventory/createSupplies';
import type { DayNightPhaseName } from '../lighting';

interface FarmHudOptions {
  root: HTMLElement;
  supplies: Supplies;
  initialPhase: DayNightPhaseName;
  isEggReady: () => boolean;
  collectEgg: () => string | undefined;
  onCollected: (message: string) => void;
}

const PHASE_LABELS: Record<DayNightPhaseName, string> = {
  morning: 'Morning',
  daytime: 'Daytime',
  sunset: 'Sunset',
  night: 'Night',
};

function required<T extends Element>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Farm HUD element not found: ${selector}`);
  return element;
}

/** Mount ordinary HTML next to the scene canvas, not into the renderer. */
export function createFarmHud({ root, supplies, initialPhase, isEggReady, collectEgg, onCollected }: FarmHudOptions) {
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

    <div class="farm-supplies farm-glass">
      <span class="farm-supplies__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 10h16l-1.4 8.1a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7L4 10ZM8 10l4-6 4 6M9 13v3m6-3v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="farm-supplies__label">Supplies</span>
      <strong class="farm-supplies__count" data-supplies-count aria-live="polite" aria-atomic="true">0</strong>
    </div>

    <section class="farm-growing farm-glass" aria-labelledby="farm-growing-title">
      <button class="farm-growing__toggle" type="button" data-growing-toggle aria-expanded="true" aria-controls="farm-growing-content">
        <span class="farm-growing__heading">
          <span class="farm-eyebrow">YOUR FARM</span>
          <span class="farm-growing__title" id="farm-growing-title">Growing on your farm</span>
        </span>
        <span class="farm-growing__actions">
          <span class="farm-growing__badge" data-ready-count>1 ready</span>
          <svg class="farm-growing__chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>

      <div class="farm-growing__body" id="farm-growing-content">
        <div class="farm-section-heading"><span data-collection-heading>READY TO GATHER</span><span>1 PRODUCER</span></div>
        <article class="farm-producer" data-producer data-state="ready">
          <div class="farm-producer__top">
            <span class="farm-producer__icon" aria-hidden="true">
              <svg viewBox="0 0 40 40" fill="none"><path d="M20 6c-5.1 0-10 9.1-10 16a10 10 0 1 0 20 0c0-6.9-4.9-16-10-16Z" fill="#f5efda"/><path d="M14.2 22.3c.2-3.6 1.7-7.5 3.6-9.6" stroke="#fffdf4" stroke-width="2" stroke-linecap="round" opacity=".8"/><path d="M8 29.5c3.5 2 7.5 3 12 3s8.5-1 12-3" stroke="#c9ac7b" stroke-width="2" stroke-linecap="round"/></svg>
            </span>
            <div class="farm-producer__details">
              <h2>Hen coop</h2>
              <p>Egg <span aria-hidden="true">·</span> +${EGG_SUPPLIES_YIELD} Supplies</p>
            </div>
            <span class="farm-producer__progress" data-progress role="img" aria-label="Ready to collect"><span data-progress-symbol aria-hidden="true">✓</span></span>
          </div>
          <div class="farm-producer__bottom">
            <div class="farm-producer__timing">
              <strong data-egg-status aria-live="polite">Ready now</strong>
              <span>Next egg: —</span>
            </div>
            <button class="farm-collect" type="button" data-collect>Collect</button>
          </div>
        </article>
        <p class="farm-growing__note" data-collected-note hidden>Collected! New eggs and timers aren’t simulated yet. Refresh to reset.</p>

        <div class="farm-section-heading farm-section-heading--buffs"><span>FARM BUFFS</span><span>PREVIEW</span></div>
        <div class="farm-buffs">
          <button class="farm-buff" type="button" data-buff-toggle aria-expanded="false" aria-controls="farm-spring-tip" aria-describedby="farm-spring-tip" title="Spring growth is a placeholder; no growth bonus is simulated.">
            <span aria-hidden="true">✳</span> Spring growth <span class="farm-buff__info" aria-hidden="true">i</span>
          </button>
          <button class="farm-buff" type="button" data-buff-toggle aria-expanded="false" aria-controls="farm-bee-tip" aria-describedby="farm-bee-tip" title="Bee pollination is a placeholder; no pollination bonus is simulated.">
            <span aria-hidden="true">✿</span> Bee pollination <span class="farm-buff__info" aria-hidden="true">i</span>
          </button>
        </div>
        <p class="farm-buff__tip" id="farm-spring-tip" role="tooltip" hidden>Spring growth is a placeholder; no growth bonus is simulated.</p>
        <p class="farm-buff__tip" id="farm-bee-tip" role="tooltip" hidden>Bee pollination is a placeholder; no pollination bonus is simulated.</p>
      </div>
    </section>

    <div class="farm-build">
      <section class="farm-build__sheet farm-glass" id="farm-build-sheet" aria-labelledby="farm-build-title" hidden>
        <div class="farm-build__sheet-header">
          <div><span class="farm-eyebrow">COMING SOON</span><h2 id="farm-build-title">Build menu</h2></div>
          <button class="farm-build__close" type="button" data-build-close aria-label="Close build menu">×</button>
        </div>
        <p>A place for new farm projects. Building is not available in this preview.</p>
      </section>
      <button class="farm-build__fab farm-glass" type="button" data-build-toggle aria-expanded="false" aria-controls="farm-build-sheet">
        <span class="farm-build__plus" aria-hidden="true">+</span><span>Build</span>
      </button>
    </div>
  `;

  const count = required<HTMLElement>(root, '[data-supplies-count]');
  const phase = required<HTMLElement>(root, '[data-phase]');
  const growingToggle = required<HTMLButtonElement>(root, '[data-growing-toggle]');
  const growingContent = required<HTMLElement>(root, '#farm-growing-content');
  const readyCount = required<HTMLElement>(root, '[data-ready-count]');
  const collectionHeading = required<HTMLElement>(root, '[data-collection-heading]');
  const producer = required<HTMLElement>(root, '[data-producer]');
  const progress = required<HTMLElement>(root, '[data-progress]');
  const progressSymbol = required<HTMLElement>(root, '[data-progress-symbol]');
  const eggStatus = required<HTMLElement>(root, '[data-egg-status]');
  const collectedNote = required<HTMLElement>(root, '[data-collected-note]');
  const collect = required<HTMLButtonElement>(root, '[data-collect]');
  const buildToggle = required<HTMLButtonElement>(root, '[data-build-toggle]');
  const buildClose = required<HTMLButtonElement>(root, '[data-build-close]');
  const buildSheet = required<HTMLElement>(root, '#farm-build-sheet');
  const buffButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-buff-toggle]')];
  const buffTips = buffButtons.map((button) => required<HTMLElement>(root, `#${button.getAttribute('aria-controls')}`));

  function showBuff(index: number) {
    buffButtons.forEach((button, i) => {
      const open = i === index;
      button.setAttribute('aria-expanded', String(open));
      buffTips[i].hidden = !open;
    });
  }

  const buffHandlers = buffButtons.map((button, index) => {
    const handler = () => showBuff(button.getAttribute('aria-expanded') === 'true' ? -1 : index);
    button.addEventListener('click', handler);
    return handler;
  });

  function toggleGrowing() {
    const open = Boolean(growingContent.hidden);
    growingContent.hidden = !open;
    growingToggle.setAttribute('aria-expanded', String(open));
    if (!open) showBuff(-1);
  }

  function setBuildOpen(open: boolean) {
    buildSheet.hidden = !open;
    buildToggle.setAttribute('aria-expanded', String(open));
  }

  function toggleBuild() {
    setBuildOpen(Boolean(buildSheet.hidden));
  }

  function closeBuild() {
    setBuildOpen(false);
    buildToggle.focus();
  }

  function handleCollect() {
    const message = collectEgg();
    if (message) onCollected(message);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (buffButtons.some((button) => button.getAttribute('aria-expanded') === 'true')) {
      showBuff(-1);
    } else if (!buildSheet.hidden) {
      closeBuild();
    }
  }

  growingToggle.addEventListener('click', toggleGrowing);
  buildToggle.addEventListener('click', toggleBuild);
  buildClose.addEventListener('click', closeBuild);
  collect.addEventListener('click', handleCollect);
  root.addEventListener('keydown', handleKeyDown);

  const unsubscribe = supplies.subscribe((total) => {
    const ready = isEggReady();
    count.textContent = String(total);
    count.setAttribute('aria-label', `${total} supplies`);
    readyCount.textContent = ready ? '1 ready' : '0 ready';
    collectionHeading.textContent = ready ? 'READY TO GATHER' : 'ALL CAUGHT UP';
    producer.dataset.state = ready ? 'ready' : 'collected';
    progress.setAttribute('aria-label', ready ? 'Ready to collect' : 'Timer unavailable');
    progressSymbol.textContent = ready ? '✓' : '—';
    eggStatus.textContent = ready ? 'Ready now' : 'Collected';
    collectedNote.hidden = ready;
    collect.disabled = !ready;
    collect.textContent = ready ? 'Collect' : 'Collected';
  });

  let currentPhase: DayNightPhaseName | undefined;
  function setPhase(name: DayNightPhaseName) {
    if (name === currentPhase) return;
    currentPhase = name;
    phase.textContent = PHASE_LABELS[name];
  }
  setPhase(initialPhase);

  function dispose() {
    unsubscribe();
    growingToggle.removeEventListener('click', toggleGrowing);
    buildToggle.removeEventListener('click', toggleBuild);
    buildClose.removeEventListener('click', closeBuild);
    collect.removeEventListener('click', handleCollect);
    root.removeEventListener('keydown', handleKeyDown);
    buffButtons.forEach((button, i) => button.removeEventListener('click', buffHandlers[i]));
    root.replaceChildren();
    root.classList.remove('farm-hud');
  }

  return { setPhase, dispose };
}
