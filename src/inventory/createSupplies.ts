/** The EBR-65 world egg reward is separate from an inventory Egg sale. */
export const EGG_SUPPLIES_YIELD = 5;

export function createSupplies() {
  let count = 0;
  const listeners = new Set<(count: number) => void>();

  function checkAmount(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('Amount must be a positive integer');
  }

  function notify() {
    for (const listener of listeners) listener(count);
  }

  function add(amount: number) {
    checkAmount(amount);
    if (!Number.isSafeInteger(count + amount)) throw new RangeError('Supplies count is too large');
    count += amount;
    notify();
  }

  function spend(amount: number) {
    checkAmount(amount);
    if (count < amount) return false;
    count -= amount;
    notify();
    return true;
  }

  function addEgg() {
    add(EGG_SUPPLIES_YIELD);
  }

  function subscribe(listener: (count: number) => void) {
    listeners.add(listener);
    listener(count);
    return () => { listeners.delete(listener); };
  }

  return { getCount: () => count, add, spend, addEgg, subscribe };
}

export type Supplies = ReturnType<typeof createSupplies>;
