/** The temporary EBR-65 yield for the single QA egg. No trading is involved. */
export const EGG_SUPPLIES_YIELD = 5;

export function createSupplies() {
  let count = 0;
  const listeners = new Set<(count: number) => void>();

  function addEgg() {
    count += EGG_SUPPLIES_YIELD;
    for (const listener of listeners) listener(count);
  }

  function subscribe(listener: (count: number) => void) {
    listeners.add(listener);
    listener(count);
    return () => { listeners.delete(listener); };
  }

  return { getCount: () => count, addEgg, subscribe };
}

export type Supplies = ReturnType<typeof createSupplies>;
