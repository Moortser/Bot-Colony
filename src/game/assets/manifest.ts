import type { BotEntity, BuildingEntity, DepositEntity, Inventory, ItemId } from "../../simulation/types";

export const TEXTURE_KEYS = {
  terrain: "world.terrain",
  decals: "world.decals",
  overlays: "world.overlays",
  seed: "bot.seed",
  deposits: "world.deposits",
  storage: "building.storage",
  supportBuildings: "building.support",
  cargo: "cargo.external",
  activityFx: "fx.activity",
  uiIcons: "ui.icons",
} as const;

export const ASSET_PATHS = {
  terrain: "assets/sprites/terrain-soil.png",
  decals: "assets/sprites/terrain-decals.png",
  overlays: "assets/sprites/tile-overlays.png",
  seed: "assets/sprites/seed-drone.png",
  deposits: "assets/sprites/deposits.png",
  storage: "assets/sprites/field-storage.png",
  supportBuildings: "assets/sprites/support-buildings.png",
  cargo: "assets/sprites/cargo.png",
  activityFx: "assets/sprites/activity-fx.png",
  uiIcons: "assets/sprites/ui-icons.png",
} as const;

export const SHEETS = [
  { key: TEXTURE_KEYS.terrain, path: ASSET_PATHS.terrain, frameWidth: 96, frameHeight: 48, frames: 6 },
  { key: TEXTURE_KEYS.decals, path: ASSET_PATHS.decals, frameWidth: 96, frameHeight: 48, frames: 8 },
  { key: TEXTURE_KEYS.overlays, path: ASSET_PATHS.overlays, frameWidth: 96, frameHeight: 48, frames: 3 },
  { key: TEXTURE_KEYS.seed, path: ASSET_PATHS.seed, frameWidth: 96, frameHeight: 96, frames: 18 },
  { key: TEXTURE_KEYS.deposits, path: ASSET_PATHS.deposits, frameWidth: 96, frameHeight: 96, frames: 6 },
  { key: TEXTURE_KEYS.storage, path: ASSET_PATHS.storage, frameWidth: 192, frameHeight: 128, frames: 6 },
  { key: TEXTURE_KEYS.supportBuildings, path: ASSET_PATHS.supportBuildings, frameWidth: 192, frameHeight: 128, frames: 3 },
  { key: TEXTURE_KEYS.cargo, path: ASSET_PATHS.cargo, frameWidth: 32, frameHeight: 32, frames: 4 },
  { key: TEXTURE_KEYS.activityFx, path: ASSET_PATHS.activityFx, frameWidth: 48, frameHeight: 48, frames: 6 },
  { key: TEXTURE_KEYS.uiIcons, path: ASSET_PATHS.uiIcons, frameWidth: 16, frameHeight: 16, frames: 12 },
] as const;

export const ZOOM_STEPS = [0.5, 1, 2] as const;

export const SPRITE_ORIGINS = {
  terrain: { x: 0.5, y: 0.5 },
  bot: { x: 0.5, y: 0.86 },
  deposit: { x: 0.5, y: 0.82 },
  building: { x: 0.5, y: 0.82 },
  cargo: { x: 0.5, y: 1 },
  activityFx: { x: 0.5, y: 0.75 },
} as const;

export const SEED_FRAMES = {
  idle: 0,
  deploy0: 1,
  deploy1: 2,
  deploy2: 3,
  deployed: 4,
  charging0: 5,
  charging1: 6,
  move0: 7,
  move1: 8,
  mine0: 9,
  mine1: 10,
  smelt0: 11,
  smelt1: 12,
  build0: 13,
  build1: 14,
  lowPower: 15,
  selected: 16,
  utility: 17,
} as const;

export const OVERLAY_FRAMES = { valid: 0, invalid: 1, selected: 2 } as const;
export const DECAL_FRAMES = {
  scorch: 0,
  crack: 1,
  rocks: 2,
  treads: 3,
  stakes: 4,
  plate: 5,
  cable: 6,
  dust: 7,
} as const;

export const UI_ICON_FRAMES = {
  build: 0,
  research: 1,
  objectives: 2,
  pause: 3,
  play: 4,
  save: 5,
  energy: 6,
  bots: 7,
  inspect: 8,
  solar: 9,
  mine: 10,
  smelt: 11,
} as const;

export function terrainFrameAt(x: number, y: number): number {
  return Math.abs((x * 17 + y * 31 + x * y * 3) % 6);
}

export function decalFrameAt(x: number, y: number): number | undefined {
  if (x >= 13 && x <= 17 && y >= 13 && y <= 17) {
    if (x === 15 && y === 15) return DECAL_FRAMES.scorch;
    if ((x + y) % 3 === 0) return DECAL_FRAMES.treads;
  }
  const hash = Math.abs((x * 47 + y * 73 + x * y * 11) % 97);
  if (hash === 3) return DECAL_FRAMES.crack;
  if (hash === 11) return DECAL_FRAMES.rocks;
  if (hash === 23) return DECAL_FRAMES.stakes;
  if (hash === 37) return DECAL_FRAMES.plate;
  if (hash === 49) return DECAL_FRAMES.cable;
  if (hash === 71) return DECAL_FRAMES.dust;
  return undefined;
}

export function seedFrameFor(bot: BotEntity, viewTimeMs: number): number {
  const phase = Math.floor(viewTimeMs / 140) % 2;
  if (bot.frame === "utility") return SEED_FRAMES.utility;
  if (bot.task.kind === "moving") return phase ? SEED_FRAMES.move1 : SEED_FRAMES.move0;
  if (bot.task.kind === "mining") return phase ? SEED_FRAMES.mine1 : SEED_FRAMES.mine0;
  if (bot.task.kind === "microSmelting" || bot.task.kind === "fabricating") {
    return phase ? SEED_FRAMES.smelt1 : SEED_FRAMES.smelt0;
  }
  if (bot.task.kind === "building") return phase ? SEED_FRAMES.build1 : SEED_FRAMES.build0;
  if (bot.task.kind === "charging" || bot.solarDeployed) return phase ? SEED_FRAMES.charging1 : SEED_FRAMES.charging0;
  if (bot.battery < 20) return SEED_FRAMES.lowPower;
  return SEED_FRAMES.idle;
}

export function depositFrameFor(deposit: DepositEntity): number {
  const depletion = deposit.remaining <= 26 ? 2 : deposit.remaining <= 53 ? 1 : 0;
  return (deposit.itemId === "ironOre" ? 0 : 3) + depletion;
}

function inventoryQuantity(inventory: Inventory): number {
  return Object.values(inventory).reduce((sum, quantity) => sum + (quantity ?? 0), 0);
}

export function storageFrameFor(building: BuildingEntity): number {
  if (!building.complete) {
    if (building.constructionProgress < 0.34) return 0;
    if (building.constructionProgress < 0.68) return 1;
    return 2;
  }
  const stored = inventoryQuantity(building.input) + inventoryQuantity(building.output);
  if (stored === 0) return 3;
  if (stored < 12) return 4;
  return 5;
}

export function cargoFrameFor(inventory: Inventory): number | undefined {
  const order: ItemId[] = ["ironOre", "copperOre", "ironIngot", "copperIngot"];
  const frame = order.findIndex((itemId) => (inventory[itemId] ?? 0) > 0);
  return frame < 0 ? undefined : frame;
}
