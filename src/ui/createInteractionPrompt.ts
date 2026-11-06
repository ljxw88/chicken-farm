import type { Interactable } from '../interactions';
import type { InteractionView } from '../interactions/createInteractionController';

export function createInteractionPrompt(): InteractionView & { dispose(): void } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'interaction-prompt';
  button.hidden = true;
  button.setAttribute('aria-keyshortcuts', 'E');
  const key = document.createElement('span');
  key.className = 'interaction-key';
  key.setAttribute('aria-hidden', 'true');
  key.textContent = 'E';
  const label = document.createElement('span');
  button.append(key, label);

  const feedback = document.createElement('div');
  feedback.className = 'interaction-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  document.body.append(button, feedback);

  let lastLabel = '';
  let lastViewportWidth = 0;
  let promptWidth = 0;
  let promptHeight = 0;
  let messageTimer: number | undefined;

  function show(interactable: Interactable, screenX: number, screenY: number) {
    const text = typeof interactable.label === 'function' ? interactable.label() : interactable.label;
    const needsMeasure = button.hidden || text !== lastLabel || window.innerWidth !== lastViewportWidth;
    button.hidden = false;
    button.dataset.interactable = interactable.id;
    if (text !== lastLabel) {
      label.textContent = text;
      button.setAttribute('aria-label', `${text} (E or click)`);
      lastLabel = text;
    }
    if (needsMeasure) {
      const rect = button.getBoundingClientRect();
      promptWidth = rect.width;
      promptHeight = rect.height;
      lastViewportWidth = window.innerWidth;
    }
    const margin = 8;
    const minX = Math.min(window.innerWidth / 2, margin + promptWidth / 2);
    const maxX = Math.max(minX, window.innerWidth - margin - promptWidth / 2);
    button.style.left = `${Math.min(maxX, Math.max(minX, screenX))}px`;
    button.style.top = `${Math.min(window.innerHeight - margin, Math.max(margin + promptHeight, screenY))}px`;
  }

  function hide() {
    button.hidden = true;
  }

  function showMessage(message: string) {
    feedback.textContent = message;
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => { feedback.textContent = ''; }, 4000);
  }

  function onActivate(callback: () => void) {
    button.addEventListener('click', callback);
    return () => button.removeEventListener('click', callback);
  }

  function dispose() {
    window.clearTimeout(messageTimer);
    button.remove();
    feedback.remove();
  }

  return { show, hide, showMessage, onActivate, dispose };
}
