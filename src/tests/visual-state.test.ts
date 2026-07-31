import { describe, expect, it } from "vitest";
import {
  cargoFrameFor,
  depositFrameFor,
  SEED_FRAMES,
  seedFrameFor,
  SHEETS,
  storageFrameFor,
  terrainFrameAt,
  ZOOM_STEPS,
} from "../game/assets/manifest";
import { createBotEntity } from "../simulation/simulation";
import type { BuildingEntity, DepositEntity } from "../simulation/types";

function storage(overrides: Partial<BuildingEntity> = {}): BuildingEntity {
  return {
    id: "building-test",
    kind: "building",
    type: "storage",
    name: "Field Storage Platform",
    position: { x: 12, y: 12 },
    footprint: { width: 2, height: 2 },
    complete: false,
    constructionProgress: 0,
    constructionInventory: {},
    input: {},
    output: {},
    researchHold: {},
    productionProgress: 0,
    power: 100,
    status: "Construction site placed",
    blockingReason: "",
    cradleQueued: false,
    ...overrides,
  };
}

describe("pixel asset manifest", () => {
  it("keeps stable and unique texture keys with declared frames", () => {
    expect(new Set(SHEETS.map((sheet) => sheet.key)).size).toBe(SHEETS.length);
    expect(SHEETS.every((sheet) => sheet.path.endsWith(".png") && sheet.frames > 0)).toBe(true);
  });

  it("uses discrete scale-safe zoom values", () => {
    expect(ZOOM_STEPS).toEqual([0.5, 1, 2]);
  });

  it("selects deterministic terrain variations", () => {
    expect(terrainFrameAt(7, 13)).toBe(terrainFrameAt(7, 13));
    const sample = Array.from({ length: 4 }, (_, x) =>
      Array.from({ length: 4 }, (_, y) => terrainFrameAt(x + 5, y + 9)),
    ).flat();
    expect(new Set(sample).size).toBeGreaterThan(2);
  });
});

describe("state-derived sprite frames", () => {
  it("maps Seed tasks to distinct readable frames", () => {
    const seed = createBotEntity("bot-seed", "seed", { x: 15, y: 15 });
    expect(seedFrameFor(seed, 0)).toBe(SEED_FRAMES.lowPower);
    seed.battery = 60;
    seed.task = { kind: "moving", label: "Moving", progress: 0, duration: 1 };
    expect([SEED_FRAMES.move0, SEED_FRAMES.move1]).toContain(seedFrameFor(seed, 140));
    seed.task = { kind: "mining", label: "Mining", progress: 0, duration: 1 };
    expect([SEED_FRAMES.mine0, SEED_FRAMES.mine1]).toContain(seedFrameFor(seed, 140));
    seed.task = { kind: "microSmelting", label: "Smelting", progress: 0, duration: 1 };
    expect([SEED_FRAMES.smelt0, SEED_FRAMES.smelt1]).toContain(seedFrameFor(seed, 140));
    seed.task = { kind: "building", label: "Building", progress: 0, duration: 1 };
    expect([SEED_FRAMES.build0, SEED_FRAMES.build1]).toContain(seedFrameFor(seed, 140));
  });

  it("shows external physical cargo", () => {
    expect(cargoFrameFor({})).toBeUndefined();
    expect(cargoFrameFor({ ironOre: 1 })).toBe(0);
    expect(cargoFrameFor({ copperOre: 1 })).toBe(1);
    expect(cargoFrameFor({ ironIngot: 1 })).toBe(2);
  });

  it("maps deposit depletion and storage construction/occupancy", () => {
    const deposit: DepositEntity = {
      id: "deposit-test",
      kind: "deposit",
      itemId: "ironOre",
      name: "Ferric Outcrop",
      position: { x: 10, y: 14 },
      remaining: 80,
    };
    expect(depositFrameFor(deposit)).toBe(0);
    deposit.remaining = 40;
    expect(depositFrameFor(deposit)).toBe(1);
    deposit.remaining = 12;
    expect(depositFrameFor(deposit)).toBe(2);

    expect(storageFrameFor(storage({ constructionProgress: 0.1 }))).toBe(0);
    expect(storageFrameFor(storage({ constructionProgress: 0.5 }))).toBe(1);
    expect(storageFrameFor(storage({ constructionProgress: 0.9 }))).toBe(2);
    expect(storageFrameFor(storage({ complete: true }))).toBe(3);
    expect(storageFrameFor(storage({ complete: true, input: { ironIngot: 3 } }))).toBe(4);
    expect(storageFrameFor(storage({ complete: true, input: { ironOre: 20 } }))).toBe(5);
  });
});
