import { BOT_FRAMES, BUILDINGS, ITEMS, OBJECTIVES, RECIPES, RESEARCH } from "../data/content";
import {
  addItem,
  addItems,
  canFit,
  canReserve,
  hasItems,
  inventoryTotal,
  itemCount,
  removeItems,
  transferItem,
} from "./inventory";
import { CHARGER_BUFFER_CAPACITY, CHARGER_REGEN_RATE, CHARGE_RATE, batteryPercent, reachableChargingStations } from "./energy/charging";
import { availableOutput, completeReservation, releaseReservation, reservedAtSource } from "./logistics/reservations";
import { clearBotPath, followBotPath, isBotAtInteraction, planBotPath } from "./movement/pathMovement";
import { resolveInteractionPath } from "./pathfinding/grid";
import { BASIC_BRAIN_COMMANDS, PROGRAM_TEMPLATES, createProgramCommand } from "./programs/templates";
import type {
  BotEntity,
  BotProgram,
  BotTask,
  BuildingEntity,
  BuildingTypeId,
  DepositEntity,
  GridPoint,
  Inventory,
  ItemId,
  LogisticsRequest,
  ProgramCommand,
  ProgramCommandParameters,
  ProgramCommandType,
  ProgramTemplateId,
  RecipeId,
  Reservation,
  ResearchId,
  ResearchNodeState,
  SelectableEntity,
  SimulationState,
} from "./types";

export const FIXED_STEP = 0.1;

const IDLE_TASK: BotTask = {
  kind: "idle",
  label: "Idle",
  progress: 0,
  duration: 0,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function distance(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createBotEntity(id: string, frame: "seed" | "utility", position: GridPoint, ordinal = 1): BotEntity {
  const definition = BOT_FRAMES[frame];
  return {
    id,
    kind: "bot",
    frame,
    name: frame === "seed" ? "Seed Drone // VN-01" : `Utility Bot // U-${String(ordinal).padStart(2, "0")}`,
    position: { ...position },
    battery: frame === "seed" ? 12 : definition.batteryCapacity,
    maxBattery: definition.batteryCapacity,
    inventory: {},
    inventoryCapacity: definition.inventoryCapacity,
    reservedInventory: {},
    modules: frame === "seed" ? ["bootstrapKit"] : ["miningTool", "cargoRack"],
    task: clone(IDLE_TASK),
    path: { tiles: [], currentIndex: 0, status: "idle", repathReason: "", worldRevision: 0 },
    status: frame === "seed" ? "Landed: bootstrap power critical" : "Idle: No program assigned",
    blockingReason: frame === "seed" ? "Battery below safe operating reserve" : "No program assigned",
    solarDeployed: false,
  };
}

function createInitialState(): SimulationState {
  const seed = createBotEntity("bot-seed", "seed", { x: 15, y: 15 });
  const research = {} as Record<ResearchId, ResearchNodeState>;
  for (const id of Object.keys(RESEARCH) as ResearchId[]) {
    research[id] = {
      id,
      completed: false,
      progress: 0,
      reservedItemRefs: [],
      blockingReason: "",
      priority: "normal",
      automatedDeliveries: 0,
    };
  }

  const deposits: Record<string, DepositEntity> = {
    "deposit-iron-a": {
      id: "deposit-iron-a",
      kind: "deposit",
      itemId: "ironOre",
      name: "Ferric Outcrop A",
      position: { x: 10, y: 14 },
      remaining: 80,
    },
    "deposit-iron-b": {
      id: "deposit-iron-b",
      kind: "deposit",
      itemId: "ironOre",
      name: "Ferric Outcrop B",
      position: { x: 8, y: 20 },
      remaining: 80,
    },
    "deposit-copper-a": {
      id: "deposit-copper-a",
      kind: "deposit",
      itemId: "copperOre",
      name: "Verdigris Seam",
      position: { x: 21, y: 12 },
      remaining: 70,
    },
  };

  return {
    version: 3,
    tick: 0,
    gameTime: 0,
    speed: 1,
    previousSpeed: 1,
    nextId: 1,
    mapSize: 32,
    worldRevision: 0,
    bots: { [seed.id]: seed },
    buildings: {},
    deposits,
    research,
    logisticsRequests: {},
    reservations: {},
    unlocks: ["building.storage", "building.researchBench"],
    objectiveIndex: 0,
    automation: { ironIngotsDelivered: 0, productiveSeconds: 0, completed: false },
    flags: {
      solarDeployed: false,
      minedIron: false,
      smeltedIron: false,
      builtStorage: false,
      smeltedCopper: false,
      builtBench: false,
      furnaceBuilt: false,
      fabricatedComponents: false,
      cradleBuilt: false,
      chargingStationBuilt: false,
      firstBotBuilt: false,
      minerRunning: false,
      observedOutputFull: false,
      autonomousLoop: false,
      delegatedConstruction: false,
      delegatedResearch: false,
      projectCoordination: false,
    },
    notifications: [
      {
        id: 0,
        text: "SEED LANDED // No stored matter // Deploy solar array",
        tone: "warning",
        expiresAt: 8,
      },
    ],
    debug: false,
    releaseEvents: [],
  };
}

function normalizeState(snapshot: unknown): SimulationState {
  const state = clone(snapshot) as SimulationState;
  const previousVersion = Number((state as SimulationState & { version?: number }).version ?? 1);
  if (previousVersion < 2) {
    state.worldRevision = 0;
    state.automation = { ironIngotsDelivered: 0, productiveSeconds: 0, completed: false };
    state.flags.chargingStationBuilt = false;
    state.logisticsRequests = {};
    state.reservations = {};
    for (const deposit of Object.values(state.deposits)) deposit.reservedBy = undefined;
    for (const bot of Object.values(state.bots)) {
      bot.path = { tiles: [], currentIndex: 0, status: "idle", repathReason: "Migrated save", worldRevision: 0 };
      if (!bot.program) continue;
      const template = PROGRAM_TEMPLATES[bot.program.templateId];
      bot.program = {
        id: `program-${state.nextId++}`,
        templateId: bot.program.templateId,
        name: template.name,
        commands: clone(template.commands),
        running: false,
        instructionPointer: 0,
        currentCommandId: template.commands[0]?.id,
        runtime: { elapsed: 0, phase: "idle", zeroDurationTransitions: 0, lastTransitionTick: state.tick },
        blockingReason: "Migrated program is stopped; inspect and restart it",
        loopCount: 0,
        currentStep: 0,
        blockedReason: "Migrated program is stopped; inspect and restart it",
        phase: "idle",
      };
    }
  }
  state.version = 3;
  state.releaseEvents ??= [];
  state.flags.delegatedConstruction ??= false;
  state.flags.delegatedResearch ??= false;
  state.flags.projectCoordination ??= false;
  if (previousVersion < 3) {
    for (const building of Object.values(state.buildings)) {
      building.projectPriority ??= "normal";
      building.cancelled ??= false;
      building.automatedConstructionDeliveries ??= 0;
    }
    for (const id of Object.keys(RESEARCH) as ResearchId[]) {
      state.research[id] ??= {
        id,
        completed: false,
        progress: 0,
        reservedItemRefs: [],
        blockingReason: "",
        priority: "normal",
        automatedDeliveries: 0,
      };
    }
    for (const node of Object.values(state.research)) {
      node.priority ??= "normal";
      node.automatedDeliveries ??= 0;
    }
    for (const request of Object.values(state.logisticsRequests)) {
      request.priority ??= "normal";
      request.createdAt ??= state.gameTime;
      request.requiredQuantity ??= request.quantity;
      request.deliveredQuantity ??= 0;
      request.inTransitQuantity ??= 0;
      request.blockingReason ??= "";
    }
  }
  for (const reservation of Object.values(state.reservations)) {
    if (previousVersion < 3) reservation.sourceInventory ??= state.buildings[reservation.sourceId]?.type === "storage" ? "input" : "output";
    const bot = state.bots[reservation.botId];
    const source = state.buildings[reservation.sourceId];
    const destination = state.buildings[reservation.destinationId];
    const request = state.logisticsRequests[reservation.requestId];
    const sourceInventory = source
      ? reservation.sourceInventory === "input" || (!reservation.sourceInventory && source.type === "storage")
        ? source.input
        : source.output
      : undefined;
    const sourceQuantityInvalid =
      reservation.state === "reserved" &&
      (!sourceInventory || itemCount(sourceInventory, reservation.itemId) < reservation.quantity);
    const cargoQuantityInvalid =
      reservation.state === "inTransit" &&
      !!bot &&
      itemCount(bot.inventory, reservation.itemId) < reservation.quantity - reservation.deliveredQuantity;
    if (!bot || !destination || !request || sourceQuantityInvalid || cargoQuantityInvalid) {
      if (request) {
        request.claimedBy = undefined;
        request.reservedQuantity = 0;
        request.state = request.active ? "open" : "invalid";
      }
      delete state.reservations[reservation.id];
      state.releaseEvents.push(`restore released invalid ${reservation.id}`);
    }
  }
  state.releaseEvents = state.releaseEvents.slice(-20);
  return state;
}

export class Simulation {
  public readonly state: SimulationState;
  private accumulator = 0;

  public constructor(snapshot?: string | SimulationState) {
    this.state =
      typeof snapshot === "string"
        ? normalizeState(JSON.parse(snapshot))
        : snapshot
          ? normalizeState(snapshot)
          : createInitialState();
  }

  public get seed(): BotEntity {
    const seed = this.state.bots["bot-seed"];
    if (!seed) throw new Error("Seed Drone is missing");
    return seed;
  }

  public advance(realDeltaSeconds: number): void {
    if (this.state.speed === 0) return;
    this.accumulator += Math.min(realDeltaSeconds, 0.25) * this.state.speed;
    while (this.accumulator >= FIXED_STEP) {
      this.updateFixed(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
  }

  public stepFixed(steps = 1): void {
    for (let index = 0; index < steps; index += 1) this.updateFixed(FIXED_STEP);
  }

  public serialize(): string {
    return JSON.stringify(this.state);
  }

  public static restore(serialized: string): Simulation {
    return new Simulation(serialized);
  }

  public setSpeed(speed: 0 | 1 | 2 | 4): void {
    if (speed !== 0) this.state.previousSpeed = speed;
    this.state.speed = speed;
  }

  public togglePause(): void {
    this.state.speed = this.state.speed === 0 ? this.state.previousSpeed : 0;
  }

  public toggleDebug(): void {
    this.state.debug = !this.state.debug;
  }

  public getEntity(id: string | undefined): SelectableEntity | undefined {
    if (!id) return undefined;
    return this.state.bots[id] ?? this.state.buildings[id] ?? this.state.deposits[id];
  }

  public commandSolar(): boolean {
    const seed = this.seed;
    if (seed.solarDeployed) {
      seed.solarDeployed = false;
      this.setIdle(seed, "Solar array retracted", "");
      return true;
    }
    this.cancelBotTask(seed);
    seed.solarDeployed = true;
    seed.task = { kind: "charging", label: "Solar array deployed", progress: 0, duration: 0 };
    seed.status = "Charging from local sunlight";
    seed.blockingReason = "Movement locked while solar array is deployed";
    this.state.flags.solarDeployed = true;
    this.notify("SOLAR ARRAY DEPLOYED // Movement interlock engaged", "info");
    return true;
  }

  public commandMine(itemId: "ironOre" | "copperOre"): boolean {
    const bot = this.seed;
    if (bot.battery < 8) return this.reject(bot, "Battery too low; deploy solar first");
    if (!canFit(bot.inventory, bot.inventoryCapacity)) return this.reject(bot, "Cargo is full");
    const deposit = this.nearestDeposit(bot.position, itemId);
    if (!deposit) return this.reject(bot, "No available deposit found");
    this.cancelBotTask(bot);
    bot.solarDeployed = false;
    if (!this.beginMove(bot, deposit, "deposit", {
      kind: "mining",
      label: `Mining ${deposit.name}`,
      targetId: deposit.id,
      progress: 0,
      duration: 2.4,
      itemId,
    })) return this.reject(bot, bot.path.repathReason);
    bot.status = `Travelling to ${deposit.name}`;
    return true;
  }

  public commandCraft(recipeId: RecipeId): boolean {
    const seed = this.seed;
    const recipe = RECIPES[recipeId];
    if (!recipe || recipeId === "furnaceIron" || recipeId === "utilityBot") return false;
    if (seed.solarDeployed) return this.reject(seed, "Retract solar array before using bootstrap machinery");
    if (!hasItems(seed.inventory, recipe.inputs) || !canReserve(seed.inventory, seed.reservedInventory, recipe.inputs)) {
      return this.reject(seed, `Missing unreserved inputs for ${recipe.name}`);
    }
    const outputQuantity = inventoryTotal(recipe.outputs);
    const inputQuantity = inventoryTotal(recipe.inputs);
    if (inventoryTotal(seed.inventory) - inputQuantity + outputQuantity > seed.inventoryCapacity) {
      return this.reject(seed, "Not enough free cargo space for output");
    }
    if (seed.battery < recipe.energy + 2) return this.reject(seed, "Battery too low for fabrication");
    this.cancelBotTask(seed);
    addItems(seed.reservedInventory, recipe.inputs);
    const kind = recipeId === "microIron" || recipeId === "microCopper" ? "microSmelting" : "fabricating";
    seed.task = {
      kind,
      label: `${kind === "microSmelting" ? "Micro-smelting" : "Fabricating"} ${recipe.name}`,
      progress: 0,
      duration: recipe.duration,
      recipeId,
      payload: { ...recipe.inputs },
    };
    seed.status = seed.task.label;
    seed.blockingReason = "Drone stationary while bootstrap machinery operates";
    return true;
  }

  public canPlaceBuilding(type: BuildingTypeId, x: number, y: number): { valid: boolean; reason: string } {
    const definition = BUILDINGS[type];
    if (!this.state.unlocks.includes(definition.unlockId)) return { valid: false, reason: "Blueprint locked" };
    if (x < 1 || y < 1 || x + definition.footprint.width >= this.state.mapSize - 1 || y + definition.footprint.height >= this.state.mapSize - 1) {
      return { valid: false, reason: "Footprint is outside the surveyed area" };
    }
    for (let tileX = x; tileX < x + definition.footprint.width; tileX += 1) {
      for (let tileY = y; tileY < y + definition.footprint.height; tileY += 1) {
        if (this.isTileOccupied(tileX, tileY)) return { valid: false, reason: "Footprint overlaps an entity" };
      }
    }
    return { valid: true, reason: "" };
  }

  public placeBuilding(type: BuildingTypeId, x: number, y: number): string | undefined {
    const placement = this.canPlaceBuilding(type, x, y);
    if (!placement.valid) {
      this.reject(this.seed, placement.reason);
      return undefined;
    }
    const definition = BUILDINGS[type];
    this.cancelBotTask(this.seed);
    const id = `building-${this.state.nextId++}`;
    const building: BuildingEntity = {
      id,
      kind: "building",
      type,
      name: definition.name,
      position: { x, y },
      footprint: { ...definition.footprint },
      complete: false,
      constructionProgress: 0,
      constructionInventory: {},
      input: {},
      output: {},
      researchHold: {},
      productionProgress: 0,
      activeRecipeId: type === "furnace" ? "furnaceIron" : undefined,
      power: 100,
      status: "Construction site placed",
      blockingReason: "Awaiting Seed Drone and reserved materials",
      cradleQueued: false,
      chargingProgress: 0,
      projectPriority: "normal",
      cancelled: false,
      automatedConstructionDeliveries: 0,
    };
    this.state.buildings[id] = building;
    this.state.worldRevision += 1;
    this.refreshRequests();
    building.status = "Awaiting project materials";
    building.blockingReason = "Supply manually or assign Colony Supplier";
    this.notify(`CONSTRUCTION MARKER // ${definition.name}`, "info");
    return id;
  }

  public commandSupplyBuilding(buildingId: string): boolean {
    const building = this.state.buildings[buildingId];
    if (!building?.complete) return false;
    const seed = this.seed;
    const itemId: ItemId = building.type === "furnace" ? "ironOre" : "ironIngot";
    if (itemCount(seed.inventory, itemId) <= 0) return this.reject(seed, `Seed cargo has no ${itemId}`);
    this.cancelBotTask(seed);
    if (!this.beginMove(seed, building, "input", {
      kind: "program",
      label: `Supplying ${building.name}`,
      targetId: building.id,
      itemId,
      progress: 0,
      duration: 0,
    })) return this.reject(seed, seed.path.repathReason);
    return true;
  }

  public commandConstructSite(buildingId: string): boolean {
    const building = this.state.buildings[buildingId];
    if (!building || building.complete || building.cancelled) return false;
    const cost = BUILDINGS[building.type].cost;
    const remaining: Inventory = {};
    for (const [itemId, quantity] of Object.entries(cost) as Array<[ItemId, number]>) {
      const missing = Math.max(0, quantity - itemCount(building.constructionInventory, itemId));
      if (missing > 0) remaining[itemId] = missing;
    }
    if (!canReserve(this.seed.inventory, this.seed.reservedInventory, remaining)) {
      return this.reject(this.seed, "Site is waiting for delivered materials; carry every missing item or assign Colony Supplier");
    }
    this.cancelBotTask(this.seed);
    addItems(this.seed.reservedInventory, remaining);
    if (!this.beginMove(this.seed, building, "construction", {
      kind: "building",
      label: `Constructing ${building.name}`,
      targetId: building.id,
      progress: 0,
      duration: BUILDINGS[building.type].buildTime,
      payload: remaining,
    })) {
      removeItems(this.seed.reservedInventory, remaining);
      return this.reject(this.seed, this.seed.path.repathReason);
    }
    building.manualProjectDelivery = { ...remaining };
    this.refreshRequests();
    return true;
  }

  public cancelConstructionSite(buildingId: string): boolean {
    const building = this.state.buildings[buildingId];
    if (!building || building.complete || building.cancelled) return false;
    this.releaseProjectClaims(building.id, "construction site cancelled");
    if (this.seed.task.targetId === building.id) this.cancelBotTask(this.seed);
    addItems(building.output, building.constructionInventory);
    building.constructionInventory = {};
    building.manualProjectDelivery = {};
    building.cancelled = true;
    building.status = "Cancelled: Salvage available";
    building.blockingReason = inventoryTotal(building.output) > 0 ? "Delivered materials moved to recoverable output" : "No delivered materials";
    this.state.worldRevision += 1;
    this.refreshRequests();
    this.notify(`${building.name.toUpperCase()} // Site cancelled safely`, "warning");
    return true;
  }

  public setProjectPriority(buildingId: string, priority: "high" | "normal" | "low"): boolean {
    const building = this.state.buildings[buildingId];
    if (!building || !this.state.unlocks.includes("project.priority")) return false;
    building.projectPriority = priority;
    if (building.activeResearchId) this.state.research[building.activeResearchId].priority = priority;
    this.refreshRequests();
    return true;
  }

  public commandCollectBuilding(buildingId: string): boolean {
    const building = this.state.buildings[buildingId];
    const available = building
      ? (Object.keys(building.output) as ItemId[]).reduce(
          (total, itemId) => total + availableOutput(this.state, building, itemId),
          0,
        )
      : 0;
    if ((!building?.complete && !building?.cancelled) || available === 0) {
      return this.reject(this.seed, "No finished items available");
    }
    this.cancelBotTask(this.seed);
    if (!this.beginMove(this.seed, building, "output", {
      kind: "program",
      label: `Collecting from ${building.name}`,
      targetId: building.id,
      progress: 0,
      duration: 0,
    })) return this.reject(this.seed, this.seed.path.repathReason);
    return true;
  }

  public commandDepositToStorage(storageId: string): boolean {
    const storage = this.state.buildings[storageId];
    if (!storage?.complete || storage.type !== "storage" || inventoryTotal(this.seed.inventory) === 0) return false;
    this.cancelBotTask(this.seed);
    if (!this.beginMove(this.seed, storage, "input", {
      kind: "program",
      label: `Depositing cargo at ${storage.name}`,
      targetId: storage.id,
      progress: 0,
      duration: 0,
    })) return this.reject(this.seed, this.seed.path.repathReason);
    return true;
  }

  public commandResearch(researchId: ResearchId, benchId: string): boolean {
    const definition = RESEARCH[researchId];
    const node = this.state.research[researchId];
    const bench = this.state.buildings[benchId];
    const seed = this.seed;
    if (!bench?.complete || bench.type !== "researchBench") return this.reject(seed, "Select a completed Research Bench");
    if (definition.disabled || definition.benchTier > 1) return this.reject(seed, "Requires a future research bench tier");
    if (node.completed) return this.reject(seed, "Research already completed");
    if (definition.prerequisites.some((id) => !this.state.research[id].completed)) {
      return this.reject(seed, "Prerequisite research is incomplete");
    }
    if (bench.activeResearchId) return this.reject(seed, "Research Bench is already assigned");
    node.assignedBenchId = bench.id;
    node.assignedOperatorId = undefined;
    node.priority = bench.projectPriority ?? "normal";
    node.blockingReason = "Awaiting physical example delivery";
    bench.activeResearchId = researchId;
    bench.operatorId = undefined;
    bench.status = `Awaiting examples: ${definition.name}`;
    bench.blockingReason = node.blockingReason;
    this.refreshRequests();
    const required = Object.fromEntries(
      definition.requiredItems
        .filter((itemId) => itemCount(bench.researchHold, itemId) === 0)
        .map((itemId) => [itemId, 1]),
    ) as Inventory;
    if (canReserve(seed.inventory, seed.reservedInventory, required)) return this.commandOperateResearch(bench.id);
    this.notify(`RESEARCH PROJECT // ${definition.name} awaiting examples`, "info");
    return true;
  }

  public commandOperateResearch(benchId: string): boolean {
    const bench = this.state.buildings[benchId];
    const seed = this.seed;
    const researchId = bench?.activeResearchId;
    if (!bench?.complete || bench.type !== "researchBench" || !researchId) return this.reject(seed, "No selected research project");
    const definition = RESEARCH[researchId];
    const node = this.state.research[researchId];
    const required = Object.fromEntries(
      definition.requiredItems
        .filter((itemId) => itemCount(bench.researchHold, itemId) === 0)
        .map((itemId) => [itemId, 1]),
    ) as Inventory;
    if (!canReserve(seed.inventory, seed.reservedInventory, required)) {
      node.blockingReason = "Awaiting delivered examples or missing examples in Seed cargo";
      return this.reject(seed, node.blockingReason);
    }
    this.cancelBotTask(seed);
    addItems(seed.reservedInventory, required);
    node.assignedOperatorId = seed.id;
    node.blockingReason = inventoryTotal(required) > 0 ? "Operator travelling with physical examples" : "Operator travelling to ready bench";
    bench.operatorId = seed.id;
    bench.status = `Preparing ${definition.name}`;
    bench.blockingReason = node.blockingReason;
    if (!this.beginMove(seed, bench, "operator", {
      kind: "researching",
      label: `Operating bench: ${definition.name}`,
      targetId: bench.id,
      progress: 0,
      duration: definition.duration,
      payload: required,
    })) {
      removeItems(seed.reservedInventory, required);
      node.assignedOperatorId = undefined;
      bench.operatorId = undefined;
      return this.reject(seed, seed.path.repathReason);
    }
    bench.manualProjectDelivery = { ...required };
    this.refreshRequests();
    return true;
  }

  public cancelResearch(benchId: string): boolean {
    const bench = this.state.buildings[benchId];
    if (!bench?.activeResearchId) return false;
    const node = this.state.research[bench.activeResearchId];
    this.releaseProjectClaims(bench.id, "research cancelled");
    for (const itemId of RESEARCH[node.id].requiredItems) {
      if (itemCount(bench.researchHold, itemId) > 0) {
        addItem(bench.researchHold, itemId, -1);
        addItem(bench.output, itemId, 1);
      }
    }
    node.reservedItemRefs = [];
    node.assignedBenchId = undefined;
    node.assignedOperatorId = undefined;
    node.blockingReason = "Cancelled; example items returned to bench output";
    bench.activeResearchId = undefined;
    bench.operatorId = undefined;
    bench.manualProjectDelivery = {};
    bench.status = "Idle";
    bench.blockingReason = "No research selected";
    if (this.seed.task.targetId === benchId) this.cancelBotTask(this.seed);
    return true;
  }

  public commandBuildBot(cradleId: string): boolean {
    const cradle = this.state.buildings[cradleId];
    const seed = this.seed;
    if (!cradle?.complete || cradle.type !== "botCradle") return false;
    if (cradle.cradleQueued) return this.reject(seed, "Construction cradle is already occupied");
    const recipe = RECIPES.utilityBot;
    if (!canReserve(seed.inventory, seed.reservedInventory, recipe.inputs)) {
      return this.reject(seed, "Carry one Frame, Motor, Battery, and Controller");
    }
    this.cancelBotTask(seed);
    addItems(seed.reservedInventory, recipe.inputs);
    if (!this.beginMove(seed, cradle, "input", {
      kind: "supplyingCradle",
      label: "Supplying Basic Utility Bot components",
      targetId: cradle.id,
      progress: 0,
      duration: 0,
      payload: { ...recipe.inputs },
    })) {
      removeItems(seed.reservedInventory, recipe.inputs);
      return this.reject(seed, seed.path.repathReason);
    }
    return true;
  }

  public assignProgram(botId: string, templateId: ProgramTemplateId): boolean {
    const bot = this.state.bots[botId];
    if (!bot || bot.frame !== "utility" || !this.state.unlocks.includes("program.basic")) return false;
    this.releaseBotClaims(bot.id);
    const definition = PROGRAM_TEMPLATES[templateId];
    const program: BotProgram = {
      id: `program-${this.state.nextId++}`,
      templateId,
      name: definition.name,
      commands: clone(definition.commands),
      running: true,
      instructionPointer: 0,
      currentCommandId: definition.commands[0]?.id,
      runtime: { elapsed: 0, phase: "idle", zeroDurationTransitions: 0, lastTransitionTick: this.state.tick },
      blockingReason: "",
      loopCount: 0,
      currentStep: 0,
      blockedReason: "",
      phase: "idle",
    };
    bot.program = program;
    bot.modules = ["miningTool", "cargoRack"];
    bot.task = { kind: "program", label: `${definition.name}: acquiring task`, progress: 0, duration: 0 };
    bot.status = `${definition.name} program running`;
    bot.blockingReason = "";
    if (templateId === "ironMiner") this.state.flags.minerRunning = true;
    this.notify(`${bot.name} // ${definition.name} assigned`, "success");
    return true;
  }

  public stopProgram(botId: string): boolean {
    const bot = this.state.bots[botId];
    if (!bot?.program) return false;
    bot.program.running = false;
    bot.program.blockingReason = "Program stopped by operator";
    bot.program.blockedReason = "Program stopped by operator";
    this.releaseBotClaims(bot.id);
    this.setIdle(bot, "Program stopped", "Awaiting program start");
    return true;
  }

  public startProgram(botId: string, restart = false): boolean {
    const bot = this.state.bots[botId];
    if (!bot?.program) return false;
    if (restart) this.resetProgramRuntime(bot, true);
    bot.program.running = true;
    bot.program.blockingReason = "";
    bot.program.blockedReason = "";
    bot.blockingReason = "";
    bot.status = `${bot.program.name} program running`;
    return true;
  }

  public restartProgram(botId: string): boolean {
    return this.startProgram(botId, true);
  }

  public tryClaimRequest(requestId: string, botId: string): boolean {
    const request = this.state.logisticsRequests[requestId];
    const bot = this.state.bots[botId];
    return !!request && !!bot && request.active && this.claimRequest(request, bot);
  }

  public reorderProgram(botId: string, commandIndex: number, direction: -1 | 1): boolean {
    const bot = this.state.bots[botId];
    const program = bot?.program;
    if (!program) return false;
    const nextIndex = commandIndex + direction;
    if (nextIndex < 0 || nextIndex >= program.commands.length) return false;
    const command = program.commands[commandIndex];
    const other = program.commands[nextIndex];
    if (!command || !other) return false;
    program.commands[commandIndex] = other;
    program.commands[nextIndex] = command;
    if (bot) this.resetProgramRuntime(bot, true);
    return true;
  }

  public addProgramCommand(botId: string, kind: ProgramCommandType): boolean {
    const bot = this.state.bots[botId];
    if (!bot?.program || !BASIC_BRAIN_COMMANDS.some((entry) => entry.kind === kind)) return false;
    bot.program.commands.push(createProgramCommand(kind, `command-${this.state.nextId++}`));
    this.resetProgramRuntime(bot, true);
    return true;
  }

  public removeProgramCommand(botId: string, commandIndex: number): boolean {
    const bot = this.state.bots[botId];
    if (!bot?.program || !bot.program.commands[commandIndex]) return false;
    bot.program.commands.splice(commandIndex, 1);
    this.resetProgramRuntime(bot, true);
    return true;
  }

  public updateProgramCommand(botId: string, commandIndex: number, parameters: ProgramCommandParameters): boolean {
    const bot = this.state.bots[botId];
    const command = bot?.program?.commands[commandIndex];
    if (!bot?.program || !command) return false;
    command.parameters = { ...command.parameters, ...parameters };
    if (command.kind === "rechargeIfBelow") {
      const start = Math.max(1, Math.min(99, Number(command.parameters.startThreshold ?? 25)));
      const resume = Math.max(start + 1, Math.min(100, Number(command.parameters.resumeThreshold ?? 90)));
      command.parameters.startThreshold = start;
      command.parameters.resumeThreshold = resume;
    }
    if (command.kind === "wait") {
      command.parameters.duration = Math.max(0, Math.min(120, Number(command.parameters.duration ?? 0)));
    }
    this.resetProgramRuntime(bot, true);
    return true;
  }

  public getObjective() {
    return OBJECTIVES[Math.min(this.state.objectiveIndex, OBJECTIVES.length - 1)];
  }

  public totalPhysicalItem(itemId: ItemId): number {
    let total = 0;
    for (const bot of Object.values(this.state.bots)) total += itemCount(bot.inventory, itemId);
    for (const building of Object.values(this.state.buildings)) {
      total += itemCount(building.constructionInventory, itemId);
      total += itemCount(building.input, itemId);
      total += itemCount(building.output, itemId);
      total += itemCount(building.researchHold, itemId);
    }
    return total;
  }

  public findBuilding(type: BuildingTypeId): BuildingEntity | undefined {
    return Object.values(this.state.buildings).find((building) => building.type === type && building.complete);
  }

  private updateFixed(delta: number): void {
    this.state.tick += 1;
    this.state.gameTime += delta;
    this.state.notifications = this.state.notifications.filter((notification) => notification.expiresAt > this.state.gameTime);

    this.refreshRequests();
    for (const bot of Object.values(this.state.bots)) {
      if (bot.program?.running) this.updateProgram(bot, delta);
      else this.updateBotTask(bot, delta);
    }
    this.updateBuildings(delta);
    this.updateResearch(delta);
    this.updateAutomationProgress(delta);
    this.updateObjectives();
  }

  private updateBotTask(bot: BotEntity, delta: number): void {
    if (bot.task.kind === "idle") return;
    if (bot.task.kind === "moving") {
      this.moveBot(bot, delta);
      return;
    }
    if (bot.task.kind === "charging") {
      const rate = bot.frame === "seed" && bot.solarDeployed ? 6 : 3;
      bot.battery = Math.min(bot.maxBattery, bot.battery + rate * delta);
      bot.task.progress = bot.battery / bot.maxBattery;
      bot.status = `Charging // ${Math.floor(bot.battery)}%`;
      if (bot.battery >= bot.maxBattery) {
        if (bot.frame === "seed") bot.status = "Fully charged; retract solar to move";
        else this.setIdle(bot, "Charge complete", "");
      }
      return;
    }
    if (bot.task.kind === "mining") {
      this.updateMining(bot, delta);
      return;
    }
    if (bot.task.kind === "microSmelting" || bot.task.kind === "fabricating") {
      const recipe = bot.task.recipeId ? RECIPES[bot.task.recipeId] : undefined;
      if (!recipe) return;
      if (bot.battery <= 1) {
        bot.blockingReason = "Out of usable energy";
        bot.status = "Stopped: Out of usable energy";
        return;
      }
      bot.task.progress += delta;
      bot.battery = Math.max(0, bot.battery - (recipe.energy / recipe.duration) * delta);
      if (bot.task.progress >= recipe.duration) {
        if (bot.task.payload) {
          removeItems(bot.inventory, bot.task.payload);
          removeItems(bot.reservedInventory, bot.task.payload);
        }
        addItems(bot.inventory, recipe.outputs);
        if (bot.task.kind === "microSmelting") {
          if (recipe.outputs.ironIngot) this.state.flags.smeltedIron = true;
          if (recipe.outputs.copperIngot) this.state.flags.smeltedCopper = true;
        } else {
          this.state.flags.fabricatedComponents = [
            "structuralFrame",
            "simpleMotor",
            "basicBattery",
            "controller",
          ].every((itemId) => this.totalPhysicalItem(itemId as ItemId) > 0);
        }
        this.notify(`${recipe.name.toUpperCase()} // Complete`, "success");
        this.setIdle(bot, `${recipe.name} complete`, "");
      }
      return;
    }
    if (bot.task.kind === "building") {
      const building = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
      if (!building || building.cancelled || building.complete) {
        return this.setIdle(bot, "Construction cancelled", building?.cancelled ? "Site was cancelled" : "Destination invalid");
      }
      bot.task.progress += delta;
      bot.battery = Math.max(0, bot.battery - 0.45 * delta);
      building.constructionProgress = Math.min(1, bot.task.progress / bot.task.duration);
      building.status = `Under construction // ${Math.floor(building.constructionProgress * 100)}%`;
      building.blockingReason = "";
      if (bot.task.progress >= bot.task.duration) {
        building.complete = true;
        building.constructionProgress = 1;
        building.status = building.type === "furnace" ? "Stopped: No input" : "Idle";
        building.blockingReason =
          building.type === "furnace" ? "No input" : building.type === "researchBench" ? "No research selected" : "";
        building.constructionInventory = {};
        this.markBuildingFlag(building.type);
        if ((building.automatedConstructionDeliveries ?? 0) > 0) this.state.flags.delegatedConstruction = true;
        this.notify(`${building.name.toUpperCase()} // Construction complete`, "success");
        this.setIdle(bot, `${building.name} construction complete`, "");
      }
      return;
    }
    if (bot.task.kind === "researching") return;
    if (bot.task.kind === "supplyingCradle") return;
    if (bot.task.kind === "program") this.finishManualTransfer(bot);
  }

  private moveBot(bot: BotEntity, delta: number): void {
    if (!bot.path.targetId || !this.getEntity(bot.path.targetId)) {
      return this.setIdle(bot, "Stopped", "Target no longer exists");
    }
    if (bot.path.status === "blocked" && bot.path.targetId && bot.path.interaction) {
      const target = this.getEntity(bot.path.targetId);
      if (target) planBotPath(this.state, bot, target, bot.path.interaction, "Revalidated manual route");
    }
    const result = followBotPath(this.state, bot, delta);
    bot.task.destination = bot.path.interactionDestination;
    if (result === "blocked") {
      const target = bot.path.targetId ? this.getEntity(bot.path.targetId) : undefined;
      if (target && bot.path.interaction && planBotPath(this.state, bot, target, bot.path.interaction, "Route obstruction")) return;
      return this.setIdle(bot, "Stopped", bot.path.repathReason || "No valid path");
    }
    if (result === "arrived") {
      const nextKind = bot.task.nextKind ?? "idle";
      bot.task = {
        ...bot.task,
        kind: nextKind,
        label: bot.task.label,
        destination: bot.path.interactionDestination,
        nextKind: undefined,
        progress: 0,
      };
      this.onArrival(bot);
      return;
    }
  }

  private onArrival(bot: BotEntity): void {
    if (bot.task.kind === "mining") {
      bot.status = bot.task.label;
      bot.blockingReason = "";
      return;
    }
    if (bot.task.kind === "building") {
      const building = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
      if (!building || building.cancelled || building.complete || !bot.task.payload || !removeItems(bot.inventory, bot.task.payload)) {
        this.cancelBotTask(bot);
        this.reject(bot, "Reserved construction materials are no longer available");
        return;
      }
      removeItems(bot.reservedInventory, bot.task.payload);
      addItems(building.constructionInventory, bot.task.payload);
      building.manualProjectDelivery = {};
      if (!hasItems(building.constructionInventory, BUILDINGS[building.type].cost)) {
        building.status = "Awaiting project materials";
        building.blockingReason = "Some required items are still missing";
        this.setIdle(bot, "Construction supply delivered", "Site is not fully supplied");
        return;
      }
      bot.task.progress = building.constructionProgress * bot.task.duration;
      building.status = "Construction in progress";
      bot.status = bot.task.label;
      return;
    }
    if (bot.task.kind === "researching") {
      const bench = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
      const researchId = bench?.activeResearchId;
      if (!bench || !researchId || !bot.task.payload || !removeItems(bot.inventory, bot.task.payload)) {
        if (bench) this.cancelResearch(bench.id);
        this.reject(bot, "Reserved research items are no longer available");
        return;
      }
      removeItems(bot.reservedInventory, bot.task.payload);
      addItems(bench.researchHold, bot.task.payload);
      bench.manualProjectDelivery = {};
      const node = this.state.research[researchId];
      node.reservedItemRefs = RESEARCH[researchId].requiredItems.map((itemId) => ({
        itemId,
        quantity: 1,
        holderId: bench.id,
      }));
      node.blockingReason = "";
      bench.status = `Active research: ${RESEARCH[researchId].name}`;
      bench.blockingReason = "";
      bot.status = `Operating ${bench.name}`;
      bot.blockingReason = "Operator committed until research completes or is cancelled";
      return;
    }
    if (bot.task.kind === "supplyingCradle") {
      const cradle = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
      if (!cradle || !bot.task.payload || !removeItems(bot.inventory, bot.task.payload)) {
        this.reject(bot, "Reserved bot components are no longer available");
        return;
      }
      removeItems(bot.reservedInventory, bot.task.payload);
      addItems(cradle.input, bot.task.payload);
      cradle.cradleQueued = true;
      cradle.productionProgress = 0;
      cradle.status = "Assembling Basic Utility Bot";
      cradle.blockingReason = "";
      this.setIdle(bot, "Cradle supplied", "");
      return;
    }
    if (bot.task.kind === "program") this.finishManualTransfer(bot);
  }

  private updateMining(bot: BotEntity, delta: number): void {
    const deposit = bot.task.targetId ? this.state.deposits[bot.task.targetId] : undefined;
    if (!deposit || deposit.remaining <= 0) return this.setIdle(bot, "Stopped: Deposit exhausted", "No resource remaining");
    if (!canFit(bot.inventory, bot.inventoryCapacity)) return this.setIdle(bot, "Stopped: Cargo full", "Cargo capacity reached");
    if (bot.battery < 2) return this.setIdle(bot, "Stopped: Low battery", "Deploy solar to recharge");
    bot.task.progress += delta;
    bot.battery = Math.max(0, bot.battery - 0.65 * delta);
    if (bot.task.progress >= bot.task.duration) {
      bot.task.progress -= bot.task.duration;
      deposit.remaining -= 1;
      addItem(bot.inventory, deposit.itemId, 1);
      if (deposit.itemId === "ironOre") this.state.flags.minedIron = true;
      bot.status = `Mining ${deposit.name} // Cargo ${inventoryTotal(bot.inventory)}/${bot.inventoryCapacity}`;
    }
  }

  private finishManualTransfer(bot: BotEntity): void {
    const building = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
    if (!building) return this.setIdle(bot, "Transfer cancelled", "Destination invalid");
    if (bot.task.label.startsWith("Supplying")) {
      const itemId = bot.task.itemId ?? "ironOre";
      const moved = transferItem(bot.inventory, building.input, BUILDINGS[building.type].inputCapacity, itemId, 99);
      this.setIdle(bot, moved > 0 ? `Delivered ${moved} item(s)` : "No compatible cargo transferred", moved > 0 ? "" : "Input full");
    } else if (bot.task.label.startsWith("Collecting")) {
      for (const itemId of Object.keys(building.output) as ItemId[]) {
        transferItem(building.output, bot.inventory, bot.inventoryCapacity, itemId, availableOutput(this.state, building, itemId));
      }
      this.setIdle(bot, "Output collected", "");
    } else if (bot.task.label.startsWith("Depositing")) {
      for (const itemId of Object.keys(bot.inventory) as ItemId[]) {
        transferItem(bot.inventory, building.input, BUILDINGS.storage.inputCapacity, itemId, 99);
      }
      this.setIdle(bot, "Cargo deposited", "");
    }
  }

  private updateBuildings(delta: number): void {
    for (const building of Object.values(this.state.buildings)) {
      if (!building.complete) continue;
      building.power = Math.min(CHARGER_BUFFER_CAPACITY, building.power + (building.type === "chargingStation" ? CHARGER_REGEN_RATE : 0.25) * delta);
      if (building.type === "furnace") this.updateFurnace(building, delta);
      if (building.type === "botCradle") this.updateCradle(building, delta);
      if (building.type === "chargingStation") this.updateChargingStation(building);
    }
  }

  private updateChargingStation(station: BuildingEntity): void {
    const bot = station.chargingBotId ? this.state.bots[station.chargingBotId] : undefined;
    if (!bot || !bot.program?.running || bot.program.currentTargetId !== station.id) {
      station.chargingBotId = undefined;
      station.chargingProgress = 0;
      station.status = station.power > 0 ? "Dock available" : "Unpowered";
      station.blockingReason = station.power > 0 ? "" : "Local power buffer empty";
      return;
    }
    station.status = isBotAtInteraction(bot) ? `Charging ${bot.name}` : `Dock reserved by ${bot.name}`;
    station.blockingReason = station.power > 0 ? "" : "Local power buffer empty";
  }

  private updateFurnace(building: BuildingEntity, delta: number): void {
    const recipe = RECIPES.furnaceIron;
    if (!building.activeRecipeId) {
      building.status = "Stopped: Recipe not selected";
      building.blockingReason = "Recipe not selected";
      return;
    }
    if (itemCount(building.input, "ironOre") < 1) {
      building.status = "Stopped: No input";
      building.blockingReason = "No input";
      building.productionProgress = 0;
      return;
    }
    if (!canFit(building.output, BUILDINGS.furnace.outputCapacity)) {
      building.status = "Stopped: Output storage full";
      building.blockingReason = "Output storage full";
      this.state.flags.observedOutputFull = true;
      return;
    }
    if (building.power < recipe.energy) {
      building.status = "Stopped: No energy";
      building.blockingReason = "No energy";
      return;
    }
    building.productionProgress += delta;
    building.power -= (recipe.energy / recipe.duration) * delta;
    building.status = `Operating // ${Math.floor((building.productionProgress / recipe.duration) * 100)}%`;
    building.blockingReason = "";
    if (building.productionProgress >= recipe.duration) {
      building.productionProgress -= recipe.duration;
      addItem(building.input, "ironOre", -1);
      addItem(building.output, "ironIngot", 1);
    }
  }

  private updateCradle(cradle: BuildingEntity, delta: number): void {
    if (!cradle.cradleQueued) {
      cradle.status = "Idle: No bot queued";
      cradle.blockingReason = "Waiting for one Frame, Motor, Battery, and Controller";
      return;
    }
    const recipe = RECIPES.utilityBot;
    cradle.productionProgress += delta;
    cradle.power = Math.max(0, cradle.power - (recipe.energy / recipe.duration) * delta);
    cradle.status = `Assembling Utility Bot // ${Math.floor((cradle.productionProgress / recipe.duration) * 100)}%`;
    if (cradle.productionProgress >= recipe.duration) {
      removeItems(cradle.input, recipe.inputs);
      cradle.productionProgress = 0;
      cradle.cradleQueued = false;
      const ordinal = Object.keys(this.state.bots).length;
      const id = `bot-${this.state.nextId++}`;
      this.state.bots[id] = createBotEntity(
        id,
        "utility",
        { x: cradle.position.x + cradle.footprint.width + 1, y: cradle.position.y + 1 },
        ordinal,
      );
      this.state.flags.firstBotBuilt = true;
      this.notify(`${this.state.bots[id]?.name ?? "UTILITY BOT"} // ACTIVATED`, "success");
    }
  }

  private updateResearch(delta: number): void {
    for (const bench of Object.values(this.state.buildings)) {
      if (!bench.complete || bench.type !== "researchBench" || !bench.activeResearchId) continue;
      const definition = RESEARCH[bench.activeResearchId];
      const node = this.state.research[bench.activeResearchId];
      const operator = bench.operatorId ? this.state.bots[bench.operatorId] : undefined;
      const allPresent = definition.requiredItems.every((itemId) => itemCount(bench.researchHold, itemId) === 1);
      if (!allPresent) {
        node.blockingReason = "Awaiting physical example delivery";
      } else if (!operator || operator.task.kind !== "researching" || operator.task.targetId !== bench.id) {
        node.blockingReason = "Ready: Awaiting operator";
      } else if (operator.battery <= 1) {
        node.blockingReason = "Operator has insufficient power";
      } else if (bench.power <= 1) {
        node.blockingReason = "Bench has insufficient power";
      } else {
        node.blockingReason = "";
        node.progress += delta;
        operator.battery = Math.max(0, operator.battery - definition.energyPerSecond * delta);
        bench.power = Math.max(0, bench.power - definition.energyPerSecond * 0.5 * delta);
      }
      bench.blockingReason = node.blockingReason;
      bench.status = node.blockingReason === "Ready: Awaiting operator" ? node.blockingReason : node.blockingReason ? `Paused: ${node.blockingReason}` : `Researching ${definition.name}`;
      if (node.progress >= definition.duration) this.completeResearch(bench, node);
    }
  }

  private completeResearch(bench: BuildingEntity, node: ResearchNodeState): void {
    const definition = RESEARCH[node.id];
    node.completed = true;
    node.progress = definition.duration;
    for (const itemId of definition.requiredItems) {
      addItem(bench.researchHold, itemId, -1);
      if (!definition.consumeItems) addItem(bench.output, itemId, 1);
    }
    node.reservedItemRefs = [];
    node.blockingReason = "";
    for (const unlockId of definition.unlockIds) {
      if (!this.state.unlocks.includes(unlockId)) this.state.unlocks.push(unlockId);
    }
    if (node.id === "projectCoordination") {
      this.state.flags.projectCoordination = true;
      this.state.flags.delegatedResearch = (node.automatedDeliveries ?? 0) >= definition.requiredItems.length;
    }
    bench.activeResearchId = undefined;
    bench.operatorId = undefined;
    bench.status = `${definition.name} complete`;
    bench.blockingReason = "Returned example items are in the output bay";
    this.setIdle(this.seed, `${definition.name} complete`, "");
    this.notify(`RESEARCH COMPLETE // ${definition.name}`, "success");
  }

  private updateProgram(bot: BotEntity, delta: number): void {
    const program = bot.program;
    if (!program?.running) return;
    if (program.commands.length === 0 || program.instructionPointer < 0 || program.instructionPointer >= program.commands.length) {
      this.blockProgram(bot, "Program has no executable command at the instruction pointer", false);
      return;
    }
    program.runtime.zeroDurationTransitions = 0;
    for (let transition = 0; transition < 12; transition += 1) {
      const command = program.commands[program.instructionPointer];
      if (!command) {
        this.blockProgram(bot, "Program reached the end without Repeat", false);
        return;
      }
      this.syncProgramReadout(program);
      command.runtimeStatus = "active";
      program.currentCommandId = command.id;
      bot.task = {
        kind: "program",
        label: `${program.name}: ${command.label}`,
        targetId: program.currentTargetId,
        destination: bot.path.interactionDestination,
        progress: program.runtime.elapsed,
        duration: command.parameters.duration ?? 0,
      };
      const result = this.executeProgramCommand(bot, program, command, delta);
      this.syncProgramReadout(program);
      if (result !== "complete") return;
      this.completeProgramCommand(bot, command);
      program.runtime.zeroDurationTransitions += 1;
    }
    this.blockProgram(bot, "Program exceeded the instant command transition limit", false);
  }

  private executeProgramCommand(
    bot: BotEntity,
    program: BotProgram,
    command: ProgramCommand,
    delta: number,
  ): "running" | "complete" | "blocked" {
    switch (command.kind) {
      case "findDeposit":
        return this.executeFindDeposit(bot, program, command);
      case "moveToTarget":
        return this.executeMoveToTarget(bot, program, delta);
      case "mineUntilFull":
        return this.executeMineUntilFull(bot, program, command, delta);
      case "claimSupplyRequest":
        return this.executeClaimSupplyRequest(bot, program, command);
      case "claimOutputRequest":
        return this.executeClaimOutputRequest(bot, program, command);
      case "claimProjectSupplyRequest":
        return this.executeClaimProjectSupplyRequest(bot, program, command);
      case "moveToRequestSource": {
        const reservation = this.currentReservation(program);
        if (!reservation || reservation.state !== "reserved") return this.blockProgram(bot, "No reserved project source", false);
        program.currentTargetId = reservation.sourceId;
        return this.executeMoveToTarget(bot, program, delta);
      }
      case "moveToRequestDestination": {
        const reservation = this.currentReservation(program);
        if (!reservation || reservation.state !== "inTransit") return this.blockProgram(bot, "No in-transit project delivery", false);
        program.currentTargetId = reservation.destinationId;
        return this.executeMoveToTarget(bot, program, delta);
      }
      case "collectReserved":
        return this.executeCollectReserved(bot, program);
      case "deliverReserved":
        return this.executeDeliverReserved(bot, program);
      case "deliverCargo":
        return this.executeDeliverCargo(bot, program, command);
      case "rechargeIfBelow":
        return this.executeRecharge(bot, program, command, delta);
      case "wait": {
        const duration = Math.max(0, command.parameters.duration ?? 0);
        program.runtime.elapsed += delta;
        bot.status = `Waiting // ${program.runtime.elapsed.toFixed(1)} / ${duration.toFixed(1)}s`;
        return program.runtime.elapsed >= duration ? "complete" : "running";
      }
      case "repeat":
        program.loopCount += 1;
        program.instructionPointer = -1;
        for (const row of program.commands) row.runtimeStatus = "pending";
        return "complete";
    }
  }

  private executeFindDeposit(bot: BotEntity, program: BotProgram, command: ProgramCommand): "complete" | "blocked" {
    const itemId = command.parameters.resourceType ?? "ironOre";
    const matching = Object.values(this.state.deposits).filter((deposit) => deposit.itemId === itemId && deposit.remaining > 0);
    if (matching.length === 0) return this.blockProgram(bot, "No matching deposit", true);
    const unclaimed = matching.filter((deposit) => !deposit.reservedBy || deposit.reservedBy === bot.id);
    if (unclaimed.length === 0) return this.blockProgram(bot, "All matching deposits claimed", true);
    const reachable = unclaimed
      .map((deposit) => ({ deposit, route: resolveInteractionPath(this.state, bot.position, deposit, "deposit") }))
      .filter(({ route }) => route.path.length > 0)
      .sort((a, b) => a.route.path.length - b.route.path.length || a.deposit.id.localeCompare(b.deposit.id));
    const selected = reachable[0];
    if (!selected) return this.blockProgram(bot, "No reachable matching deposit", true);
    selected.deposit.reservedBy = bot.id;
    program.currentTargetId = selected.deposit.id;
    program.runtime.phase = "depositClaimed";
    clearBotPath(bot, "Target changed");
    bot.status = `Claimed ${selected.deposit.name}`;
    return "complete";
  }

  private executeMoveToTarget(bot: BotEntity, program: BotProgram, delta: number): "running" | "complete" | "blocked" {
    if (!program.currentTargetId) return this.blockProgram(bot, "No current target", false);
    const target = this.getEntity(program.currentTargetId);
    if (!target) return this.blockProgram(bot, "Target invalid", false);
    const interaction = this.interactionForProgramTarget(program, target);
    const needsPlan =
      bot.path.targetId !== target.id ||
      bot.path.interaction !== interaction ||
      bot.path.status === "idle" ||
      bot.path.status === "blocked";
    if (needsPlan && !planBotPath(this.state, bot, target, interaction, bot.path.status === "blocked" ? "Route revalidated" : "New target")) {
      return this.blockProgram(bot, bot.path.repathReason || "No valid path", false);
    }
    const result = followBotPath(this.state, bot, delta);
    bot.task.destination = bot.path.interactionDestination;
    bot.status = result === "moving" ? `Moving to ${target.name} // node ${bot.path.currentIndex}/${bot.path.tiles.length - 1}` : `At ${target.name}`;
    if (result === "blocked") {
      if (planBotPath(this.state, bot, target, interaction, "Route obstruction")) return "running";
      return this.blockProgram(bot, bot.path.repathReason || "No valid path", false);
    }
    return result === "arrived" ? "complete" : "running";
  }

  private executeMineUntilFull(
    bot: BotEntity,
    program: BotProgram,
    command: ProgramCommand,
    delta: number,
  ): "running" | "complete" | "blocked" {
    const deposit = program.currentTargetId ? this.state.deposits[program.currentTargetId] : undefined;
    if (!deposit) return this.blockProgram(bot, "No deposit target", false);
    if (!bot.modules.includes("miningTool")) return this.blockProgram(bot, "Missing Mining Tool", false);
    if (command.parameters.resourceType && deposit.itemId !== command.parameters.resourceType) {
      return this.blockProgram(bot, "Wrong resource", false);
    }
    if (!isBotAtInteraction(bot)) return this.blockProgram(bot, "Not at deposit", false);
    if (inventoryTotal(bot.inventory) >= bot.inventoryCapacity) return this.blockProgram(bot, "Cargo already full", false);
    if (deposit.remaining <= 0) return this.blockProgram(bot, "Deposit depleted", true);
    if (bot.battery <= 0.25) return this.blockProgram(bot, "Insufficient energy", false);
    program.runtime.elapsed += delta;
    bot.battery = Math.max(0, bot.battery - 0.65 * delta);
    bot.status = `Mining ${deposit.name} // ${inventoryTotal(bot.inventory)}/${bot.inventoryCapacity}`;
    if (program.runtime.elapsed >= 2.6) {
      program.runtime.elapsed -= 2.6;
      deposit.remaining -= 1;
      addItem(bot.inventory, deposit.itemId, 1);
      if (inventoryTotal(bot.inventory) >= bot.inventoryCapacity || deposit.remaining <= 0) {
        deposit.reservedBy = undefined;
        program.currentTargetId = undefined;
        clearBotPath(bot, "Mining complete");
        return "complete";
      }
    }
    return "running";
  }

  private executeClaimSupplyRequest(bot: BotEntity, program: BotProgram, command: ProgramCommand): "complete" | "blocked" {
    const itemId = command.parameters.itemId ?? "ironOre";
    if (itemCount(bot.inventory, itemId) <= 0) return this.blockProgram(bot, "Cargo does not contain the requested item", true);
    const matching = Object.values(this.state.logisticsRequests).filter(
      (request) => request.active && request.type === "buildingInput" && request.itemId === itemId,
    );
    if (matching.length === 0) return this.blockProgram(bot, "No matching request", true);
    const open = matching.filter((request) => request.state === "open" || request.claimedBy === bot.id);
    if (open.length === 0) return this.blockProgram(bot, "All matching requests claimed", true);
    for (const request of open.sort((a, b) => a.id.localeCompare(b.id))) {
      const destination = this.state.buildings[request.buildingId];
      if (!destination || resolveInteractionPath(this.state, bot.position, destination, "input").path.length === 0) continue;
      const quantity = Math.min(request.quantity, itemCount(bot.inventory, itemId));
      if (quantity <= 0 || !this.claimRequest(request, bot, bot.id, destination.id, quantity)) continue;
      program.currentRequestId = request.id;
      program.currentReservationId = `reservation:${request.id}:${bot.id}`;
      program.currentTargetId = destination.id;
      clearBotPath(bot, "Supply request claimed");
      return "complete";
    }
    return this.blockProgram(bot, "No reachable destination", true);
  }

  private executeClaimOutputRequest(bot: BotEntity, program: BotProgram, command: ProgramCommand): "complete" | "blocked" {
    const matching = Object.values(this.state.logisticsRequests).filter(
      (request) =>
        request.active &&
        request.type === "buildingOutput" &&
        (!command.parameters.itemId || request.itemId === command.parameters.itemId),
    );
    if (matching.length === 0) return this.blockProgram(bot, "No output request available", true);
    const storage = Object.values(this.state.buildings).find(
      (building) => building.complete && building.type === "storage" && inventoryTotal(building.input) < BUILDINGS.storage.inputCapacity,
    );
    if (!storage) return this.blockProgram(bot, "No compatible storage destination", true);
    for (const request of matching.filter((entry) => entry.state === "open").sort((a, b) => a.id.localeCompare(b.id))) {
      const source = this.state.buildings[request.buildingId];
      if (!source) continue;
      const sourceRoute = resolveInteractionPath(this.state, bot.position, source, "output");
      const destinationRoute = resolveInteractionPath(this.state, sourceRoute.interactionDestination ?? bot.position, storage, "input");
      if (sourceRoute.path.length === 0 || destinationRoute.path.length === 0) continue;
      const quantity = Math.min(
        availableOutput(this.state, source, request.itemId),
        bot.inventoryCapacity - inventoryTotal(bot.inventory),
        BUILDINGS.storage.inputCapacity - inventoryTotal(storage.input),
      );
      if (quantity <= 0) continue;
      if (!this.claimRequest(request, bot, source.id, storage.id, quantity)) continue;
      request.state = "awaitingPickup";
      request.destinationId = storage.id;
      program.currentRequestId = request.id;
      program.currentReservationId = `reservation:${request.id}:${bot.id}`;
      program.currentTargetId = source.id;
      clearBotPath(bot, "Output request claimed");
      return "complete";
    }
    return this.blockProgram(bot, "Output already reserved or unreachable", true);
  }

  private executeClaimProjectSupplyRequest(
    bot: BotEntity,
    program: BotProgram,
    command: ProgramCommand,
  ): "complete" | "blocked" {
    const freeCargo = bot.inventoryCapacity - inventoryTotal(bot.inventory);
    if (freeCargo <= 0) return this.blockProgram(bot, "Cargo incompatible or full", true);
    const allProjectRequests = Object.values(this.state.logisticsRequests).filter(
      (request) => request.active && (request.type === "construction" || request.type === "researchItem"),
    );
    if (allProjectRequests.length === 0) return this.blockProgram(bot, "No project requests", true);
    const filter = command.parameters.projectFilter ?? "any";
    const matching = allProjectRequests.filter(
      (request) =>
        (request.state === "open" || request.claimedBy === bot.id) &&
        (filter === "any" || request.projectKind === filter) &&
        (!command.parameters.itemId || request.itemId === command.parameters.itemId) &&
        request.quantity > 0,
    );
    if (matching.length === 0) return this.blockProgram(bot, "No matching request", true);

    const priorityRank = { high: 0, normal: 1, low: 2 } as const;
    const candidates = matching
      .map((request) => {
        const destination = this.state.buildings[request.buildingId];
        if (!destination || destination.cancelled) return undefined;
        const destinationInteraction = request.type === "construction" ? "construction" : "input";
        const sources = Object.values(this.state.buildings)
          .flatMap((source) => {
            const sourceInventory = source.complete && source.type === "storage" ? "input" as const : "output" as const;
            if ((!source.complete && !source.cancelled) || source.id === destination.id) return [];
            const physical = itemCount(source[sourceInventory], request.itemId);
            const available = Math.max(0, physical - reservedAtSource(this.state, source.id, request.itemId));
            if (available <= 0) return [];
            const sourceRoute = resolveInteractionPath(this.state, bot.position, source, "output");
            if (sourceRoute.path.length === 0 || !sourceRoute.interactionDestination) return [];
            const destinationRoute = resolveInteractionPath(
              this.state,
              sourceRoute.interactionDestination,
              destination,
              destinationInteraction,
            );
            if (destinationRoute.path.length === 0) return [];
            return [{
              source,
              sourceInventory,
              available,
              totalPathCost: sourceRoute.path.length + destinationRoute.path.length,
            }];
          })
          .sort((a, b) => b.available - a.available || a.totalPathCost - b.totalPathCost || a.source.id.localeCompare(b.source.id));
        const source = sources[0];
        return source ? { request, destination, ...source } : undefined;
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
      .sort(
        (a, b) =>
          priorityRank[a.request.priority ?? "normal"] - priorityRank[b.request.priority ?? "normal"] ||
          (a.request.createdAt ?? 0) - (b.request.createdAt ?? 0) ||
          a.totalPathCost - b.totalPathCost ||
          a.request.id.localeCompare(b.request.id),
      );
    const selected = candidates[0];
    if (!selected) {
      const anyPhysical = Object.values(this.state.buildings).some(
        (source) => itemCount(source.type === "storage" ? source.input : source.output, matching[0]!.itemId) > 0,
      );
      const anyAvailable = Object.values(this.state.buildings).some((source) => {
        const inventory = source.type === "storage" ? source.input : source.output;
        return itemCount(inventory, matching[0]!.itemId) - reservedAtSource(this.state, source.id, matching[0]!.itemId) > 0;
      });
      return this.blockProgram(bot, anyPhysical && !anyAvailable ? "All matching quantities reserved" : anyPhysical ? "No reachable source" : "No available source", true);
    }
    const quantity = Math.min(selected.request.quantity, selected.available, freeCargo);
    if (!this.claimRequest(selected.request, bot, selected.source.id, selected.destination.id, quantity)) {
      return this.blockProgram(bot, "All matching quantities reserved", true);
    }
    const reservationId = `reservation:${selected.request.id}:${bot.id}`;
    const reservation = this.state.reservations[reservationId];
    if (!reservation) return this.blockProgram(bot, "Reservation creation failed", false);
    reservation.sourceInventory = selected.sourceInventory;
    selected.request.state = "awaitingPickup";
    selected.request.blockingReason = "Supplier travelling to reserved source";
    program.currentRequestId = selected.request.id;
    program.currentReservationId = reservationId;
    program.currentTargetId = selected.source.id;
    clearBotPath(bot, "Project source claimed");
    return "complete";
  }

  private executeCollectReserved(bot: BotEntity, program: BotProgram): "complete" | "blocked" {
    const reservation = this.currentReservation(program);
    if (!reservation || reservation.state !== "reserved") return this.blockProgram(bot, "No active reservation", false);
    const request = this.state.logisticsRequests[reservation.requestId];
    const source = this.state.buildings[reservation.sourceId];
    if (!request || !source) return this.blockProgram(bot, "Source invalid", false);
    if (!isBotAtInteraction(bot) || bot.path.targetId !== source.id) return this.blockProgram(bot, "Not at pickup", false);
    const sourceInventory = reservation.sourceInventory === "input" ? source.input : source.output;
    const available = itemCount(sourceInventory, reservation.itemId);
    if (available <= 0) return this.blockProgram(bot, "Reserved items missing", false);
    if (inventoryTotal(bot.inventory) >= bot.inventoryCapacity) return this.blockProgram(bot, "Cargo full", false);
    const moved = transferItem(sourceInventory, bot.inventory, bot.inventoryCapacity, reservation.itemId, reservation.quantity);
    if (moved <= 0) return this.blockProgram(bot, "Reserved items missing", false);
    reservation.quantity = moved;
    reservation.collectedQuantity = moved;
    reservation.state = "inTransit";
    request.state = "inTransit";
    request.reservedQuantity = 0;
    request.inTransitQuantity = moved;
    request.blockingReason = "Reserved material is physically in transit";
    program.currentTargetId = reservation.destinationId;
    clearBotPath(bot, "Pickup complete; destination selected");
    bot.battery = Math.max(0, bot.battery - moved * 0.15);
    return "complete";
  }

  private executeDeliverReserved(bot: BotEntity, program: BotProgram): "complete" | "blocked" {
    const reservation = this.currentReservation(program);
    if (!reservation || reservation.state !== "inTransit") return this.blockProgram(bot, "No in-transit reservation", false);
    const request = this.state.logisticsRequests[reservation.requestId];
    const destination = this.state.buildings[reservation.destinationId];
    if (!request || !destination) return this.blockProgram(bot, "Destination invalid", false);
    if (!isBotAtInteraction(bot) || bot.path.targetId !== destination.id) return this.blockProgram(bot, "Not at destination", false);
    if (itemCount(bot.inventory, reservation.itemId) <= 0) return this.blockProgram(bot, "Cargo no longer contains the reserved item", false);
    let moved = 0;
    if (request.type === "construction") {
      moved = transferItem(
        bot.inventory,
        destination.constructionInventory,
        inventoryTotal(BUILDINGS[destination.type].cost),
        reservation.itemId,
        reservation.quantity,
      );
    } else if (request.type === "researchItem") {
      moved = transferItem(bot.inventory, destination.researchHold, BUILDINGS.researchBench.inputCapacity, reservation.itemId, reservation.quantity);
    } else {
      moved = transferItem(bot.inventory, destination.input, BUILDINGS[destination.type].inputCapacity, reservation.itemId, reservation.quantity);
    }
    if (moved <= 0) return this.blockProgram(bot, "Destination full", true);
    reservation.deliveredQuantity += moved;
    request.deliveredQuantity = (request.deliveredQuantity ?? 0) + moved;
    request.inTransitQuantity = Math.max(0, (request.inTransitQuantity ?? 0) - moved);
    if (request.type === "construction") {
      destination.automatedConstructionDeliveries = (destination.automatedConstructionDeliveries ?? 0) + moved;
    }
    if (request.type === "researchItem" && destination.activeResearchId) {
      const node = this.state.research[destination.activeResearchId];
      node.automatedDeliveries = (node.automatedDeliveries ?? 0) + moved;
    }
    if (reservation.itemId === "ironIngot" && destination.type === "storage") {
      this.state.automation.ironIngotsDelivered += moved;
      this.state.automation.lastDeliveryAt = this.state.gameTime;
    }
    if (reservation.deliveredQuantity < reservation.quantity) return this.blockProgram(bot, "Destination full", true);
    completeReservation(this.state, reservation, request);
    program.currentReservationId = undefined;
    program.currentRequestId = undefined;
    program.currentTargetId = undefined;
    clearBotPath(bot, "Delivery complete");
    bot.battery = Math.max(0, bot.battery - moved * 0.12);
    this.refreshRequests();
    return "complete";
  }

  private executeDeliverCargo(bot: BotEntity, program: BotProgram, command: ProgramCommand): "complete" | "blocked" {
    const reservation = this.currentReservation(program);
    const request = program.currentRequestId ? this.state.logisticsRequests[program.currentRequestId] : undefined;
    const destination = request ? this.state.buildings[request.buildingId] : undefined;
    if (!reservation || !request || !destination) return this.blockProgram(bot, "No claimed building-input request", false);
    if (!isBotAtInteraction(bot) || bot.path.targetId !== destination.id) return this.blockProgram(bot, "Not at destination", false);
    const itemId = command.parameters.itemId ?? request.itemId;
    if (itemCount(bot.inventory, itemId) <= 0) return this.blockProgram(bot, "Cargo no longer contains the requested item", false);
    const moved = transferItem(bot.inventory, destination.input, BUILDINGS[destination.type].inputCapacity, itemId, reservation.quantity);
    if (moved <= 0) return this.blockProgram(bot, "Destination full", true);
    reservation.collectedQuantity = moved;
    reservation.deliveredQuantity = moved;
    completeReservation(this.state, reservation, request);
    program.currentReservationId = undefined;
    program.currentRequestId = undefined;
    program.currentTargetId = undefined;
    clearBotPath(bot, "Cargo delivered");
    bot.battery = Math.max(0, bot.battery - moved * 0.12);
    return "complete";
  }

  private executeRecharge(
    bot: BotEntity,
    program: BotProgram,
    command: ProgramCommand,
    delta: number,
  ): "running" | "complete" | "blocked" {
    const startThreshold = command.parameters.startThreshold ?? 25;
    const resumeThreshold = command.parameters.resumeThreshold ?? 90;
    if (program.runtime.phase !== "charging" && program.runtime.phase !== "travellingToCharge" && batteryPercent(bot) >= startThreshold) {
      return "complete";
    }
    let station = program.currentTargetId ? this.state.buildings[program.currentTargetId] : undefined;
    if (station?.type !== "chargingStation" || (station.chargingBotId && station.chargingBotId !== bot.id)) station = undefined;
    if (!station) {
      const allStations = Object.values(this.state.buildings).filter((building) => building.complete && building.type === "chargingStation");
      if (allStations.length === 0) return this.blockProgram(bot, "No Charging Station exists", true);
      const freeStations = allStations.filter((building) => !building.chargingBotId || building.chargingBotId === bot.id);
      if (freeStations.length === 0) return this.blockProgram(bot, "All charging docks occupied", true);
      station = reachableChargingStations(this.state, bot)[0];
      if (!station) return this.blockProgram(bot, "No reachable Charging Station", false);
      const route = resolveInteractionPath(this.state, bot.position, station, "charging");
      const energyNeeded = Math.max(0, route.path.length - 1) * 0.22;
      if (bot.battery <= energyNeeded) return this.blockProgram(bot, "Battery is too low to reach the station", false);
      station.chargingBotId = bot.id;
      program.runtime.suspendedTargetId = program.currentTargetId;
      program.currentTargetId = station.id;
      program.runtime.phase = "travellingToCharge";
      clearBotPath(bot, "Charging dock claimed");
    }
    if (program.runtime.phase === "travellingToCharge") {
      const needsPlan = bot.path.targetId !== station.id || bot.path.interaction !== "charging" || bot.path.status === "idle" || bot.path.status === "blocked";
      if (needsPlan && !planBotPath(this.state, bot, station, "charging", "Charging dock claimed")) {
        station.chargingBotId = undefined;
        return this.blockProgram(bot, "No reachable Charging Station", false);
      }
      const result = followBotPath(this.state, bot, delta);
      bot.task.destination = bot.path.interactionDestination;
      bot.status = `Travelling to charging dock // ${bot.path.currentIndex}/${bot.path.tiles.length - 1}`;
      if (result === "blocked") return this.blockProgram(bot, bot.path.repathReason || "No reachable Charging Station", false);
      if (result !== "arrived") return "running";
      program.runtime.phase = "charging";
    }
    if (station.power <= 0) return this.blockProgram(bot, "Charging Station has no energy", true);
    const charge = Math.min(CHARGE_RATE * delta, station.power, bot.maxBattery - bot.battery);
    station.power -= charge;
    bot.battery += charge;
    station.chargingProgress = batteryPercent(bot);
    bot.status = `Charging // ${Math.floor(batteryPercent(bot))}%`;
    if (batteryPercent(bot) < resumeThreshold) return "running";
    station.chargingBotId = undefined;
    station.chargingProgress = 0;
    program.currentTargetId = program.runtime.suspendedTargetId;
    program.runtime.suspendedTargetId = undefined;
    clearBotPath(bot, "Charge complete");
    return "complete";
  }

  private completeProgramCommand(bot: BotEntity, command: ProgramCommand): void {
    const program = bot.program;
    if (!program) return;
    command.runtimeStatus = command.kind === "repeat" ? "pending" : "completed";
    program.lastCompletedCommandId = command.id;
    program.instructionPointer += 1;
    program.currentCommandId = program.commands[program.instructionPointer]?.id;
    program.runtime.elapsed = 0;
    program.runtime.phase = "idle";
    program.runtime.lastTransitionTick = this.state.tick;
    program.blockingReason = "";
    program.blockedReason = "";
    bot.blockingReason = "";
    this.syncProgramReadout(program);
  }

  private blockProgram(bot: BotEntity, reason: string, retryable: boolean): "blocked" {
    const program = bot.program;
    if (!program) return "blocked";
    const command = program.commands[program.instructionPointer];
    if (command) command.runtimeStatus = retryable ? "waiting" : "blocked";
    program.blockingReason = reason;
    program.blockedReason = reason;
    program.lastFailure = reason;
    bot.blockingReason = reason;
    bot.status = `${retryable ? "Waiting" : "Blocked"}: ${reason}`;
    if (!retryable) {
      program.running = false;
      this.releaseBotClaims(bot.id);
      bot.task = clone(IDLE_TASK);
    }
    this.syncProgramReadout(program);
    return "blocked";
  }

  private currentReservation(program: BotProgram): Reservation | undefined {
    return program.currentReservationId ? this.state.reservations[program.currentReservationId] : undefined;
  }

  private interactionForProgramTarget(program: BotProgram, target: SelectableEntity) {
    if (target.kind === "deposit") return "deposit" as const;
    if (target.kind !== "building") return "input" as const;
    if (target.type === "chargingStation") return "charging" as const;
    const reservation = this.currentReservation(program);
    if (reservation?.sourceId === target.id && reservation.state === "reserved" && reservation.sourceId !== reservation.botId) {
      return "output" as const;
    }
    if (reservation?.destinationId === target.id && reservation.state === "inTransit") {
      const request = this.state.logisticsRequests[reservation.requestId];
      if (request?.type === "construction") return "construction" as const;
      return "input" as const;
    }
    return "input" as const;
  }

  private syncProgramReadout(program: BotProgram): void {
    program.currentStep = program.instructionPointer;
    program.phase = program.runtime.phase;
    program.targetId = program.currentTargetId;
    program.claimId = program.currentRequestId;
    program.blockedReason = program.blockingReason;
  }

  private resetProgramRuntime(bot: BotEntity, releaseClaims = false): void {
    const program = bot.program;
    if (!program) return;
    if (releaseClaims) this.releaseBotClaims(bot.id);
    for (const command of program.commands) command.runtimeStatus = "pending";
    program.instructionPointer = 0;
    program.currentCommandId = program.commands[0]?.id;
    program.runtime = { elapsed: 0, phase: "idle", zeroDurationTransitions: 0, lastTransitionTick: this.state.tick };
    program.blockingReason = "";
    program.blockedReason = "";
    program.lastFailure = undefined;
    bot.blockingReason = "";
    bot.task = { kind: "program", label: `${program.name}: ready`, progress: 0, duration: 0 };
    this.syncProgramReadout(program);
  }

  private updateAutomationProgress(delta: number): void {
    const minerRunning = this.hasRunningProgram("ironMiner");
    const haulerRunning = this.hasRunningProgram("factoryHauler");
    this.state.flags.minerRunning = minerRunning;
    if (minerRunning && haulerRunning && this.state.automation.ironIngotsDelivered > 0) {
      this.state.automation.productiveSeconds += delta;
    } else if (!minerRunning || !haulerRunning) {
      this.state.automation.productiveSeconds = 0;
    }
    this.state.automation.completed =
      minerRunning &&
      haulerRunning &&
      this.state.automation.ironIngotsDelivered >= 3 &&
      this.state.automation.productiveSeconds >= 30;
    this.state.flags.autonomousLoop = this.state.automation.completed;
  }

  private refreshRequests(): void {
    const activeIds = new Set<string>();
    for (const building of Object.values(this.state.buildings).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!building.complete && !building.cancelled) {
        let ready = true;
        for (const [itemId, required] of Object.entries(BUILDINGS[building.type].cost) as Array<[ItemId, number]>) {
          const delivered = itemCount(building.constructionInventory, itemId);
          const id = `request:${building.id}:construction:${itemId}`;
          const reserved = this.requestQuantityByState(id, "reserved") + itemCount(building.manualProjectDelivery ?? {}, itemId);
          const inTransit = this.requestQuantityByState(id, "inTransit");
          const missing = Math.max(0, required - delivered - reserved - inTransit);
          ready &&= delivered >= required;
          if (delivered < required) {
            activeIds.add(id);
            if (missing > 0 || this.state.logisticsRequests[id]) {
              this.upsertRequest({
                id,
                type: "construction",
                projectKind: "construction",
                buildingId: building.id,
                destinationId: building.id,
                itemId,
                quantity: missing,
                requiredQuantity: required,
                deliveredQuantity: delivered,
                reservedQuantity: reserved,
                inTransitQuantity: inTransit,
                priority: building.projectPriority ?? "normal",
                createdAt: this.state.gameTime,
                state: "open",
                active: true,
                blockingReason: missing > 0 ? "Awaiting public stock and supplier claim" : "Reserved or in transit",
                label: `${ITEMS[itemId]?.shortName ?? itemId}: ${delivered}/${required} delivered`,
              });
            }
          }
        }
        building.status = ready ? "Ready: Awaiting constructor" : "Awaiting project materials";
        building.blockingReason = ready ? "Select Supply and Construct to assign the Seed" : "Missing, reserved, and in-transit items are tracked below";
        continue;
      }
      if (building.type === "furnace") {
        const needed = BUILDINGS.furnace.inputCapacity - inventoryTotal(building.input);
        if (needed > 0) {
          const id = `request:${building.id}:input:ironOre`;
          activeIds.add(id);
          this.upsertRequest({
            id,
            type: "buildingInput",
            buildingId: building.id,
            itemId: "ironOre",
            quantity: needed,
            reservedQuantity: 0,
            state: "open",
            active: true,
            label: `Needs ${needed} Iron Ore`,
          });
        }
      }
      if (building.type === "researchBench" && building.activeResearchId) {
        const node = this.state.research[building.activeResearchId];
        for (const itemId of new Set(RESEARCH[building.activeResearchId].requiredItems)) {
          const delivered = Math.min(1, itemCount(building.researchHold, itemId));
          const id = `request:${building.id}:research:${itemId}`;
          const reserved = this.requestQuantityByState(id, "reserved") + itemCount(building.manualProjectDelivery ?? {}, itemId);
          const inTransit = this.requestQuantityByState(id, "inTransit");
          const missing = Math.max(0, 1 - delivered - reserved - inTransit);
          if (delivered < 1) {
            activeIds.add(id);
            this.upsertRequest({
              id,
              type: "researchItem",
              projectKind: "research",
              buildingId: building.id,
              destinationId: building.id,
              itemId,
              quantity: missing,
              requiredQuantity: 1,
              deliveredQuantity: delivered,
              reservedQuantity: reserved,
              inTransitQuantity: inTransit,
              priority: node.priority ?? building.projectPriority ?? "normal",
              createdAt: this.state.gameTime,
              state: "open",
              active: true,
              blockingReason: missing > 0 ? "Awaiting public stock and supplier claim" : "Reserved or in transit",
              label: `${ITEMS[itemId]?.shortName ?? itemId}: ${delivered}/1 delivered`,
            });
          }
        }
      }
      for (const itemId of Object.keys(building.output) as ItemId[]) {
        const available = availableOutput(this.state, building, itemId);
        if (available <= 0) continue;
        const id = `request:${building.id}:output:${itemId}`;
        activeIds.add(id);
        this.upsertRequest({
          id,
          type: "buildingOutput",
          buildingId: building.id,
          itemId,
          quantity: available,
          reservedQuantity: 0,
          state: "open",
          sourceId: building.id,
          active: true,
          label: `${available} ${ITEMS[itemId].name} ready`,
        });
      }
    }
    for (const request of Object.values(this.state.logisticsRequests)) {
      if (!activeIds.has(request.id)) {
        if (["claimed", "awaitingPickup", "inTransit"].includes(request.state)) continue;
        request.active = false;
        if (request.state !== "completed") request.state = "cancelled";
      }
    }
  }

  private requestQuantityByState(requestId: string, state: "reserved" | "inTransit"): number {
    return Object.values(this.state.reservations)
      .filter((reservation) => reservation.requestId === requestId && reservation.state === state)
      .reduce((total, reservation) => total + Math.max(0, reservation.quantity - reservation.deliveredQuantity), 0);
  }

  private upsertRequest(next: LogisticsRequest): void {
    const existing = this.state.logisticsRequests[next.id];
    if (!existing) {
      this.state.logisticsRequests[next.id] = next;
      return;
    }
    if (["completed", "cancelled", "invalid"].includes(existing.state)) {
      this.state.logisticsRequests[next.id] = { ...next, createdAt: existing.createdAt ?? next.createdAt };
      return;
    }
    if (existing.state !== "open") {
      existing.active = true;
      existing.requiredQuantity = next.requiredQuantity;
      existing.deliveredQuantity = next.deliveredQuantity;
      existing.inTransitQuantity = next.inTransitQuantity;
      existing.priority = next.priority;
      existing.blockingReason = next.blockingReason;
      existing.label = next.label;
      return;
    }
    this.state.logisticsRequests[next.id] = {
      ...next,
      createdAt: existing.createdAt ?? next.createdAt,
      sourceId: existing.sourceId ?? next.sourceId,
      destinationId: existing.destinationId ?? next.destinationId,
      claimedBy: existing.claimedBy,
      reservedQuantity: existing.reservedQuantity,
      state: existing.state,
    };
  }

  private claimRequest(
    request: LogisticsRequest,
    bot: BotEntity,
    sourceId = request.buildingId,
    destinationId = this.findBuilding("storage")?.id ?? request.buildingId,
    requestedQuantity = Math.min(request.quantity, bot.inventoryCapacity - inventoryTotal(bot.inventory)),
  ): boolean {
    if (!request.active || (request.state !== "open" && request.claimedBy !== bot.id)) return false;
    if (request.claimedBy && request.claimedBy !== bot.id) return false;
    const quantity = Math.max(0, Math.min(request.quantity, requestedQuantity));
    if (quantity <= 0) return false;
    request.claimedBy = bot.id;
    request.state = "claimed";
    request.reservedQuantity = quantity;
    request.sourceId = sourceId;
    request.destinationId = destinationId;
    request.label = `${request.label} // ${quantity} reserved`;
    const id = `reservation:${request.id}:${bot.id}`;
    this.state.reservations[id] = {
      id,
      requestId: request.id,
      botId: bot.id,
      itemId: request.itemId,
      quantity,
      sourceId,
      destinationId,
      state: "reserved",
      collectedQuantity: 0,
      deliveredQuantity: 0,
    };
    return true;
  }

  private releaseBotClaims(botId: string): void {
    for (const deposit of Object.values(this.state.deposits)) {
      if (deposit.reservedBy === botId) deposit.reservedBy = undefined;
    }
    for (const request of Object.values(this.state.logisticsRequests)) {
      if (request.claimedBy === botId) {
        request.claimedBy = undefined;
        request.reservedQuantity = 0;
        request.state = request.active ? "open" : "cancelled";
      }
    }
    for (const reservation of Object.values(this.state.reservations)) {
      if (reservation.botId === botId) releaseReservation(this.state, reservation);
    }
    for (const station of Object.values(this.state.buildings)) {
      if (station.type === "chargingStation" && station.chargingBotId === botId) station.chargingBotId = undefined;
    }
    const bot = this.state.bots[botId];
    if (bot?.program) {
      bot.program.currentRequestId = undefined;
      bot.program.currentReservationId = undefined;
      bot.program.currentTargetId = undefined;
      bot.program.claimId = undefined;
      bot.program.targetId = undefined;
    }
    if (bot) clearBotPath(bot, "Claims released");
  }

  private releaseProjectClaims(buildingId: string, reason: string): void {
    for (const reservation of [...Object.values(this.state.reservations)]) {
      if (reservation.destinationId !== buildingId) continue;
      const bot = this.state.bots[reservation.botId];
      releaseReservation(this.state, reservation);
      if (bot?.program) {
        bot.program.currentRequestId = undefined;
        bot.program.currentReservationId = undefined;
        bot.program.currentTargetId = undefined;
        bot.program.blockingReason = `Project claim released: ${reason}`;
        bot.program.blockedReason = bot.program.blockingReason;
      }
      if (bot) clearBotPath(bot, reason);
      this.state.releaseEvents.push(`${this.state.tick}: ${reservation.id} // ${reason}`);
    }
    for (const request of Object.values(this.state.logisticsRequests)) {
      if (request.buildingId !== buildingId || (request.type !== "construction" && request.type !== "researchItem")) continue;
      request.active = false;
      request.state = "cancelled";
      request.claimedBy = undefined;
      request.reservedQuantity = 0;
      request.inTransitQuantity = 0;
      request.blockingReason = reason;
    }
    this.state.releaseEvents = this.state.releaseEvents.slice(-20);
  }

  private updateObjectives(): void {
    while (this.state.objectiveIndex < OBJECTIVES.length - 1 && this.objectiveComplete(this.state.objectiveIndex)) {
      this.state.objectiveIndex += 1;
      const next = OBJECTIVES[this.state.objectiveIndex];
      if (next) this.notify(`OBJECTIVE // ${next.title}`, "info");
    }
  }

  private objectiveComplete(index: number): boolean {
    const research = this.state.research;
    switch (index) {
      case 0:
        return this.seed.battery >= 28;
      case 1:
        return this.state.flags.minedIron;
      case 2:
        return this.state.flags.smeltedIron;
      case 3:
        return this.state.flags.builtStorage;
      case 4:
        return this.state.flags.smeltedCopper;
      case 5:
        return this.state.flags.builtBench;
      case 6:
        return research.dedicatedSmelting.completed;
      case 7:
        return this.state.flags.furnaceBuilt;
      case 8:
        return research.utilityBotSystems.completed;
      case 9:
        return this.state.flags.firstBotBuilt;
      case 10:
        return this.state.flags.chargingStationBuilt && this.state.flags.minerRunning && this.state.flags.observedOutputFull;
      case 11:
        return this.state.automation.completed;
      case 12:
        return this.state.flags.delegatedConstruction;
      case 13:
        return this.state.flags.delegatedResearch && research.projectCoordination.completed;
      default:
        return false;
    }
  }

  private markBuildingFlag(type: BuildingTypeId): void {
    if (type === "storage") this.state.flags.builtStorage = true;
    if (type === "researchBench") this.state.flags.builtBench = true;
    if (type === "furnace") this.state.flags.furnaceBuilt = true;
    if (type === "botCradle") this.state.flags.cradleBuilt = true;
    if (type === "chargingStation") this.state.flags.chargingStationBuilt = true;
  }

  private beginMove(
    bot: BotEntity,
    target: SelectableEntity,
    interaction: "deposit" | "input" | "output" | "operator" | "construction" | "charging",
    nextTask: BotTask,
  ): boolean {
    if (!planBotPath(this.state, bot, target, interaction, "Player order")) {
      bot.status = `Blocked: ${bot.path.repathReason}`;
      bot.blockingReason = bot.path.repathReason;
      return false;
    }
    bot.task = {
      ...nextTask,
      kind: "moving",
      destination: bot.path.interactionDestination ? { ...bot.path.interactionDestination } : undefined,
      nextKind: nextTask.kind,
      interaction,
      progress: 0,
    };
    bot.status = `Moving // ${nextTask.label}`;
    bot.blockingReason = "";
    return true;
  }

  private cancelBotTask(bot: BotEntity): void {
    const projectTarget = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
    if (projectTarget && inventoryTotal(projectTarget.manualProjectDelivery ?? {}) > 0) {
      projectTarget.manualProjectDelivery = {};
    }
    if (bot.task.payload) removeItems(bot.reservedInventory, bot.task.payload);
    if (bot.task.kind === "researching" || (bot.task.kind === "moving" && bot.task.nextKind === "researching")) {
      const bench = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
      if (bench?.activeResearchId) this.cancelResearch(bench.id);
    }
    bot.task = clone(IDLE_TASK);
    bot.solarDeployed = false;
    this.releaseBotClaims(bot.id);
  }

  private setIdle(bot: BotEntity, status: string, blockingReason: string): void {
    bot.task = clone(IDLE_TASK);
    bot.status = status;
    bot.blockingReason = blockingReason;
  }

  private reject(bot: BotEntity, reason: string): false {
    bot.status = `Blocked: ${reason}`;
    bot.blockingReason = reason;
    this.notify(reason, "warning");
    return false;
  }

  private notify(text: string, tone: "info" | "success" | "warning"): void {
    this.state.notifications.push({
      id: this.state.nextId++,
      text,
      tone,
      expiresAt: this.state.gameTime + 5,
    });
    if (this.state.notifications.length > 4) this.state.notifications.shift();
  }

  private nearestDeposit(position: GridPoint, itemId: "ironOre" | "copperOre", botId?: string): DepositEntity | undefined {
    return Object.values(this.state.deposits)
      .filter((deposit) => deposit.itemId === itemId && deposit.remaining > 0 && (!deposit.reservedBy || deposit.reservedBy === botId))
      .sort((a, b) => distance(a.position, position) - distance(b.position, position))[0];
  }

  private hasRunningProgram(templateId: ProgramTemplateId): boolean {
    return Object.values(this.state.bots).some(
      (bot) => bot.program?.templateId === templateId && bot.program.running,
    );
  }

  private isTileOccupied(x: number, y: number): boolean {
    if (
      Object.values(this.state.deposits).some(
        (deposit) => Math.round(deposit.position.x) === x && Math.round(deposit.position.y) === y,
      )
    ) {
      return true;
    }
    return Object.values(this.state.buildings).some(
      (building) =>
        !building.cancelled &&
        x >= building.position.x &&
        x < building.position.x + building.footprint.width &&
        y >= building.position.y &&
        y < building.position.y + building.footprint.height,
    );
  }
}

export function createTestSimulation(): Simulation {
  return new Simulation();
}

export { PROGRAM_TEMPLATES as PROGRAMS };
