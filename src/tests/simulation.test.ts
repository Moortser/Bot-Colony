import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../data/content";
import { addItem, addItems, itemCount } from "../simulation/inventory";
import { createBotEntity, Simulation } from "../simulation/simulation";
import type { BuildingEntity, BuildingTypeId } from "../simulation/types";

function addCompletedBuilding(
  simulation: Simulation,
  id: string,
  type: BuildingTypeId,
  x: number,
  y: number,
): BuildingEntity {
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
  };
  simulation.state.buildings[id] = building;
  return building;
}

describe("Seed bootstrap systems", () => {
  it("starts with no stored resources and can physically mine", () => {
    const simulation = new Simulation();
    expect(simulation.seed.inventory).toEqual({});
    expect(simulation.seed.battery).toBeLessThan(20);
    simulation.seed.battery = 100;
    expect(simulation.commandMine("ironOre")).toBe(true);
    simulation.stepFixed(300);
    expect(itemCount(simulation.seed.inventory, "ironOre")).toBe(8);
    expect(simulation.seed.position).not.toMatchObject({ x: 15, y: 15 });
    expect(simulation.state.deposits["deposit-iron-a"]?.remaining).toBe(72);
  });

  it("micro-smelts without duplicating matter", () => {
    const simulation = new Simulation();
    simulation.seed.battery = 100;
    addItem(simulation.seed.inventory, "ironOre", 1);
    const before = itemCount(simulation.seed.inventory, "ironOre") + itemCount(simulation.seed.inventory, "ironIngot");
    expect(simulation.commandCraft("microIron")).toBe(true);
    simulation.stepFixed(45);
    expect(simulation.seed.inventory).toEqual({ ironIngot: 1 });
    const after = itemCount(simulation.seed.inventory, "ironOre") + itemCount(simulation.seed.inventory, "ironIngot");
    expect(after).toBe(before);
  });

  it("places a site first, then lets the Seed supply and construct through the access point", () => {
    const simulation = new Simulation();
    simulation.seed.battery = 100;
    addItems(simulation.seed.inventory, { ironIngot: 2 });
    simulation.seed.position = { x: 20, y: 20 };
    const id = simulation.placeBuilding("storage", 21, 20);
    expect(id).toBeTruthy();
    expect(simulation.seed.inventory.ironIngot).toBe(2);
    expect(simulation.seed.reservedInventory.ironIngot).toBeUndefined();
    simulation.stepFixed();
    expect(simulation.state.logisticsRequests[`request:${id}:construction:ironIngot`]?.quantity).toBe(2);
    expect(simulation.commandConstructSite(id!)).toBe(true);
    expect(simulation.seed.reservedInventory.ironIngot).toBe(2);
    simulation.stepFixed(2);
    expect(simulation.seed.inventory.ironIngot).toBeUndefined();
    expect(simulation.state.buildings[id!]?.constructionInventory.ironIngot).toBe(2);
    simulation.stepFixed(55);
    expect(simulation.state.buildings[id!]?.complete).toBe(true);
  });

  it("runs dedicated furnace production and stops on full output", () => {
    const simulation = new Simulation();
    const furnace = addCompletedBuilding(simulation, "furnace-test", "furnace", 22, 22);
    addItem(furnace.input, "ironOre", 5);
    simulation.stepFixed(125);
    expect(itemCount(furnace.input, "ironOre")).toBe(2);
    expect(itemCount(furnace.output, "ironIngot")).toBe(3);
    expect(furnace.blockingReason).toBe("Output storage full");
    expect(simulation.state.flags.observedOutputFull).toBe(true);
  });
});

describe("physical research", () => {
  it("requires an operator, pauses when the operator leaves, then returns items and unlocks", () => {
    const simulation = new Simulation();
    const bench = addCompletedBuilding(simulation, "bench-test", "researchBench", 15, 15);
    simulation.seed.position = { x: 17, y: 16 };
    simulation.seed.battery = 100;
    addItems(simulation.seed.inventory, { ironOre: 1, ironIngot: 1 });
    expect(simulation.commandResearch("dedicatedSmelting", bench.id)).toBe(true);
    simulation.stepFixed(2);
    expect(bench.researchHold).toEqual({ ironOre: 1, ironIngot: 1 });
    expect(simulation.state.research.dedicatedSmelting.reservedItemRefs).toHaveLength(2);
    simulation.stepFixed(30);
    const activeProgress = simulation.state.research.dedicatedSmelting.progress;
    expect(activeProgress).toBeGreaterThan(0);
    simulation.seed.task = { kind: "idle", label: "Left bench", progress: 0, duration: 0 };
    simulation.stepFixed(30);
    expect(simulation.state.research.dedicatedSmelting.progress).toBeCloseTo(activeProgress);
    expect(simulation.state.research.dedicatedSmelting.blockingReason).toMatch(/operator/i);
    simulation.seed.task = {
      kind: "researching",
      label: "Operating bench",
      targetId: bench.id,
      progress: 0,
      duration: 12,
    };
    simulation.stepFixed(100);
    expect(simulation.state.research.dedicatedSmelting.completed).toBe(true);
    expect(bench.researchHold).toEqual({});
    expect(bench.output).toEqual({ ironOre: 1, ironIngot: 1 });
    expect(simulation.state.unlocks).toContain("building.furnace");
  });

  it("reserves exactly one of each distinct required component", () => {
    const simulation = new Simulation();
    simulation.state.research.dedicatedSmelting.completed = true;
    const bench = addCompletedBuilding(simulation, "bench-test", "researchBench", 15, 15);
    simulation.seed.position = { x: 17, y: 16 };
    simulation.seed.battery = 100;
    addItems(simulation.seed.inventory, {
      structuralFrame: 2,
      simpleMotor: 1,
      basicBattery: 1,
      controller: 1,
    });
    expect(simulation.commandResearch("utilityBotSystems", bench.id)).toBe(true);
    simulation.stepFixed(2);
    expect(bench.researchHold).toEqual({
      structuralFrame: 1,
      simpleMotor: 1,
      basicBattery: 1,
      controller: 1,
    });
    expect(simulation.seed.inventory.structuralFrame).toBe(1);
  });
});

describe("logistics, programs, and persistence", () => {
  it("prevents duplicate claims on one physical output request", () => {
    const simulation = new Simulation();
    const furnace = addCompletedBuilding(simulation, "furnace-test", "furnace", 18, 18);
    addItem(furnace.output, "ironIngot", 1);
    const first = createBotEntity("bot-a", "utility", { x: 17, y: 18 }, 1);
    const second = createBotEntity("bot-b", "utility", { x: 17, y: 19 }, 2);
    simulation.state.bots[first.id] = first;
    simulation.state.bots[second.id] = second;
    simulation.stepFixed();
    const requestId = `request:${furnace.id}:output:ironIngot`;
    expect(simulation.tryClaimRequest(requestId, first.id)).toBe(true);
    expect(simulation.tryClaimRequest(requestId, second.id)).toBe(false);
    expect(Object.values(simulation.state.reservations)).toHaveLength(1);
  });

  it("lets a hauler complete a reserved delivery and repeat", () => {
    const simulation = new Simulation();
    simulation.state.unlocks.push("program.basic");
    const furnace = addCompletedBuilding(simulation, "furnace-test", "furnace", 17, 17);
    const storage = addCompletedBuilding(simulation, "storage-test", "storage", 20, 17);
    addItem(furnace.output, "ironIngot", 2);
    const bot = createBotEntity("bot-hauler", "utility", { x: 17, y: 17 }, 1);
    simulation.state.bots[bot.id] = bot;
    simulation.assignProgram(bot.id, "factoryHauler");
    simulation.stepFixed(100);
    expect(itemCount(storage.input, "ironIngot")).toBe(2);
    expect(bot.program?.loopCount).toBeGreaterThan(0);
    expect(Object.values(simulation.state.reservations)).toHaveLength(0);
  });

  it("serializes and restores all authoritative state without renderer objects", () => {
    const simulation = new Simulation();
    simulation.seed.battery = 71;
    addItem(simulation.seed.inventory, "copperOre", 3);
    simulation.state.speed = 4;
    simulation.stepFixed(7);
    const restored = Simulation.restore(simulation.serialize());
    expect(restored.state).toEqual(simulation.state);
    expect(restored.seed.battery).toBe(71);
    expect(restored.seed.inventory.copperOre).toBe(3);
    expect(restored.state.speed).toBe(4);
  });
});
