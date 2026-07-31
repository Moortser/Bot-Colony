import { describe, expect, it } from "vitest";
import {
  addItem,
  availableCount,
  canFit,
  canReserve,
  inventoryTotal,
  removeItems,
  transferItem,
} from "../simulation/inventory";
import type { Inventory } from "../simulation/types";

describe("physical inventories", () => {
  it("enforces capacity during transfer", () => {
    const source: Inventory = { ironOre: 5 };
    const destination: Inventory = { copperOre: 2 };
    expect(transferItem(source, destination, 4, "ironOre", 5)).toBe(2);
    expect(source.ironOre).toBe(3);
    expect(destination).toEqual({ copperOre: 2, ironOre: 2 });
    expect(canFit(destination, 4)).toBe(false);
  });

  it("prevents inventory underflow and atomic removal failure", () => {
    const inventory: Inventory = { ironOre: 1 };
    expect(removeItems(inventory, { ironOre: 2 })).toBe(false);
    expect(inventory).toEqual({ ironOre: 1 });
    expect(() => addItem(inventory, "ironOre", -2)).toThrow(/underflow/);
  });

  it("subtracts reservations from available physical quantity", () => {
    const inventory: Inventory = { ironIngot: 3, copperIngot: 1 };
    const reserved: Inventory = { ironIngot: 2 };
    expect(availableCount(inventory, reserved, "ironIngot")).toBe(1);
    expect(canReserve(inventory, reserved, { ironIngot: 1, copperIngot: 1 })).toBe(true);
    expect(canReserve(inventory, reserved, { ironIngot: 2 })).toBe(false);
    expect(inventoryTotal(inventory)).toBe(4);
  });
});
