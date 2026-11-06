import { ECONOMY_RATES, type Economy } from '../inventory/createEconomy';

interface EconomyControlsOptions {
  root: HTMLElement;
  economy: Economy;
  onAction: (message: string) => void;
}

/** Simple on-screen shortcuts to the same actions as the market sign and bin. */
export function createEconomyControls({ root, economy, onAction }: EconomyControlsOptions) {
  const panel = root.ownerDocument.createElement('div');
  panel.className = 'farm-market farm-glass';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Market and fence prices in Supplies');
  panel.innerHTML = `
    <button class="farm-buff farm-market__action" type="button" data-sell-egg>Sell Egg<small>+${ECONOMY_RATES.sellEgg} Supplies</small></button>
    <button class="farm-buff farm-market__action" type="button" data-buy-feed>Buy Feed<small>−${ECONOMY_RATES.buyFeed} Supplies</small></button>
    <button class="farm-buff farm-market__action" type="button" data-place-fence>Place Fence<small>−${ECONOMY_RATES.placeFence} Supplies</small></button>
  `;
  root.append(panel);

  const actions = [
    ['[data-sell-egg]', economy.sellEgg],
    ['[data-buy-feed]', economy.buyFeed],
    ['[data-place-fence]', economy.placeFence],
  ] as const;
  const bindings = actions.map(([selector, action]) => {
    const button = panel.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`Economy control not found: ${selector}`);
    const handler = () => onAction(action().message);
    button.addEventListener('click', handler);
    return { button, handler };
  });

  function dispose() {
    bindings.forEach(({ button, handler }) => button.removeEventListener('click', handler));
    panel.remove();
  }

  return { dispose };
}
