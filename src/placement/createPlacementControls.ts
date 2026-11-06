import type { PlacementKind } from './grid';
import './placement.css';

interface PlacementViewState {
  kind?: PlacementKind;
  message: string;
  valid: boolean;
  removing: boolean;
  canRemove: boolean;
  canUndo: boolean;
}

interface PlacementActions {
  select: (kind: PlacementKind) => void;
  rotate: () => void;
  confirm: () => void;
  remove: () => void;
  undo: () => void;
  cancel: () => void;
}

// Direct, temporary controls rather than a Build menu.
export function createPlacementControls(actions: PlacementActions) {
  const root = document.createElement('aside');
  root.className = 'placement-controls';
  root.setAttribute('aria-label', 'Free placement controls');
  root.innerHTML = `
    <div class="placement-detail" hidden>
      <p class="placement-status" aria-live="polite"></p>
      <p class="placement-hint"></p>
      <div class="placement-row">
        <button type="button" data-rotate aria-keyshortcuts="R">Rotate <kbd>R</kbd></button>
        <button type="button" data-confirm aria-keyshortcuts="Enter">Place <kbd>↵</kbd></button>
        <button type="button" data-remove aria-pressed="false">Remove</button>
        <button type="button" data-cancel aria-keyshortcuts="Escape">Cancel <kbd>Esc</kbd></button>
      </div>
    </div>
    <div class="placement-row placement-toolbar">
      <span class="placement-label">FREE</span>
      <button type="button" data-fence aria-keyshortcuts="F" aria-pressed="false">Fence <kbd>F</kbd></button>
      <button type="button" data-plot aria-keyshortcuts="P" aria-pressed="false">Plot <kbd>P</kbd></button>
      <button type="button" data-undo aria-keyshortcuts="Z">Undo <kbd>Z</kbd></button>
    </div>
  `;
  document.body.append(root);

  function required<T extends HTMLElement>(selector: string) {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Placement control not found: ${selector}`);
    return element;
  }
  const detail = required<HTMLElement>('.placement-detail');
  const status = required<HTMLElement>('.placement-status');
  const hint = required<HTMLElement>('.placement-hint');
  const fence = required<HTMLButtonElement>('[data-fence]');
  const plot = required<HTMLButtonElement>('[data-plot]');
  const rotate = required<HTMLButtonElement>('[data-rotate]');
  const confirm = required<HTMLButtonElement>('[data-confirm]');
  const remove = required<HTMLButtonElement>('[data-remove]');
  const undo = required<HTMLButtonElement>('[data-undo]');

  fence.addEventListener('click', () => actions.select('fence'));
  plot.addEventListener('click', () => actions.select('plot'));
  rotate.addEventListener('click', actions.rotate);
  confirm.addEventListener('click', actions.confirm);
  remove.addEventListener('click', actions.remove);
  undo.addEventListener('click', actions.undo);
  required<HTMLButtonElement>('[data-cancel]').addEventListener('click', actions.cancel);

  function update(state: PlacementViewState) {
    root.classList.toggle('is-active', Boolean(state.kind));
    detail.hidden = !state.kind;
    fence.setAttribute('aria-pressed', String(state.kind === 'fence'));
    plot.setAttribute('aria-pressed', String(state.kind === 'plot'));
    remove.setAttribute('aria-pressed', String(state.removing));
    if (status.textContent !== state.message) status.textContent = state.message;
    const instructions = state.removing ? 'Click or tap a placed tile · Remove again to finish' : 'Click to place · Touch: tap, then Place';
    if (hint.textContent !== instructions) hint.textContent = instructions;
    rotate.disabled = state.removing;
    confirm.disabled = !state.valid;
    remove.disabled = !state.canRemove;
    undo.disabled = !state.canUndo;
  }

  return { update, dispose: () => root.remove(), contains: (element: EventTarget | null) => element instanceof Node && root.contains(element) };
}
