import type { Inventory, ItemId } from "./types";

export function itemCount(inventory: Inventory, itemId: ItemId): number {
  return inventory[itemId] ?? 0;
}

export function inventoryTotal(inventory: Inventory): number {
  return Object.values(inventory).reduce((sum, quantity) => sum + (quantity ?? 0), 0);
}

export function canFit(inventory: Inventory, capacity: number, quantity = 1): boolean {
  return inventoryTotal(inventory) + quantity <= capacity;
}

export function hasItems(inventory: Inventory, required: Inventory): boolean {
  return (Object.entries(required) as Array<[ItemId, number]>).every(
    ([itemId, quantity]) => itemCount(inventory, itemId) >= quantity,
  );
}

export function addItem(inventory: Inventory, itemId: ItemId, quantity = 1): void {
  const next = itemCount(inventory, itemId) + quantity;
  if (next < 0) throw new Error(`Inventory underflow for ${itemId}`);
  if (next === 0) delete inventory[itemId];
  else inventory[itemId] = next;
}

export function removeItems(inventory: Inventory, required: Inventory): boolean {
  if (!hasItems(inventory, required)) return false;
  for (const [itemId, quantity] of Object.entries(required) as Array<[ItemId, number]>) {
    addItem(inventory, itemId, -quantity);
  }
  return true;
}

export function addItems(inventory: Inventory, items: Inventory): void {
  for (const [itemId, quantity] of Object.entries(items) as Array<[ItemId, number]>) {
    addItem(inventory, itemId, quantity);
  }
}

export function cloneInventory(inventory: Inventory): Inventory {
  return { ...inventory };
}

export function availableCount(inventory: Inventory, reserved: Inventory, itemId: ItemId): number {
  return Math.max(0, itemCount(inventory, itemId) - itemCount(reserved, itemId));
}

export function canReserve(inventory: Inventory, reserved: Inventory, required: Inventory): boolean {
  return (Object.entries(required) as Array<[ItemId, number]>).every(
    ([itemId, quantity]) => availableCount(inventory, reserved, itemId) >= quantity,
  );
}

export function transferItem(
  source: Inventory,
  destination: Inventory,
  destinationCapacity: number,
  itemId: ItemId,
  quantity: number,
): number {
  const moved = Math.min(itemCount(source, itemId), quantity, destinationCapacity - inventoryTotal(destination));
  if (moved <= 0) return 0;
  addItem(source, itemId, -moved);
  addItem(destination, itemId, moved);
  return moved;
}
