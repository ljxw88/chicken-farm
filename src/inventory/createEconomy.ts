import type { Inventory } from './createInventory';
import type { Supplies } from './createSupplies';

// EBR-54: https://linear.app/ebrietas/issue/EBR-54/design-playable-sim-vertical-slice-feed-eggs-sell — rates remapped to Supplies.
export const ECONOMY_RATES = { sellEgg: 3, buyFeed: 1, placeFence: 5 } as const;

interface EconomyOptions {
  inventory: Inventory;
  supplies: Supplies;
  fence: { isPlaced: () => boolean; place: () => boolean };
}

export function createEconomy({ inventory, supplies, fence }: EconomyOptions) {
  function sellEgg() {
    if (!inventory.consume('egg')) return { ok: false, message: "Can't sell: no Eggs in inventory." };
    supplies.add(ECONOMY_RATES.sellEgg);
    return { ok: true, message: `Sold 1 Egg. +${ECONOMY_RATES.sellEgg} Supplies.` };
  }

  function buyFeed() {
    if (!supplies.spend(ECONOMY_RATES.buyFeed)) {
      return { ok: false, message: "Can't buy Feed: not enough Supplies." };
    }
    inventory.pickup('feed');
    return { ok: true, message: `Bought 1 Feed. −${ECONOMY_RATES.buyFeed} Supplies.` };
  }

  function placeFence() {
    if (supplies.getCount() < ECONOMY_RATES.placeFence) {
      return { ok: false, message: `Can't place fence: need ${ECONOMY_RATES.placeFence} Supplies.` };
    }
    if (fence.isPlaced()) return { ok: false, message: 'Fence already placed at the preview spot.' };
    if (!supplies.spend(ECONOMY_RATES.placeFence)) {
      return { ok: false, message: `Can't place fence: need ${ECONOMY_RATES.placeFence} Supplies.` };
    }
    if (!fence.place()) {
      supplies.add(ECONOMY_RATES.placeFence);
      return { ok: false, message: "Can't place fence at the preview spot." };
    }
    return { ok: true, message: `Placed one fence. −${ECONOMY_RATES.placeFence} Supplies.` };
  }

  return { sellEgg, buyFeed, placeFence };
}

export type Economy = ReturnType<typeof createEconomy>;
