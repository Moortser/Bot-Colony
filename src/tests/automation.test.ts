import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../data/content";
import { addItem, itemCount } from "../simulation/inventory";
import { findPath, resolveInteractionPath, tileKey } from "../simulation/pathfinding/grid";
import { createProgramCommand } from "../simulation/programs/templates";
import { createBotEntity, Simulation } from "../simulation/simulation";
import type { BuildingEntity, BuildingTypeId } from "../simulation/types";

function addBuilding(simulation: Simulation, id: string, type: BuildingTypeId, x: number, y: number): BuildingEntity {
  const definition = BUILDINGS[type];
  const building: BuildingEntity = {
    id,
    kind: "building",
    type,
    name: definition.name,
    position: { x, y },
    footprint: { ...definition.footprint },
    complete: true,
    constructionProgress: 1,
    constructionInventory: {},
    input: {},
    output: {},
    researchHold: {},
    productionProgress: 0,
    activeRecipeId: type === "furnace" ? "furnaceIron" : undefined,
    power: 100,
    status: "Idle",
    blockingReason: "",
    cradleQueued: false,
    chargingProgress: 0,
  };
  simulation.state.buildings[id] = building;
  simulation.state.worldRevision += 1;
  return building;
}

function unlockPrograms(simulation: Simulation): void {
  if (!simulation.state.unlocks.includes("program.basic")) simulation.state.unlocks.push("program.basic");
}

describe("deterministic four-direction pathfinding", () => {
  it("finds the same non-diagonal route around blocked tiles", () => {
    const blocked = new Set([tileKey({ x: 2, y: 1 }), tileKey({ x: 2, y: 2 }), tileKey({ x: 2, y: 3 })]);
    const first = findPath(8, blocked, { x: 1, y: 2 }, { x: 4, y: 2 });
    const second = findPath(8, blocked, { x: 1, y: 2 }, { x: 4, y: 2 });
    expect(first.path).toEqual(second.path);
    expect(first.path.length).toBe(8);
    for (let index = 1; index < first.path.length; index += 1) {
      const before = first.path[index - 1]!;
      const after = first.path[index]!;
      expect(Math.abs(before.x - after.x) + Math.abs(before.y - after.y)).toBe(1);
    }
  });

  it("resolves an interaction tile outside a blocked footprint", () => {
    const simulation = new Simulation();
    const furnace = addBuilding(simulation, "furnace-route", "furnace", 15, 15);
    const route = resolveInteractionPath(simulation.state, { x: 12, y: 15 }, furnace, "input");
    expect(route.path.length).toBeGreaterThan(0);
    expect(route.interactionDestination).toBeDefined();
    const point = route.interactionDestination!;
    expect(point.x < 15 || point.x >= 17 || point.y < 15 || point.y >= 17).toBe(true);
  });
});

describe("Basic Brain interpreter", () => {
  it("executes the stored command order and exposes a useful misordered failure", () => {
    const simulation = new Simulation();
    unlockPrograms(simulation);
    const bot = createBotEntity("bot-order", "utility", { x: 14, y: 14 }, 1);
    simulation.state.bots[bot.id] = bot;
    expect(simulation.assignProgram(bot.id, "ironMiner")).toBe(true);
    expect(simulation.reorderProgram(bot.id, 1, -1)).toBe(true);
    simulation.stepFixed();
    expect(bot.program?.commands[0]?.kind).toBe("moveToTarget");
    expect(bot.program?.running).toBe(false);
    expect(bot.program?.blockingReason).toBe("No current target");
  });

  it("releases uncollected reservations and dock claims when stopped without deleting cargo", () => {
    const simulation = new Simulation();
    unlockPrograms(simulation);
    const furnace = addBuilding(simulation, "furnace-stop", "furnace", 15, 15);
    addBuilding(simulation, "storage-stop", "storage", 20, 15);
    const station = addBuilding(simulation, "charger-stop", "chargingStation", 12, 17);
    addItem(furnace.output, "ironIngot", 2);
    const bot = createBotEntity("bot-stop", "utility", { x: 14, y: 15 }, 1);
    simulation.state.bots[bot.id] = bot;
    simulation.assignProgram(bot.id, "factoryHauler");
    simulation.stepFixed();
    expect(Object.values(simulation.state.reservations)).toHaveLength(1);
    addItem(bot.inventory, "copperOre", 1);
    station.chargingBotId = bot.id;
    simulation.stopProgram(bot.id);
    expect(Object.values(simulation.state.reservations)).toHaveLength(0);
    expect(Object.values(simulation.state.logisticsRequests).some((request) => request.claimedBy === bot.id)).toBe(false);
    expect(station.chargingBotId).toBeUndefined();
    expect(itemCount(bot.inventory, "copperOre")).toBe(1);
  });

  it("allows only one bot to reserve a charging dock", () => {
    const simulation = new Simulation();
    unlockPrograms(simulation);
    const station = addBuilding(simulation, "charger-one", "chargingStation", 15, 15);
    const first = createBotEntity("bot-charge-a", "utility", { x: 13, y: 15 }, 1);
    const second = createBotEntity("bot-charge-b", "utility", { x: 13, y: 16 }, 2);
    first.battery = 10;
    second.battery = 10;
    simulation.state.bots[first.id] = first;
    simulation.state.bots[second.id] = second;
    simulation.assignProgram(first.id, "ironMiner");
    simulation.assignProgram(second.id, "factoryHauler");
    for (const bot of [first, second]) {
      bot.program!.commands = [createProgramCommand("rechargeIfBelow", `${bot.id}-charge`), createProgramCommand("repeat", `${bot.id}-repeat`)];
      simulation.restartProgram(bot.id);
    }
    simulation.stepFixed();
    expect(station.chargingBotId).toBe(first.id);
    expect(second.program?.blockingReason).toBe("All charging docks occupied");
  });

  it("serializes an in-flight program, path, request, and reservation exactly", () => {
    const simulation = new Simulation();
    unlockPrograms(simulation);
    const furnace = addBuilding(simulation, "furnace-save", "furnace", 15, 15);
    addBuilding(simulation, "storage-save", "storage", 22, 15);
    addItem(furnace.output, "ironIngot", 2);
    const bot = createBotEntity("bot-save", "utility", { x: 10, y: 15 }, 1);
    simulation.state.bots[bot.id] = bot;
    simulation.assignProgram(bot.id, "factoryHauler");
    simulation.stepFixed(8);
    expect(bot.path.status).toBe("moving");
    expect(Object.keys(simulation.state.reservations)).toHaveLength(1);
    const restored = Simulation.restore(simulation.serialize());
    expect(restored.state).toEqual(simulation.state);
  });

  it("runs the complete deposit-to-storage loop and earns sustained automation credit", () => {
    const simulation = new Simulation();
    unlockPrograms(simulation);
    addBuilding(simulation, "furnace-loop", "furnace", 15, 15);
    const storage = addBuilding(simulation, "storage-loop", "storage", 21, 15);
    addBuilding(simulation, "charger-loop", "chargingStation", 12, 18);
    const miner = createBotEntity("bot-miner", "utility", { x: 11, y: 14 }, 1);
    const hauler = createBotEntity("bot-hauler", "utility", { x: 18, y: 14 }, 2);
    simulation.state.bots[miner.id] = miner;
    simulation.state.bots[hauler.id] = hauler;
    simulation.assignProgram(miner.id, "ironMiner");
    simulation.assignProgram(hauler.id, "factoryHauler");
    simulation.stepFixed(4000);
    expect(itemCount(storage.input, "ironIngot")).toBeGreaterThanOrEqual(3);
    expect(simulation.state.automation.ironIngotsDelivered).toBeGreaterThanOrEqual(3);
    expect(simulation.state.automation.productiveSeconds).toBeGreaterThanOrEqual(30);
    expect(simulation.state.flags.autonomousLoop).toBe(true);
  });
});
