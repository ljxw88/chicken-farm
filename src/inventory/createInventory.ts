export type InventoryItem = 'feed' | 'egg';
export type InventoryCounts = Readonly<Record<InventoryItem, number>>;

/** Session-only stacks. Pickup and consume are the hooks for future producers. */
export function createInventory() {
  const counts: Record<InventoryItem, number> = { feed: 5, egg: 0 };
  const listeners = new Set<(counts: InventoryCounts) => void>();

  function getCounts(): InventoryCounts {
    return { ...counts };
  }

  function notify() {
    for (const listener of listeners) listener(getCounts());
  }

  function checkAmount(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('Amount must be a positive integer');
  }

  function pickup(item: InventoryItem, amount = 1) {
    checkAmount(amount);
    if (!Number.isSafeInteger(counts[item] + amount)) throw new RangeError('Inventory count is too large');
    counts[item] += amount;
    notify();
  }

  function consume(item: InventoryItem, amount = 1) {
    checkAmount(amount);
    if (counts[item] < amount) return false;
    counts[item] -= amount;
    notify();
    return true;
  }

  function subscribe(listener: (counts: InventoryCounts) => void) {
    listeners.add(listener);
    listener(getCounts());
    return () => { listeners.delete(listener); };
  }

  return { getCounts, pickup, consume, subscribe };
}

export type Inventory = ReturnType<typeof createInventory>;
