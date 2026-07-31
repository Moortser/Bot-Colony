export type ItemId =
  | "ironOre"
  | "copperOre"
  | "ironIngot"
  | "copperIngot"
  | "structuralFrame"
  | "simpleMotor"
  | "basicBattery"
  | "controller";

export type BuildingTypeId = "storage" | "researchBench" | "furnace" | "botCradle";
export type ResearchId = "dedicatedSmelting" | "utilityBotSystems" | "localPower" | "precisionAssembly";
export type RecipeId =
  | "microIron"
  | "microCopper"
  | "structuralFrame"
  | "simpleMotor"
  | "basicBattery"
  | "controller"
  | "furnaceIron"
  | "utilityBot";
export type ModuleId = "bootstrapKit" | "miningTool" | "cargoRack";
export type ProgramTemplateId = "ironMiner" | "factoryHauler";

export type Inventory = Partial<Record<ItemId, number>>;

export interface GridPoint {
  x: number;
  y: number;
  elevation?: number;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  shortName: string;
  color: number;
}

export interface RecipeDefinition {
  id: RecipeId | string;
  name: string;
  inputs: Inventory;
  outputs: Inventory;
  duration: number;
  energy: number;
}

export interface Footprint {
  width: number;
  height: number;
}

export interface BuildingDefinition {
  id: BuildingTypeId;
  name: string;
  description: string;
  footprint: Footprint;
  cost: Inventory;
  inputCapacity: number;
  outputCapacity: number;
  buildTime: number;
  knownAtStart: boolean;
  unlockId: string;
  color: number;
}

export interface ResearchDefinition {
  id: ResearchId;
  name: string;
  description: string;
  prerequisites: ResearchId[];
  requiredItems: ItemId[];
  duration: number;
  benchTier: number;
  energyPerSecond: number;
  unlockIds: string[];
  consumeItems: boolean;
  disabled?: boolean;
}

export interface BotFrameDefinition {
  id: "seed" | "utility";
  name: string;
  inventoryCapacity: number;
  batteryCapacity: number;
  moveSpeed: number;
  color: number;
}

export interface ObjectiveDefinition {
  id: string;
  title: string;
  detail: string;
}

export type BotTaskKind =
  | "idle"
  | "moving"
  | "mining"
  | "charging"
  | "microSmelting"
  | "fabricating"
  | "building"
  | "researching"
  | "supplyingCradle"
  | "program";

export interface BotTask {
  kind: BotTaskKind;
  label: string;
  targetId?: string;
  destination?: GridPoint;
  progress: number;
  duration: number;
  itemId?: ItemId;
  recipeId?: RecipeId;
  payload?: Inventory;
  nextKind?: BotTaskKind;
}

export interface ProgramCommand {
  id: string;
  label: string;
  kind:
    | "findDeposit"
    | "move"
    | "mine"
    | "deliver"
    | "pickupRequest"
    | "collectOutput"
    | "deliverStorage"
    | "recharge"
    | "wait"
    | "repeat";
}

export interface BotProgram {
  templateId: ProgramTemplateId;
  name: string;
  commands: ProgramCommand[];
  running: boolean;
  currentStep: number;
  blockedReason: string;
  phase: string;
  targetId?: string;
  claimId?: string;
}

export interface BotEntity {
  id: string;
  kind: "bot";
  frame: "seed" | "utility";
  name: string;
  position: GridPoint;
  battery: number;
  maxBattery: number;
  inventory: Inventory;
  inventoryCapacity: number;
  reservedInventory: Inventory;
  modules: ModuleId[];
  task: BotTask;
  program?: BotProgram;
  status: string;
  blockingReason: string;
  solarDeployed: boolean;
}

export interface BuildingEntity {
  id: string;
  kind: "building";
  type: BuildingTypeId;
  name: string;
  position: GridPoint;
  footprint: Footprint;
  complete: boolean;
  constructionProgress: number;
  constructionInventory: Inventory;
  input: Inventory;
  output: Inventory;
  researchHold: Inventory;
  productionProgress: number;
  activeRecipeId?: RecipeId;
  power: number;
  status: string;
  blockingReason: string;
  operatorId?: string;
  activeResearchId?: ResearchId;
  cradleQueued: boolean;
}

export interface DepositEntity {
  id: string;
  kind: "deposit";
  itemId: "ironOre" | "copperOre";
  name: string;
  position: GridPoint;
  remaining: number;
  reservedBy?: string;
}

export interface ResearchNodeState {
  id: ResearchId;
  completed: boolean;
  progress: number;
  assignedBenchId?: string;
  assignedOperatorId?: string;
  reservedItemRefs: Array<{ itemId: ItemId; quantity: 1; holderId: string }>;
  blockingReason: string;
}

export type LogisticsRequestType =
  | "buildingInput"
  | "buildingOutput"
  | "construction"
  | "researchItem"
  | "storage";

export interface LogisticsRequest {
  id: string;
  type: LogisticsRequestType;
  buildingId: string;
  itemId: ItemId;
  quantity: number;
  claimedBy?: string;
  active: boolean;
  label: string;
}

export interface Reservation {
  id: string;
  requestId: string;
  botId: string;
  itemId: ItemId;
  quantity: number;
  sourceId: string;
  destinationId: string;
}

export interface SimulationFlags {
  solarDeployed: boolean;
  minedIron: boolean;
  smeltedIron: boolean;
  builtStorage: boolean;
  smeltedCopper: boolean;
  builtBench: boolean;
  furnaceBuilt: boolean;
  fabricatedComponents: boolean;
  cradleBuilt: boolean;
  firstBotBuilt: boolean;
  minerRunning: boolean;
  observedOutputFull: boolean;
  autonomousLoop: boolean;
}

export interface Notification {
  id: number;
  text: string;
  tone: "info" | "success" | "warning";
  expiresAt: number;
}

export interface SimulationState {
  version: 1;
  tick: number;
  gameTime: number;
  speed: 0 | 1 | 2 | 4;
  previousSpeed: 1 | 2 | 4;
  nextId: number;
  mapSize: number;
  bots: Record<string, BotEntity>;
  buildings: Record<string, BuildingEntity>;
  deposits: Record<string, DepositEntity>;
  research: Record<ResearchId, ResearchNodeState>;
  logisticsRequests: Record<string, LogisticsRequest>;
  reservations: Record<string, Reservation>;
  unlocks: string[];
  objectiveIndex: number;
  flags: SimulationFlags;
  notifications: Notification[];
  debug: boolean;
}

export type SelectableEntity = BotEntity | BuildingEntity | DepositEntity;

export interface SimulationSnapshot {
  state: SimulationState;
}
