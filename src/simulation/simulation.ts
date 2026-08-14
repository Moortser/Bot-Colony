import { BOT_FRAMES, BUILDINGS, OBJECTIVES, RECIPES, RESEARCH } from "../data/content";
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
  ProgramTemplateId,
  RecipeId,
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

const PROGRAMS: Record<ProgramTemplateId, { name: string; commands: ProgramCommand[] }> = {
  ironMiner: {
    name: "Iron Miner",
    commands: [
      { id: "find", kind: "findDeposit", label: "Find available iron deposit" },
      { id: "move", kind: "move", label: "Move to deposit" },
      { id: "mine", kind: "mine", label: "Mine until cargo is full" },
      { id: "deliver", kind: "deliver", label: "Supply furnace input" },
      { id: "charge", kind: "recharge", label: "Recharge below 15%" },
      { id: "repeat", kind: "repeat", label: "Repeat" },
    ],
  },
  factoryHauler: {
    name: "Factory Hauler",
    commands: [
      { id: "request", kind: "pickupRequest", label: "Find available pickup request" },
      { id: "pickup", kind: "collectOutput", label: "Collect reserved output" },
      { id: "store", kind: "deliverStorage", label: "Deliver to Field Storage" },
      { id: "charge", kind: "recharge", label: "Recharge below 15%" },
      { id: "repeat", kind: "repeat", label: "Repeat" },
    ],
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function distance(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function interactionPoint(building: BuildingEntity, mode: "input" | "output" | "operator" | "construction"): GridPoint {
  switch (mode) {
    case "input":
      return { x: building.position.x - 1, y: building.position.y + building.footprint.height - 1 };
    case "output":
      return { x: building.position.x + building.footprint.width, y: building.position.y };
    case "operator":
      return { x: building.position.x + building.footprint.width, y: building.position.y + 1 };
    case "construction":
      return { x: building.position.x - 1, y: building.position.y };
  }
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
    modules: frame === "seed" ? ["bootstrapKit"] : [],
    task: clone(IDLE_TASK),
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
    version: 1,
    tick: 0,
    gameTime: 0,
    speed: 1,
    previousSpeed: 1,
    nextId: 1,
    mapSize: 32,
    bots: { [seed.id]: seed },
    buildings: {},
    deposits,
    research,
    logisticsRequests: {},
    reservations: {},
    unlocks: ["building.storage", "building.researchBench"],
    objectiveIndex: 0,
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
      firstBotBuilt: false,
      minerRunning: false,
      observedOutputFull: false,
      autonomousLoop: false,
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
  };
}

export class Simulation {
  public readonly state: SimulationState;
  private accumulator = 0;

  public constructor(snapshot?: string | SimulationState) {
    this.state =
      typeof snapshot === "string"
        ? (JSON.parse(snapshot) as SimulationState)
        : snapshot
          ? clone(snapshot)
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
      const suspendedTask = seed.suspendedTask;
      seed.suspendedTask = undefined;
      if (suspendedTask) {
        seed.task = suspendedTask;
        seed.status = `Resuming // ${suspendedTask.label}`;
        seed.blockingReason = "";
      } else {
        this.setIdle(seed, "Solar array retracted", "");
      }
      return true;
    }
    const pausedForPower = seed.blockingReason === "Insufficient power";
    if (seed.task.kind !== "idle" && seed.task.kind !== "charging") {
      seed.suspendedTask = clone(seed.task);
    }
    seed.solarDeployed = true;
    seed.task = { kind: "charging", label: "Solar array deployed", progress: 0, duration: 0 };
    seed.status = "Charging from local sunlight";
    seed.blockingReason = pausedForPower
      ? "Insufficient power // interrupted task preserved while recharging"
      : "Movement locked while solar array is deployed";
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
    this.beginMove(bot, deposit.position, {
      kind: "mining",
      label: `Mining ${deposit.name}`,
      targetId: deposit.id,
      progress: 0,
      duration: 2.4,
      itemId,
    });
    bot.status = `Travelling to ${deposit.name}`;
    return true;
  }

  public commandCraft(recipeId: RecipeId): boolean {
    const seed = this.seed;
    const recipe = RECIPES[recipeId];
    if (!recipe || recipeId === "furnaceIron" || recipeId === "utilityBot") return false;
    if (seed.solarDeployed) return this.reject(seed, "Retract solar array before using bootstrap machinery");
    if (!hasItems(seed.inventory, recipe.inputs)) return this.reject(seed, `Missing inputs for ${recipe.name}`);
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
    if (!canReserve(this.seed.inventory, this.seed.reservedInventory, definition.cost)) {
      return { valid: false, reason: "Required construction materials must be in Seed cargo" };
    }
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
    };
    this.state.buildings[id] = building;
    addItems(this.seed.reservedInventory, definition.cost);
    this.beginMove(this.seed, interactionPoint(building, "construction"), {
      kind: "building",
      label: `Constructing ${definition.name}`,
      targetId: id,
      progress: 0,
      duration: definition.buildTime,
      payload: { ...definition.cost },
    });
    this.seed.status = `Delivering reserved materials to ${definition.name}`;
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
    this.beginMove(seed, interactionPoint(building, "input"), {
      kind: "program",
      label: `Supplying ${building.name}`,
      targetId: building.id,
      itemId,
      progress: 0,
      duration: 0,
    });
    return true;
  }

  public commandConstructSite(buildingId: string): boolean {
    const building = this.state.buildings[buildingId];
    if (!building || building.complete) return false;
    const cost = BUILDINGS[building.type].cost;
    const remaining: Inventory = {};
    for (const [itemId, quantity] of Object.entries(cost) as Array<[ItemId, number]>) {
      const missing = Math.max(0, quantity - itemCount(building.constructionInventory, itemId));
      if (missing > 0) remaining[itemId] = missing;
    }
    if (!canReserve(this.seed.inventory, this.seed.reservedInventory, remaining)) {
      return this.reject(this.seed, "Missing construction materials in Seed cargo");
    }
    this.cancelBotTask(this.seed);
    addItems(this.seed.reservedInventory, remaining);
    this.beginMove(this.seed, interactionPoint(building, "construction"), {
      kind: "building",
      label: `Constructing ${building.name}`,
      targetId: building.id,
      progress: 0,
      duration: BUILDINGS[building.type].buildTime,
      payload: remaining,
    });
    return true;
  }

  public commandCollectBuilding(buildingId: string): boolean {
    const building = this.state.buildings[buildingId];
    if (!building?.complete || inventoryTotal(building.output) === 0) {
      return this.reject(this.seed, "No finished items available");
    }
    this.cancelBotTask(this.seed);
    this.beginMove(this.seed, interactionPoint(building, "output"), {
      kind: "program",
      label: `Collecting from ${building.name}`,
      targetId: building.id,
      progress: 0,
      duration: 0,
    });
    return true;
  }

  public commandDepositToStorage(storageId: string): boolean {
    const storage = this.state.buildings[storageId];
    if (!storage?.complete || storage.type !== "storage" || inventoryTotal(this.seed.inventory) === 0) return false;
    this.cancelBotTask(this.seed);
    this.beginMove(this.seed, interactionPoint(storage, "input"), {
      kind: "program",
      label: `Depositing cargo at ${storage.name}`,
      targetId: storage.id,
      progress: 0,
      duration: 0,
    });
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
    const required = Object.fromEntries(definition.requiredItems.map((itemId) => [itemId, 1])) as Inventory;
    if (!canReserve(seed.inventory, seed.reservedInventory, required)) {
      node.blockingReason = "Required example items must be together in Seed cargo";
      return this.reject(seed, node.blockingReason);
    }
    this.cancelBotTask(seed);
    addItems(seed.reservedInventory, required);
    node.assignedBenchId = bench.id;
    node.assignedOperatorId = seed.id;
    node.blockingReason = "Operator travelling with reserved items";
    bench.activeResearchId = researchId;
    bench.operatorId = seed.id;
    bench.status = `Preparing ${definition.name}`;
    bench.blockingReason = node.blockingReason;
    this.beginMove(seed, interactionPoint(bench, "operator"), {
      kind: "researching",
      label: `Operating bench: ${definition.name}`,
      targetId: bench.id,
      progress: 0,
      duration: definition.duration,
      payload: required,
    });
    return true;
  }

  public cancelResearch(benchId: string): boolean {
    const bench = this.state.buildings[benchId];
    if (!bench?.activeResearchId) return false;
    const node = this.state.research[bench.activeResearchId];
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
    bench.status = "Idle";
    bench.blockingReason = "No research selected";
    if (this.seed.task.targetId === benchId || this.seed.suspendedTask?.targetId === benchId) {
      this.cancelBotTask(this.seed);
    }
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
    this.beginMove(seed, interactionPoint(cradle, "input"), {
      kind: "supplyingCradle",
      label: "Supplying Basic Utility Bot components",
      targetId: cradle.id,
      progress: 0,
      duration: 0,
      payload: { ...recipe.inputs },
    });
    return true;
  }

  public assignProgram(botId: string, templateId: ProgramTemplateId): boolean {
    const bot = this.state.bots[botId];
    if (!bot || bot.frame !== "utility" || !this.state.unlocks.includes("program.basic")) return false;
    this.releaseBotClaims(bot.id);
    const definition = PROGRAMS[templateId];
    const program: BotProgram = {
      templateId,
      name: definition.name,
      commands: clone(definition.commands),
      running: true,
      currentStep: 0,
      blockedReason: "",
      phase: "acquire",
    };
    bot.program = program;
    bot.modules = [templateId === "ironMiner" ? "miningTool" : "cargoRack"];
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
    bot.program.blockedReason = "Program stopped by operator";
    this.releaseBotClaims(bot.id);
    this.setIdle(bot, "Program stopped", "Awaiting program start");
    return true;
  }

  public tryClaimRequest(requestId: string, botId: string): boolean {
    const request = this.state.logisticsRequests[requestId];
    const bot = this.state.bots[botId];
    return !!request && !!bot && request.active && this.claimRequest(request, bot);
  }

  public reorderProgram(botId: string, commandIndex: number, direction: -1 | 1): boolean {
    const program = this.state.bots[botId]?.program;
    if (!program) return false;
    const nextIndex = commandIndex + direction;
    if (nextIndex < 0 || nextIndex >= program.commands.length) return false;
    const command = program.commands[commandIndex];
    const other = program.commands[nextIndex];
    if (!command || !other) return false;
    program.commands[commandIndex] = other;
    program.commands[nextIndex] = command;
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

    for (const bot of Object.values(this.state.bots)) {
      if (bot.program?.running) this.updateProgram(bot, delta);
      else this.updateBotTask(bot, delta);
    }
    this.updateBuildings(delta);
    this.updateResearch(delta);
    this.refreshRequests();
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
        this.pauseBotForPower(bot);
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
      if (!building) return this.setIdle(bot, "Construction cancelled", "Destination invalid");
      if (bot.battery <= 0) {
        building.status = "Paused: Insufficient power";
        building.blockingReason = "Insufficient power";
        this.pauseBotForPower(bot);
        return;
      }
      const workDelta = Math.min(delta, bot.battery / 0.45);
      bot.task.progress += workDelta;
      bot.battery = Math.max(0, bot.battery - 0.45 * workDelta);
      if (bot.battery < Number.EPSILON) bot.battery = 0;
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
        this.notify(`${building.name.toUpperCase()} // Construction complete`, "success");
        this.setIdle(bot, `${building.name} construction complete`, "");
      } else if (workDelta < delta || bot.battery <= 0) {
        building.status = "Paused: Insufficient power";
        building.blockingReason = "Insufficient power";
        this.pauseBotForPower(bot);
      }
      return;
    }
    if (bot.task.kind === "researching") return;
    if (bot.task.kind === "supplyingCradle") return;
    if (bot.task.kind === "program") this.finishManualTransfer(bot);
  }

  private moveBot(bot: BotEntity, delta: number): void {
    const destination = bot.task.destination;
    if (!destination) return this.setIdle(bot, "Stopped", "Destination invalid");
    const dx = destination.x - bot.position.x;
    const dy = destination.y - bot.position.y;
    const remaining = Math.hypot(dx, dy);
    const speed = BOT_FRAMES[bot.frame].moveSpeed;
    if (remaining <= Number.EPSILON) {
      bot.position = { ...destination };
      const nextKind = bot.task.nextKind ?? "idle";
      bot.task = {
        ...bot.task,
        kind: nextKind,
        label: bot.task.label,
        destination: undefined,
        nextKind: undefined,
        progress: 0,
      };
      this.onArrival(bot);
      return;
    }
    if (bot.battery <= 0) return this.pauseBotForPower(bot);
    const amount = Math.min(speed * delta, remaining, bot.battery / 0.16);
    bot.battery = Math.max(0, bot.battery - 0.16 * amount);
    if (bot.battery < Number.EPSILON) bot.battery = 0;
    if (remaining <= amount + Number.EPSILON) {
      bot.position = { ...destination };
      const nextKind = bot.task.nextKind ?? "idle";
      bot.task = {
        ...bot.task,
        kind: nextKind,
        label: bot.task.label,
        destination: undefined,
        nextKind: undefined,
        progress: 0,
      };
      this.onArrival(bot);
      return;
    }
    bot.position.x += (dx / remaining) * amount;
    bot.position.y += (dy / remaining) * amount;
    if (bot.battery <= 0) this.pauseBotForPower(bot);
  }

  private onArrival(bot: BotEntity): void {
    if (bot.task.kind === "mining") {
      bot.status = bot.task.label;
      bot.blockingReason = "";
      return;
    }
    if (bot.task.kind === "building") {
      const building = bot.task.targetId ? this.state.buildings[bot.task.targetId] : undefined;
      if (!building || !bot.task.payload || !removeItems(bot.inventory, bot.task.payload)) {
        this.cancelBotTask(bot);
        this.reject(bot, "Reserved construction materials are no longer available");
        return;
      }
      removeItems(bot.reservedInventory, bot.task.payload);
      addItems(building.constructionInventory, bot.task.payload);
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
    if (bot.battery < 2) return this.pauseBotForPower(bot);
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
        transferItem(building.output, bot.inventory, bot.inventoryCapacity, itemId, 99);
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
      building.power = Math.min(100, building.power + 0.25 * delta);
      if (building.type === "furnace") this.updateFurnace(building, delta);
      if (building.type === "botCradle") this.updateCradle(building, delta);
    }
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
        node.blockingReason = "A reserved example item is missing";
      } else if (!operator || operator.task.kind !== "researching" || operator.task.targetId !== bench.id) {
        node.blockingReason = "Assigned operator is not at the bench";
      } else if (operator.battery <= 1) {
        node.blockingReason = "Operator has insufficient power";
        this.pauseBotForPower(operator);
      } else if (bench.power <= 1) {
        node.blockingReason = "Bench has insufficient power";
      } else {
        node.blockingReason = "";
        node.progress += delta;
        operator.battery = Math.max(0, operator.battery - definition.energyPerSecond * delta);
        bench.power = Math.max(0, bench.power - definition.energyPerSecond * 0.5 * delta);
      }
      bench.blockingReason = node.blockingReason;
      bench.status = node.blockingReason ? `Paused: ${node.blockingReason}` : `Researching ${definition.name}`;
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
    if (bot.battery < 15 && program.phase !== "recharge") {
      this.releaseBotClaims(bot.id);
      program.phase = "recharge";
      program.currentStep = program.commands.findIndex((command) => command.kind === "recharge");
    }
    if (program.phase === "recharge") {
      bot.task = { kind: "program", label: `${program.name}: emergency solar recharge`, progress: bot.battery, duration: bot.maxBattery };
      bot.status = "Recharging onboard emergency cell";
      bot.blockingReason = "Program paused below battery threshold";
      bot.battery = Math.min(bot.maxBattery, bot.battery + 5 * delta);
      if (bot.battery >= 75) {
        program.phase = "acquire";
        program.currentStep = 0;
        bot.blockingReason = "";
      }
      return;
    }
    if (program.templateId === "ironMiner") this.updateMinerProgram(bot, program, delta);
    else this.updateHaulerProgram(bot, program, delta);
  }

  private updateMinerProgram(bot: BotEntity, program: BotProgram, delta: number): void {
    if (itemCount(bot.inventory, "ironOre") >= bot.inventoryCapacity || program.phase === "deliver") {
      const furnace = this.findBestFurnace();
      if (!furnace) {
        program.phase = "deliver";
        program.blockedReason = "No furnace input has free capacity";
        bot.status = "Blocked: Furnace input unavailable";
        bot.blockingReason = program.blockedReason;
        return;
      }
      program.phase = "deliver";
      program.currentStep = 3;
      program.targetId = furnace.id;
      bot.task = { kind: "program", label: "Iron Miner: supplying furnace", targetId: furnace.id, progress: 0, duration: 0 };
      if (!this.moveToward(bot, interactionPoint(furnace, "input"), delta)) return;
      const moved = transferItem(bot.inventory, furnace.input, BUILDINGS.furnace.inputCapacity, "ironOre", 99);
      if (moved > 0) {
        program.phase = "acquire";
        program.currentStep = 5;
        program.blockedReason = "";
        bot.blockingReason = "";
      }
      return;
    }
    let deposit = program.targetId ? this.state.deposits[program.targetId] : undefined;
    if (!deposit || deposit.itemId !== "ironOre" || deposit.remaining <= 0 || (deposit.reservedBy && deposit.reservedBy !== bot.id)) {
      deposit = this.nearestDeposit(bot.position, "ironOre", bot.id);
      if (!deposit) {
        program.blockedReason = "No unclaimed iron deposit";
        bot.status = "Blocked: No available iron deposit";
        bot.blockingReason = program.blockedReason;
        return;
      }
      deposit.reservedBy = bot.id;
      program.targetId = deposit.id;
      program.phase = "moveDeposit";
    }
    if (program.phase !== "mining") {
      program.currentStep = 1;
      bot.task = { kind: "program", label: `Iron Miner: moving to ${deposit.name}`, targetId: deposit.id, progress: 0, duration: 0 };
      if (!this.moveToward(bot, deposit.position, delta)) return;
      program.phase = "mining";
      bot.task.progress = 0;
    }
    program.currentStep = 2;
    bot.task.label = `Iron Miner: mining ${deposit.name}`;
    bot.task.progress += delta;
    bot.status = `Mining autonomously // ${inventoryTotal(bot.inventory)}/${bot.inventoryCapacity}`;
    bot.blockingReason = "";
    bot.battery = Math.max(0, bot.battery - 0.55 * delta);
    if (bot.task.progress >= 2.6 && deposit.remaining > 0) {
      bot.task.progress -= 2.6;
      deposit.remaining -= 1;
      addItem(bot.inventory, "ironOre", 1);
      if (!canFit(bot.inventory, bot.inventoryCapacity)) {
        deposit.reservedBy = undefined;
        program.targetId = undefined;
        program.phase = "deliver";
      }
    }
  }

  private updateHaulerProgram(bot: BotEntity, program: BotProgram, delta: number): void {
    if (inventoryTotal(bot.inventory) > 0 || program.phase === "deliverStorage") {
      const storage = this.findBuilding("storage");
      if (!storage || inventoryTotal(storage.input) >= BUILDINGS.storage.inputCapacity) {
        program.phase = "deliverStorage";
        program.blockedReason = storage ? "Field Storage is full" : "No completed Field Storage";
        bot.status = `Blocked: ${program.blockedReason}`;
        bot.blockingReason = program.blockedReason;
        return;
      }
      program.phase = "deliverStorage";
      program.currentStep = 2;
      bot.task = { kind: "program", label: "Factory Hauler: delivering to storage", targetId: storage.id, progress: 0, duration: 0 };
      if (!this.moveToward(bot, interactionPoint(storage, "input"), delta)) return;
      for (const itemId of Object.keys(bot.inventory) as ItemId[]) {
        transferItem(bot.inventory, storage.input, BUILDINGS.storage.inputCapacity, itemId, 99);
      }
      this.state.flags.autonomousLoop = itemCount(storage.input, "ironIngot") > 0 && this.hasRunningProgram("ironMiner");
      this.releaseBotClaims(bot.id);
      program.phase = "acquire";
      program.currentStep = 4;
      program.targetId = undefined;
      bot.blockingReason = "";
      return;
    }

    let request = program.claimId ? this.state.logisticsRequests[program.claimId] : undefined;
    if (!request?.active || (request.claimedBy && request.claimedBy !== bot.id)) {
      request = Object.values(this.state.logisticsRequests).find(
        (candidate) => candidate.active && candidate.type === "buildingOutput" && !candidate.claimedBy,
      );
      if (!request || !this.claimRequest(request, bot)) {
        program.blockedReason = "No pickup request available";
        bot.status = "Idle: Waiting for finished furnace output";
        bot.blockingReason = program.blockedReason;
        program.currentStep = 0;
        return;
      }
      program.claimId = request.id;
      program.targetId = request.buildingId;
      program.phase = "collect";
    }
    const building = this.state.buildings[request.buildingId];
    if (!building) {
      this.releaseBotClaims(bot.id);
      program.phase = "acquire";
      return;
    }
    program.currentStep = 1;
    bot.task = { kind: "program", label: `Factory Hauler: collecting ${request.itemId}`, targetId: building.id, progress: 0, duration: 0 };
    if (!this.moveToward(bot, interactionPoint(building, "output"), delta)) return;
    transferItem(building.output, bot.inventory, bot.inventoryCapacity, request.itemId, request.quantity);
    request.active = false;
    program.phase = "deliverStorage";
  }

  private moveToward(bot: BotEntity, destination: GridPoint, delta: number): boolean {
    const remaining = distance(bot.position, destination);
    if (remaining < 0.05) {
      bot.position = { ...destination };
      return true;
    }
    const amount = Math.min(remaining, BOT_FRAMES[bot.frame].moveSpeed * delta);
    bot.position.x += ((destination.x - bot.position.x) / remaining) * amount;
    bot.position.y += ((destination.y - bot.position.y) / remaining) * amount;
    bot.battery = Math.max(0, bot.battery - 0.12 * amount);
    return false;
  }

  private refreshRequests(): void {
    const activeIds = new Set<string>();
    for (const building of Object.values(this.state.buildings)) {
      if (!building.complete) {
        for (const [itemId, quantity] of Object.entries(BUILDINGS[building.type].cost) as Array<[ItemId, number]>) {
          const delivered = itemCount(building.constructionInventory, itemId);
          if (quantity > delivered) {
            const id = `request:${building.id}:construction:${itemId}`;
            activeIds.add(id);
            this.upsertRequest({
              id,
              type: "construction",
              buildingId: building.id,
              itemId,
              quantity: quantity - delivered,
              active: true,
              label: `Construction needs ${quantity - delivered} ${itemId}`,
            });
          }
        }
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
            active: true,
            label: `Needs ${needed} Iron Ore`,
          });
        }
        const available = itemCount(building.output, "ironIngot");
        if (available > 0) {
          const id = `request:${building.id}:output:ironIngot`;
          activeIds.add(id);
          this.upsertRequest({
            id,
            type: "buildingOutput",
            buildingId: building.id,
            itemId: "ironIngot",
            quantity: available,
            active: true,
            label: `${available} Iron Ingot ready`,
          });
        }
      }
      if (building.type === "researchBench" && building.activeResearchId) {
        for (const itemId of RESEARCH[building.activeResearchId].requiredItems) {
          if (itemCount(building.researchHold, itemId) === 0) {
            const id = `request:${building.id}:research:${itemId}`;
            activeIds.add(id);
            this.upsertRequest({
              id,
              type: "researchItem",
              buildingId: building.id,
              itemId,
              quantity: 1,
              active: true,
              label: `Reserved ${itemId} en route`,
            });
          }
        }
      }
    }
    for (const request of Object.values(this.state.logisticsRequests)) {
      if (!activeIds.has(request.id)) {
        request.active = false;
        if (request.claimedBy) this.releaseBotClaims(request.claimedBy);
      }
    }
  }

  private upsertRequest(next: LogisticsRequest): void {
    const existing = this.state.logisticsRequests[next.id];
    this.state.logisticsRequests[next.id] = existing ? { ...next, claimedBy: existing.claimedBy } : next;
  }

  private claimRequest(request: LogisticsRequest, bot: BotEntity): boolean {
    if (request.claimedBy && request.claimedBy !== bot.id) return false;
    request.claimedBy = bot.id;
    const id = `reservation:${request.id}`;
    this.state.reservations[id] = {
      id,
      requestId: request.id,
      botId: bot.id,
      itemId: request.itemId,
      quantity: Math.min(request.quantity, bot.inventoryCapacity),
      sourceId: request.buildingId,
      destinationId: this.findBuilding("storage")?.id ?? "",
    };
    return true;
  }

  private releaseBotClaims(botId: string): void {
    for (const deposit of Object.values(this.state.deposits)) {
      if (deposit.reservedBy === botId) deposit.reservedBy = undefined;
    }
    for (const request of Object.values(this.state.logisticsRequests)) {
      if (request.claimedBy === botId) request.claimedBy = undefined;
    }
    for (const [id, reservation] of Object.entries(this.state.reservations)) {
      if (reservation.botId === botId) delete this.state.reservations[id];
    }
    const bot = this.state.bots[botId];
    if (bot?.program) bot.program.claimId = undefined;
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
        return this.state.flags.minerRunning && this.state.flags.observedOutputFull;
      case 11:
        return this.state.flags.autonomousLoop;
      default:
        return false;
    }
  }

  private markBuildingFlag(type: BuildingTypeId): void {
    if (type === "storage") this.state.flags.builtStorage = true;
    if (type === "researchBench") this.state.flags.builtBench = true;
    if (type === "furnace") this.state.flags.furnaceBuilt = true;
    if (type === "botCradle") this.state.flags.cradleBuilt = true;
  }

  private beginMove(bot: BotEntity, destination: GridPoint, nextTask: BotTask): void {
    bot.task = {
      ...nextTask,
      kind: "moving",
      destination: { ...destination },
      nextKind: nextTask.kind,
      progress: 0,
    };
    bot.status = `Moving // ${nextTask.label}`;
    bot.blockingReason = "";
  }

  private cancelBotTask(bot: BotEntity): void {
    const tasks = [bot.task, bot.suspendedTask].filter((task): task is BotTask => Boolean(task));
    for (const task of tasks) {
      if (task.payload) removeItems(bot.reservedInventory, task.payload);
    }
    const researchTask = tasks.find(
      (task) => task.kind === "researching" || (task.kind === "moving" && task.nextKind === "researching"),
    );
    const bench = researchTask?.targetId ? this.state.buildings[researchTask.targetId] : undefined;
    bot.task = clone(IDLE_TASK);
    bot.suspendedTask = undefined;
    bot.solarDeployed = false;
    this.releaseBotClaims(bot.id);
    if (bench?.activeResearchId) this.cancelResearch(bench.id);
  }

  private setIdle(bot: BotEntity, status: string, blockingReason: string): void {
    bot.task = clone(IDLE_TASK);
    bot.suspendedTask = undefined;
    bot.status = status;
    bot.blockingReason = blockingReason;
  }

  private pauseBotForPower(bot: BotEntity): void {
    bot.status = "Paused: Insufficient power";
    bot.blockingReason = "Insufficient power";
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

  private findBestFurnace(): BuildingEntity | undefined {
    return Object.values(this.state.buildings).find(
      (building) =>
        building.complete &&
        building.type === "furnace" &&
        inventoryTotal(building.input) < BUILDINGS.furnace.inputCapacity,
    );
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

export { PROGRAMS };
