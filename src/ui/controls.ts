import { NEXT_ICON, PREVIOUS_ICON } from './icons';

export function createIconButton(label: string, icon: string, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `hud-icon-button ${className}`.trim();
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon; // Icons are static, local SVGs, never weather-provided markup.
  return button;
}

interface SelectorOptions {
  name: string;
  onPrevious(): void;
  onNext(): void;
}

interface SelectorState {
  value: string;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  disabledReason?: string;
}

export function createSelector({ name, onPrevious, onNext }: SelectorOptions) {
  const element = document.createElement('div');
  element.className = 'hud-selector';
  const previous = createIconButton(`Previous ${name}`, PREVIOUS_ICON, 'hud-selector__arrow');
  const value = document.createElement('span');
  value.className = 'hud-selector__value';
  value.setAttribute('aria-live', 'polite');
  value.setAttribute('aria-atomic', 'true');
  const next = createIconButton(`Next ${name}`, NEXT_ICON, 'hud-selector__arrow');
  previous.addEventListener('click', onPrevious);
  next.addEventListener('click', onNext);
  element.append(previous, value, next);

  function setState(state: SelectorState) {
    if (value.textContent !== state.value) value.textContent = state.value;
    const previousDisabled = Boolean(state.previousDisabled);
    const nextDisabled = Boolean(state.nextDisabled);
    if (previous.disabled !== previousDisabled) previous.disabled = previousDisabled;
    if (next.disabled !== nextDisabled) next.disabled = nextDisabled;
    const previousTitle = previousDisabled ? state.disabledReason ?? 'Not available' : `Previous ${name}`;
    const nextTitle = nextDisabled ? state.disabledReason ?? 'Not available' : `Next ${name}`;
    if (previous.title !== previousTitle) previous.title = previousTitle;
    if (next.title !== nextTitle) next.title = nextTitle;
  }

  return { element, setState };
}

interface ToggleOptions {
  id: string;
  label: string;
  onChange(checked: boolean): void;
}

interface ToggleState {
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function createToggle({ id, label, onChange }: ToggleOptions) {
  const element = document.createElement('div');
  element.className = 'hud-toggle';
  const text = document.createElement('span');
  text.className = 'hud-toggle__label';
  text.id = `${id}-label`;
  text.textContent = label;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-toggle__button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-labelledby', text.id);
  button.innerHTML = '<span class="hud-toggle__track"><span class="hud-toggle__thumb"></span></span>';
  button.addEventListener('click', () => onChange(button.getAttribute('aria-checked') !== 'true'));
  element.append(text, button);

  function setState(state: ToggleState) {
    const checked = String(state.checked);
    if (button.getAttribute('aria-checked') !== checked) button.setAttribute('aria-checked', checked);
    const disabled = Boolean(state.disabled);
    if (button.disabled !== disabled) button.disabled = disabled;
    const title = disabled ? state.disabledReason ?? 'Not available' : label;
    if (button.title !== title) button.title = title;
  }

  return { element, setState };
}
