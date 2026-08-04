import { describe, expect, it } from "vitest";
import { BUILDINGS, RESEARCH } from "../data/content";
import { addItems, itemCount } from "../simulation/inventory";
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
    projectPriority: "normal",
    cancelled: false,
    automatedConstructionDeliveries: 0,
  };
  simulation.state.buildings[id] = building;
  simulation.state.worldRevision += 1;
  return building;
}

function addSupplier(simulation: Simulation, id = "bot-supplier", x = 10, y = 12) {
  if (!simulation.state.unlocks.includes("program.basic")) simulation.state.unlocks.push("program.basic");
  const bot = createBotEntity(id, "utility", { x, y }, Object.keys(simulation.state.bots).length);
  simulation.state.bots[id] = bot;
  expect(simulation.assignProgram(id, "colonySupplier")).toBe(true);
  return bot;
}

describe("construction project supply", () => {
  it("places an empty site, creates per-item requests, and lets the Seed retain the manual bootstrap path", () => {
    const simulation = new Simulation();
    simulation.seed.battery = 100;
    const siteId = simulation.placeBuilding("researchBench", 18, 18)!;
    simulation.stepFixed();
    const site = simulation.state.buildings[siteId]!;
    expect(site.complete).toBe(false);
    expect(site.constructionInventory).toEqual({});
    expect(simulation.state.logisticsRequests[`request:${siteId}:construction:ironIngot`]?.quantity).toBe(2);
    expect(simulation.state.logisticsRequests[`request:${siteId}:construction:copperIngot`]?.quantity).toBe(1);
    addItems(simulation.seed.inventory, { ironIngot: 2, copperIngot: 1 });
    expect(simulation.commandConstructSite(siteId)).toBe(true);
    simulation.stepFixed(160);
    expect(site.complete).toBe(true);
    expect(site.constructionInventory).toEqual({});
  });

  it("cancels a manual delivery in flight without consuming Seed cargo or resurrecting the site", () => {
    const simulation = new Simulation();
    simulation.seed.battery = 100;
    addItems(simulation.seed.inventory, { ironIngot: 2 });
    const siteId = simulation.placeBuilding("storage", 24, 18)!;
    expect(simulation.commandConstructSite(siteId)).toBe(true);
    expect(simulation.seed.task.kind).toBe("moving");
    expect(simulation.cancelConstructionSite(siteId)).toBe(true);
    expect(simulation.seed.task.kind).toBe("idle");
    expect(itemCount(simulation.seed.inventory, "ironIngot")).toBe(2);
    expect(itemCount(simulation.seed.reservedInventory, "ironIngot")).toBe(0);
    simulation.stepFixed(300);
    expect(simulation.state.buildings[siteId]?.cancelled).toBe(true);
    expect(simulation.state.buildings[siteId]?.complete).toBe(false);
    expect(itemCount(simulation.state.buildings[siteId]!.constructionInventory, "ironIngot")).toBe(0);
  });

  it("reserves public storage, physically collects and delivers, then waits for the Seed constructor", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-project", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 2 });
    const siteId = simulation.placeBuilding("storage", 17, 10)!;
    const supplier = addSupplier(simulation);
    simulation.stepFixed(500);
    const site = simulation.state.buildings[siteId]!;
    expect(itemCount(storage.input, "ironIngot")).toBe(0);
    expect(itemCount(site.constructionInventory, "ironIngot")).toBe(2);
    expect(site.status).toBe("Ready: Awaiting constructor");
    expect(site.complete).toBe(false);
    expect(site.automatedConstructionDeliveries).toBe(2);
    expect(supplier.program?.loopCount).toBeGreaterThan(0);

    simulation.seed.battery = 100;
    expect(simulation.commandConstructSite(siteId)).toBe(true);
    simulation.stepFixed(120);
    expect(site.complete).toBe(true);
    expect(simulation.state.flags.delegatedConstruction).toBe(true);
  });

  it("prevents duplicate source reservations and reopens only the truly missing quantity", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-shared", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 2 });
    const siteId = simulation.placeBuilding("storage", 18, 10)!;
    const first = addSupplier(simulation, "bot-supplier-a", 9, 12);
    const second = addSupplier(simulation, "bot-supplier-b", 9, 13);
    simulation.stepFixed(2);
    const reservations = Object.values(simulation.state.reservations);
    expect(reservations).toHaveLength(1);
    expect([first.id, second.id]).toContain(reservations[0]?.botId);
    expect(reservations[0]?.quantity).toBe(2);
    simulation.stepFixed(500);
    const request = simulation.state.logisticsRequests[`request:${siteId}:construction:ironIngot`];
    expect(request?.active).toBe(false);
    expect(itemCount(simulation.state.buildings[siteId]!.constructionInventory, "ironIngot")).toBe(2);
  });

  it("leaves the exact remainder open after a cargo-limited partial delivery", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-partial", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 2 });
    const siteId = simulation.placeBuilding("storage", 18, 10)!;
    const supplier = addSupplier(simulation, "bot-partial", 9, 12);
    addItems(supplier.inventory, { copperOre: 3 });
    for (let index = 0; index < 500 && itemCount(simulation.state.buildings[siteId]!.constructionInventory, "ironIngot") === 0; index += 1) {
      simulation.stepFixed();
    }
    expect(itemCount(simulation.state.buildings[siteId]!.constructionInventory, "ironIngot")).toBe(1);
    simulation.stopProgram(supplier.id);
    simulation.stepFixed();
    const request = simulation.state.logisticsRequests[`request:${siteId}:construction:ironIngot`];
    expect(request?.quantity).toBe(1);
    expect(request?.reservedQuantity).toBe(0);
    expect(request?.inTransitQuantity).toBe(0);
    expect(itemCount(storage.input, "ironIngot")).toBe(1);
  });

  it("cancels safely, releases claims, preserves carried cargo, and exposes delivered salvage", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-cancel", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 2 });
    const siteId = simulation.placeBuilding("storage", 19, 10)!;
    const supplier = addSupplier(simulation, "bot-cancel", 9, 10);
    simulation.stepFixed(250);
    const site = simulation.state.buildings[siteId]!;
    expect(itemCount(site.constructionInventory, "ironIngot") + itemCount(supplier.inventory, "ironIngot")).toBe(2);
    expect(simulation.cancelConstructionSite(siteId)).toBe(true);
    expect(Object.values(simulation.state.reservations).filter((entry) => entry.destinationId === siteId)).toHaveLength(0);
    expect(itemCount(site.output, "ironIngot") + itemCount(supplier.inventory, "ironIngot")).toBe(2);
    expect(site.cancelled).toBe(true);
    expect(simulation.canPlaceBuilding("storage", 19, 10).valid).toBe(true);
  });
});

describe("research project supply", () => {
  it("creates one request per distinct example, waits for delivery and operator, then returns every item", () => {
    const simulation = new Simulation();
    simulation.state.research.dedicatedSmelting.completed = true;
    simulation.state.research.utilityBotSystems.completed = true;
    const storage = addBuilding(simulation, "storage-research", "storage", 10, 10);
    const bench = addBuilding(simulation, "bench-project", "researchBench", 18, 10);
    addItems(storage.input, { structuralFrame: 1, controller: 1, copperIngot: 1 });
    expect(simulation.commandResearch("projectCoordination", bench.id)).toBe(true);
    simulation.stepFixed();
    const requests = Object.values(simulation.state.logisticsRequests).filter((request) => request.type === "researchItem");
    expect(requests.map((request) => request.itemId).sort()).toEqual(["controller", "copperIngot", "structuralFrame"]);
    addSupplier(simulation, "bot-research", 9, 12);
    simulation.stepFixed(1200);
    const node = simulation.state.research.projectCoordination;
    expect(bench.researchHold).toEqual({ structuralFrame: 1, controller: 1, copperIngot: 1 });
    expect(node.progress).toBe(0);
    expect(node.automatedDeliveries).toBe(3);
    expect(bench.status).toBe("Ready: Awaiting operator");

    simulation.seed.battery = 100;
    simulation.seed.position = { x: 20, y: 11 };
    expect(simulation.commandOperateResearch(bench.id)).toBe(true);
    simulation.stepFixed(500);
    expect(node.completed).toBe(true);
    expect(bench.output).toEqual({ structuralFrame: 1, controller: 1, copperIngot: 1 });
    expect(simulation.state.unlocks).toContain("project.priority");
    expect(simulation.state.flags.delegatedResearch).toBe(true);
    simulation.stepFixed();
    expect(Object.values(simulation.state.logisticsRequests).filter((request) => request.type === "buildingOutput" && request.buildingId === bench.id)).toHaveLength(3);

    const hauler = createBotEntity("bot-return-hauler", "utility", { x: 10, y: 12 }, 2);
    simulation.state.bots[hauler.id] = hauler;
    expect(simulation.assignProgram(hauler.id, "factoryHauler")).toBe(true);
    expect(simulation.updateProgramCommand(hauler.id, 0, { itemId: undefined })).toBe(true);
    simulation.stepFixed(1200);
    expect(bench.output).toEqual({});
    expect(itemCount(storage.input, "structuralFrame")).toBe(1);
    expect(itemCount(storage.input, "controller")).toBe(1);
    expect(itemCount(storage.input, "copperIngot")).toBe(1);
  });

  it("cancelling research releases source claims and preserves delivered and in-transit items", () => {
    const simulation = new Simulation();
    simulation.state.research.utilityBotSystems.completed = true;
    const storage = addBuilding(simulation, "storage-research-cancel", "storage", 10, 10);
    const bench = addBuilding(simulation, "bench-cancel", "researchBench", 22, 10);
    addItems(storage.input, { structuralFrame: 1, controller: 1, copperIngot: 1 });
    simulation.commandResearch("projectCoordination", bench.id);
    const supplier = addSupplier(simulation, "bot-research-cancel", 9, 12);
    simulation.stepFixed(300);
    const before = itemCount(bench.researchHold, "structuralFrame") + itemCount(supplier.inventory, "structuralFrame") + itemCount(storage.input, "structuralFrame");
    expect(simulation.cancelResearch(bench.id)).toBe(true);
    const after = itemCount(bench.output, "structuralFrame") + itemCount(supplier.inventory, "structuralFrame") + itemCount(storage.input, "structuralFrame");
    expect(after).toBe(before);
    expect(Object.values(simulation.state.reservations).filter((entry) => entry.destinationId === bench.id)).toHaveLength(0);
  });
});

describe("project priorities, interpreter data, and persistence", () => {
  it("keeps priority controls locked, then chooses High before an older Normal project deterministically", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-priority", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 4 });
    const olderId = simulation.placeBuilding("storage", 18, 10)!;
    simulation.stepFixed(5);
    const highId = simulation.placeBuilding("storage", 18, 16)!;
    expect(simulation.setProjectPriority(highId, "high")).toBe(false);
    simulation.state.unlocks.push("project.priority");
    expect(simulation.setProjectPriority(highId, "high")).toBe(true);
    const supplier = addSupplier(simulation, "bot-priority", 9, 12);
    simulation.stepFixed(2);
    expect(supplier.program?.templateId).toBe("colonySupplier");
    expect(supplier.program?.commands.map((command) => command.kind)).toEqual([
      "claimProjectSupplyRequest",
      "moveToRequestSource",
      "collectReserved",
      "moveToRequestDestination",
      "deliverReserved",
      "rechargeIfBelow",
      "repeat",
    ]);
    expect(simulation.state.reservations[supplier.program!.currentReservationId!]?.destinationId).toBe(highId);
    expect(simulation.state.buildings[olderId]?.projectPriority).toBe("normal");
  });

  it("chooses Normal over an older Low request and supports research-only filtering", () => {
    const simulation = new Simulation();
    simulation.state.research.utilityBotSystems.completed = true;
    simulation.state.unlocks.push("project.priority");
    const storage = addBuilding(simulation, "storage-priority-filter", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 2, structuralFrame: 1, controller: 1, copperIngot: 1 });
    const lowId = simulation.placeBuilding("storage", 18, 10)!;
    expect(simulation.setProjectPriority(lowId, "low")).toBe(true);
    simulation.stepFixed(5);
    const bench = addBuilding(simulation, "bench-priority-filter", "researchBench", 18, 16);
    expect(simulation.commandResearch("projectCoordination", bench.id)).toBe(true);
    const supplier = addSupplier(simulation, "bot-priority-filter", 9, 12);
    simulation.stepFixed(2);
    expect(simulation.state.reservations[supplier.program!.currentReservationId!]?.destinationId).toBe(bench.id);
    simulation.stopProgram(supplier.id);
    expect(simulation.updateProgramCommand(supplier.id, 0, { projectFilter: "research" })).toBe(true);
    expect(simulation.startProgram(supplier.id, true)).toBe(true);
    simulation.stepFixed(2);
    const filteredReservation = simulation.state.reservations[supplier.program!.currentReservationId!];
    expect(filteredReservation?.destinationId).toBe(bench.id);
    expect(simulation.state.buildings[lowId]?.projectPriority).toBe("low");
  });

  it("uses oldest-open ordering before path cost for equal-priority requests", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-oldest", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 4 });
    const olderId = simulation.placeBuilding("storage", 25, 20)!;
    simulation.stepFixed(5);
    simulation.placeBuilding("storage", 14, 10);
    const supplier = addSupplier(simulation, "bot-oldest", 9, 12);
    simulation.stepFixed(2);
    expect(simulation.state.reservations[supplier.program!.currentReservationId!]?.destinationId).toBe(olderId);
  });

  it("reordering project commands blocks clearly and stopping releases uncollected stock reservations", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-order", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 2 });
    simulation.placeBuilding("storage", 18, 10);
    const supplier = addSupplier(simulation, "bot-project-order", 9, 12);
    expect(simulation.reorderProgram(supplier.id, 1, -1)).toBe(true);
    simulation.stepFixed();
    expect(supplier.program?.running).toBe(false);
    expect(supplier.program?.blockingReason).toMatch(/project source/i);
    simulation.assignProgram(supplier.id, "colonySupplier");
    simulation.stepFixed();
    expect(Object.values(simulation.state.reservations)).toHaveLength(1);
    simulation.stopProgram(supplier.id);
    expect(Object.values(simulation.state.reservations)).toHaveLength(0);
    expect(itemCount(storage.input, "ironIngot")).toBe(2);
  });

  it("restores a project delivery in flight without duplication and resumes to completion", () => {
    const simulation = new Simulation();
    const storage = addBuilding(simulation, "storage-save-project", "storage", 10, 10);
    addItems(storage.input, { ironIngot: 2 });
    const siteId = simulation.placeBuilding("storage", 24, 10)!;
    const supplier = addSupplier(simulation, "bot-save-project", 9, 12);
    simulation.stepFixed(120);
    const beforeTotal = itemCount(storage.input, "ironIngot") + itemCount(supplier.inventory, "ironIngot") + itemCount(simulation.state.buildings[siteId]!.constructionInventory, "ironIngot");
    const restored = Simulation.restore(simulation.serialize());
    expect(restored.state).toEqual(simulation.state);
    restored.stepFixed(700);
    const restoredSupplier = restored.state.bots[supplier.id]!;
    const afterTotal = itemCount(restored.state.buildings[storage.id]!.input, "ironIngot") + itemCount(restoredSupplier.inventory, "ironIngot") + itemCount(restored.state.buildings[siteId]!.constructionInventory, "ironIngot");
    expect(afterTotal).toBe(beforeTotal);
    expect(itemCount(restored.state.buildings[siteId]!.constructionInventory, "ironIngot")).toBe(2);
    expect(Object.values(restored.state.reservations)).toHaveLength(0);
  });

  it("Project Coordination is post-bot, longer than Utility Bot Systems, and returns its examples", () => {
    expect(RESEARCH.projectCoordination.prerequisites).toEqual(["utilityBotSystems"]);
    expect(RESEARCH.projectCoordination.duration).toBeGreaterThan(RESEARCH.utilityBotSystems.duration);
    expect(RESEARCH.projectCoordination.requiredItems).toEqual(["structuralFrame", "controller", "copperIngot"]);
    expect(RESEARCH.projectCoordination.consumeItems).toBe(false);
  });
});
