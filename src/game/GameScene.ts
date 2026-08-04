import Phaser from "phaser";
import { BUILDINGS } from "../data/content";
import { runtime } from "../runtime";
import { blockedTileKeys, interactionCandidates } from "../simulation/pathfinding/grid";
import type { BotEntity, BuildingEntity, GridPoint, SelectableEntity } from "../simulation/types";
import {
  cargoFrameFor,
  decalFrameAt,
  depositFrameFor,
  OVERLAY_FRAMES,
  seedFrameFor,
  SEED_FRAMES,
  SHEETS,
  SPRITE_ORIGINS,
  storageFrameFor,
  supportBuildingFrameFor,
  terrainFrameAt,
  TEXTURE_KEYS,
  ZOOM_STEPS,
} from "./assets/manifest";
import { gridToScreen, isoDepth, roundGrid, screenToGrid, TILE_HEIGHT } from "./iso";

const ORIGIN_X = 0;
const ORIGIN_Y = 96;
const PINCH_STEP_THRESHOLD = 34;

interface PointLike {
  x: number;
  y: number;
}

interface EntityView {
  main: Phaser.GameObjects.Sprite;
  cargo: Phaser.GameObjects.Sprite;
  effect: Phaser.GameObjects.Sprite;
}

interface SolarTransition {
  deployed: boolean;
  startedAt: number;
}

export class GameScene extends Phaser.Scene {
  private debugLayer!: Phaser.GameObjects.Graphics;
  private entityViews = new Map<string, EntityView>();
  private selectionSprites: Phaser.GameObjects.Sprite[] = [];
  private placementSprites: Phaser.GameObjects.Sprite[] = [];
  private pointerStart?: PointLike;
  private cameraStart?: PointLike;
  private dragging = false;
  private lastPinchDistance = 0;
  private lastRenderAt = -1;
  private cameraMovedByPlayer = false;
  private solarState = new Map<string, boolean>();
  private solarTransitions = new Map<string, SolarTransition>();

  public constructor() {
    super("world");
  }

  public preload(): void {
    for (const sheet of SHEETS) {
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
        endFrame: sheet.frames - 1,
      });
    }
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#493426");
    this.cameras.main.setZoom(1);
    this.cameras.main.roundPixels = true;
    for (const sheet of SHEETS) this.textures.get(sheet.key).setFilter(Phaser.Textures.FilterMode.NEAREST);

    this.createTerrain();
    this.debugLayer = this.add.graphics().setDepth(100_000);
    this.configureInput();
    this.centerCameraOnSeed();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (!this.cameraMovedByPlayer) this.centerCameraOnSeed();
    });
    this.time.delayedCall(100, () => {
      if (!this.cameraMovedByPlayer) this.centerCameraOnSeed();
    });
    this.renderWorld();
  }

  public update(time: number, deltaMs: number): void {
    runtime.simulation.advance(deltaMs / 1000);
    if (runtime.simulation.state.gameTime - this.lastRenderAt >= 0.05 || runtime.simulation.state.speed === 0) {
      this.lastRenderAt = runtime.simulation.state.gameTime;
      this.renderWorld(time);
      runtime.refreshUi();
    }
  }

  private createTerrain(): void {
    const size = runtime.simulation.state.mapSize;
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        const point = this.iso({ x, y });
        this.add
          .sprite(Math.round(point.x), Math.round(point.y), TEXTURE_KEYS.terrain, terrainFrameAt(x, y))
          .setOrigin(SPRITE_ORIGINS.terrain.x, SPRITE_ORIGINS.terrain.y)
          .setDepth(-20_000 + x + y);
        const decalFrame = decalFrameAt(x, y);
        if (decalFrame !== undefined) {
          this.add
            .sprite(Math.round(point.x), Math.round(point.y), TEXTURE_KEYS.decals, decalFrame)
            .setOrigin(SPRITE_ORIGINS.terrain.x, SPRITE_ORIGINS.terrain.y)
            .setDepth(-19_000 + x + y);
        }
      }
    }
  }

  private configureInput(): void {
    this.input.addPointer(2);
    this.input.mouse?.disableContextMenu();

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        runtime.placementType = undefined;
        runtime.placementTile = undefined;
        runtime.refreshUi();
        return;
      }
      this.pointerStart = { x: pointer.x, y: pointer.y };
      this.cameraStart = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY };
      this.dragging = false;
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const activePointers = this.input.manager.pointers.filter((candidate) => candidate.isDown);
      if (activePointers.length >= 2) {
        const first = activePointers[0];
        const second = activePointers[1];
        if (first && second) {
          const pinchDistance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
          if (this.lastPinchDistance > 0 && Math.abs(pinchDistance - this.lastPinchDistance) >= PINCH_STEP_THRESHOLD) {
            this.cameraMovedByPlayer = true;
            this.stepZoom(pinchDistance > this.lastPinchDistance ? 1 : -1);
            this.lastPinchDistance = pinchDistance;
          } else if (this.lastPinchDistance === 0) {
            this.lastPinchDistance = pinchDistance;
          }
        }
        return;
      }
      this.lastPinchDistance = 0;
      if (pointer.isDown && this.pointerStart && this.cameraStart) {
        const distance = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.pointerStart.x, this.pointerStart.y);
        if (distance > 7) this.dragging = true;
        if (this.dragging) {
          this.cameraMovedByPlayer = true;
          this.cameras.main.scrollX = Math.round(
            this.cameraStart.x - (pointer.x - this.pointerStart.x) / this.cameras.main.zoom,
          );
          this.cameras.main.scrollY = Math.round(
            this.cameraStart.y - (pointer.y - this.pointerStart.y) / this.cameras.main.zoom,
          );
          this.clampCamera();
        }
      } else {
        const hoverTile = this.pointerToTile(pointer);
        runtime.hoverTile = { x: hoverTile.x, y: hoverTile.y };
        this.updatePlacement(pointer);
      }
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      this.lastPinchDistance = 0;
      if (!this.dragging && !pointer.rightButtonReleased()) this.handleWorldClick(pointer);
      this.pointerStart = undefined;
      this.cameraStart = undefined;
      this.dragging = false;
    });

    this.input.on(
      "wheel",
      (
        _pointer: Phaser.Input.Pointer,
        _gameObjects: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => {
        this.cameraMovedByPlayer = true;
        this.stepZoom(deltaY > 0 ? -1 : 1);
      },
    );

    this.input.keyboard?.on("keydown-SPACE", () => runtime.simulation.togglePause());
    this.input.keyboard?.on("keydown-ONE", () => runtime.simulation.setSpeed(1));
    this.input.keyboard?.on("keydown-TWO", () => runtime.simulation.setSpeed(2));
    this.input.keyboard?.on("keydown-THREE", () => runtime.simulation.setSpeed(4));
    this.input.keyboard?.on("keydown-D", () => runtime.simulation.toggleDebug());
    this.input.keyboard?.on("keydown-ESC", () => {
      runtime.placementType = undefined;
      runtime.placementTile = undefined;
      runtime.refreshUi();
    });
  }

  private stepZoom(direction: -1 | 1): void {
    const currentIndex = ZOOM_STEPS.findIndex((zoom) => zoom === this.cameras.main.zoom);
    const safeIndex = currentIndex < 0 ? ZOOM_STEPS.indexOf(1) : currentIndex;
    const nextIndex = Phaser.Math.Clamp(safeIndex + direction, 0, ZOOM_STEPS.length - 1);
    this.cameras.main.setZoom(ZOOM_STEPS[nextIndex] ?? 1);
    this.cameras.main.scrollX = Math.round(this.cameras.main.scrollX);
    this.cameras.main.scrollY = Math.round(this.cameras.main.scrollY);
    this.clampCamera();
  }

  private handleWorldClick(pointer: Phaser.Input.Pointer): void {
    const tile = this.pointerToTile(pointer);
    if (runtime.placementType) {
      const placedId = runtime.simulation.placeBuilding(runtime.placementType, tile.x, tile.y);
      if (placedId) {
        runtime.selectedId = placedId;
        runtime.selectionVersion += 1;
        runtime.placementType = undefined;
        runtime.placementTile = undefined;
      }
      runtime.refreshUi();
      return;
    }
    runtime.selectedId = this.entityAt(tile)?.id;
    runtime.selectionVersion += 1;
    runtime.refreshUi();
  }

  private updatePlacement(pointer: Phaser.Input.Pointer): void {
    if (!runtime.placementType) return;
    const tile = this.pointerToTile(pointer);
    runtime.placementTile = tile;
    const result = runtime.simulation.canPlaceBuilding(runtime.placementType, tile.x, tile.y);
    runtime.placementValid = result.valid;
    runtime.placementReason = result.reason;
  }

  private pointerToTile(pointer: Phaser.Input.Pointer): GridPoint {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return roundGrid(screenToGrid({ x: worldPoint.x - ORIGIN_X, y: worldPoint.y - ORIGIN_Y }));
  }

  private entityAt(tile: GridPoint): SelectableEntity | undefined {
    const bots = Object.values(runtime.simulation.state.bots)
      .filter((bot) => Math.abs(bot.position.x - tile.x) < 0.8 && Math.abs(bot.position.y - tile.y) < 0.8)
      .sort((a, b) => isoDepth(b.position) - isoDepth(a.position));
    if (bots[0]) return bots[0];
    const buildings = Object.values(runtime.simulation.state.buildings).filter(
      (building) =>
        tile.x >= building.position.x &&
        tile.x < building.position.x + building.footprint.width &&
        tile.y >= building.position.y &&
        tile.y < building.position.y + building.footprint.height,
    );
    if (buildings[0]) return buildings[0];
    return Object.values(runtime.simulation.state.deposits).find(
      (deposit) => Math.round(deposit.position.x) === tile.x && Math.round(deposit.position.y) === tile.y,
    );
  }

  private renderWorld(viewTimeMs = this.time.now): void {
    this.debugLayer.clear();
    const simulation = runtime.simulation;
    const selected = simulation.getEntity(runtime.selectedId);
    const entities: SelectableEntity[] = [
      ...Object.values(simulation.state.deposits),
      ...Object.values(simulation.state.buildings),
      ...Object.values(simulation.state.bots),
    ].sort((a, b) => this.entityDepth(a) - this.entityDepth(b));
    const activeIds = new Set(entities.map((entity) => entity.id));

    for (const [id, view] of this.entityViews) {
      if (!activeIds.has(id)) {
        view.main.destroy();
        view.cargo.destroy();
        view.effect.destroy();
        this.entityViews.delete(id);
      }
    }
    for (const entity of entities) this.renderEntity(entity, viewTimeMs);

    this.renderSelection(selected);
    this.renderPlacement();
    if (simulation.state.debug) this.drawDebug(entities, selected);
  }

  private renderEntity(entity: SelectableEntity, viewTimeMs: number): void {
    const view = this.ensureEntityView(entity);
    const depth = this.entityDepth(entity);
    if (entity.kind === "bot") this.renderBot(entity, view, depth, viewTimeMs);
    if (entity.kind === "deposit") {
      const point = this.iso(entity.position);
      view.main
        .setTexture(TEXTURE_KEYS.deposits, depositFrameFor(entity))
        .setPosition(Math.round(point.x), Math.round(point.y))
        .setOrigin(SPRITE_ORIGINS.deposit.x, SPRITE_ORIGINS.deposit.y)
        .setDepth(depth)
        .setVisible(true);
      view.cargo.setVisible(false);
      view.effect.setVisible(false);
    }
    if (entity.kind === "building") this.renderBuilding(entity, view, depth);
  }

  private ensureEntityView(entity: SelectableEntity): EntityView {
    const existing = this.entityViews.get(entity.id);
    if (existing) return existing;
    const main = this.add.sprite(0, 0, TEXTURE_KEYS.seed, 0);
    const cargo = this.add
      .sprite(0, 0, TEXTURE_KEYS.cargo, 0)
      .setOrigin(SPRITE_ORIGINS.cargo.x, SPRITE_ORIGINS.cargo.y)
      .setVisible(false);
    const effect = this.add
      .sprite(0, 0, TEXTURE_KEYS.activityFx, 0)
      .setOrigin(SPRITE_ORIGINS.activityFx.x, SPRITE_ORIGINS.activityFx.y)
      .setVisible(false);
    const view = { main, cargo, effect };
    this.entityViews.set(entity.id, view);
    return view;
  }

  private renderBot(bot: BotEntity, view: EntityView, depth: number, viewTimeMs: number): void {
    const point = this.iso(bot.position);
    const previousSolar = this.solarState.get(bot.id);
    if (previousSolar !== undefined && previousSolar !== bot.solarDeployed) {
      this.solarTransitions.set(bot.id, { deployed: bot.solarDeployed, startedAt: viewTimeMs });
    }
    this.solarState.set(bot.id, bot.solarDeployed);

    let frame = seedFrameFor(bot, viewTimeMs);
    const transition = this.solarTransitions.get(bot.id);
    if (transition) {
      const phase = Math.min(3, Math.floor((viewTimeMs - transition.startedAt) / 120));
      frame = transition.deployed ? SEED_FRAMES.deploy0 + phase : SEED_FRAMES.deploy2 - phase;
      if (viewTimeMs - transition.startedAt >= 480) this.solarTransitions.delete(bot.id);
    }

    view.main
      .setTexture(TEXTURE_KEYS.seed, frame)
      .setPosition(Math.round(point.x), Math.round(point.y))
      .setOrigin(SPRITE_ORIGINS.bot.x, SPRITE_ORIGINS.bot.y)
      .setDepth(depth)
      .setVisible(true);

    const cargoFrame = cargoFrameFor(bot.inventory);
    view.cargo
      .setFrame(cargoFrame ?? 0)
      .setPosition(Math.round(point.x + 24), Math.round(point.y - 24))
      .setDepth(depth + 2)
      .setVisible(cargoFrame !== undefined);

    const effectFrame =
      bot.task.kind === "mining"
        ? Math.floor(viewTimeMs / 90) % 3
        : bot.task.kind === "microSmelting"
          ? 3 + (Math.floor(viewTimeMs / 140) % 2)
          : bot.task.kind === "building"
            ? 5
            : undefined;
    view.effect
      .setFrame(effectFrame ?? 0)
      .setPosition(
        Math.round(point.x + (bot.task.kind === "mining" ? -28 : bot.task.kind === "building" ? 30 : 0)),
        Math.round(point.y - (bot.task.kind === "microSmelting" ? 36 : 18)),
      )
      .setDepth(depth + 3)
      .setVisible(effectFrame !== undefined);
  }

  private renderBuilding(building: BuildingEntity, view: EntityView, depth: number): void {
    const point = this.buildingGround(building);
    let texture: string = TEXTURE_KEYS.storage;
    let frame = storageFrameFor(building);
    if (building.type !== "storage" && building.complete) {
      texture = TEXTURE_KEYS.supportBuildings;
      frame = supportBuildingFrameFor(building);
    }
    view.main
      .setTexture(texture, frame)
      .setPosition(Math.round(point.x), Math.round(point.y))
      .setOrigin(SPRITE_ORIGINS.building.x, SPRITE_ORIGINS.building.y)
      .setDepth(depth)
      .setVisible(true);
    view.cargo.setVisible(false);
    view.effect.setVisible(false);
  }

  private renderSelection(selected?: SelectableEntity): void {
    for (const sprite of this.selectionSprites) sprite.destroy();
    this.selectionSprites = [];
    if (!selected) return;
    const width = selected.kind === "building" ? selected.footprint.width : 1;
    const height = selected.kind === "building" ? selected.footprint.height : 1;
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const tile = { x: selected.position.x + x, y: selected.position.y + y };
        const point = this.iso(tile);
        this.selectionSprites.push(
          this.add
            .sprite(Math.round(point.x), Math.round(point.y), TEXTURE_KEYS.overlays, OVERLAY_FRAMES.selected)
            .setOrigin(SPRITE_ORIGINS.terrain.x, SPRITE_ORIGINS.terrain.y)
            .setDepth(isoDepth(tile) - 4),
        );
      }
    }
    if (selected.kind === "bot") this.drawSelectedBotPath(selected);
  }

  private drawSelectedBotPath(bot: BotEntity): void {
    if (bot.path.tiles.length === 0) return;
    const remaining = [bot.position, ...bot.path.tiles.slice(bot.path.currentIndex)];
    this.debugLayer.lineStyle(3, 0x67c5bd, 1);
    for (let index = 0; index < remaining.length - 1; index += 1) {
      const from = this.iso(remaining[index]!);
      const to = this.iso(remaining[index + 1]!);
      this.debugLayer.lineBetween(Math.round(from.x), Math.round(from.y), Math.round(to.x), Math.round(to.y));
    }
    this.debugLayer.fillStyle(0xb7eee2, 1);
    for (const tile of bot.path.tiles.slice(bot.path.currentIndex)) {
      const node = this.iso(tile);
      this.debugLayer.fillRect(Math.round(node.x - 2), Math.round(node.y - 2), 4, 4);
    }
    const destination = bot.path.interactionDestination ? this.iso(bot.path.interactionDestination) : undefined;
    if (destination) {
      this.debugLayer.lineStyle(2, 0xf3c557, 1);
      this.debugLayer.strokeRect(Math.round(destination.x - 6), Math.round(destination.y - 4), 12, 8);
      this.debugLayer.lineBetween(destination.x - 8, destination.y, destination.x + 8, destination.y);
      this.debugLayer.lineBetween(destination.x, destination.y - 7, destination.x, destination.y + 7);
    }
    const target = bot.path.targetId ? runtime.simulation.getEntity(bot.path.targetId) : undefined;
    if (target) {
      const point = this.iso(target.position);
      this.debugLayer.lineStyle(1, 0xef9b88, 0.8);
      this.debugLayer.strokeRect(Math.round(point.x - 8), Math.round(point.y - 8), 16, 12);
    }
  }

  private renderPlacement(): void {
    for (const sprite of this.placementSprites) sprite.destroy();
    this.placementSprites = [];
    if (!runtime.placementType || !runtime.placementTile) return;
    const definition = BUILDINGS[runtime.placementType];
    const frame = runtime.placementValid ? OVERLAY_FRAMES.valid : OVERLAY_FRAMES.invalid;
    for (let x = 0; x < definition.footprint.width; x += 1) {
      for (let y = 0; y < definition.footprint.height; y += 1) {
        const tile = { x: runtime.placementTile.x + x, y: runtime.placementTile.y + y };
        const point = this.iso(tile);
        this.placementSprites.push(
          this.add
            .sprite(Math.round(point.x), Math.round(point.y), TEXTURE_KEYS.overlays, frame)
            .setOrigin(SPRITE_ORIGINS.terrain.x, SPRITE_ORIGINS.terrain.y)
            .setDepth(isoDepth(tile) + 50),
        );
      }
    }
  }

  private drawDebug(entities: SelectableEntity[], selected?: SelectableEntity): void {
    const state = runtime.simulation.state;
    const blocked = blockedTileKeys(state);
    for (let x = 0; x < state.mapSize; x += 1) {
      for (let y = 0; y < state.mapSize; y += 1) {
        const point = this.iso({ x, y });
        const isBlocked = blocked.has(`${x},${y}`);
        this.debugLayer.fillStyle(isBlocked ? 0xc75b50 : 0x6d966f, isBlocked ? 0.65 : 0.2);
        this.debugLayer.fillRect(Math.round(point.x), Math.round(point.y), 2, 2);
      }
    }
    this.debugLayer.lineStyle(1, 0xf0d47b, 0.5);
    for (const entity of entities) {
      const point = this.iso(entity.position);
      this.debugLayer.strokeRect(Math.round(point.x - 2), Math.round(point.y - 2), 4, 4);
      if (entity.kind === "bot" && entity.task.destination) {
        const destination = this.iso(entity.task.destination);
        this.debugLayer.lineBetween(
          Math.round(point.x),
          Math.round(point.y),
          Math.round(destination.x),
          Math.round(destination.y),
        );
      }
      if (entity.kind === "building") {
        for (const interaction of ["input", "output", "operator", "construction"] as const) {
          const target = this.iso(interactionPointForView(entity, interaction));
          this.debugLayer.fillStyle(0xf3c557, 1);
          this.debugLayer.fillRect(Math.round(target.x - 2), Math.round(target.y - 2), 4, 4);
        }
      }
      if (entity.kind === "deposit") {
        for (const interaction of interactionCandidates(entity, "deposit")) {
          const target = this.iso(interaction);
          this.debugLayer.fillStyle(0x67c5bd, 0.9);
          this.debugLayer.fillRect(Math.round(target.x - 2), Math.round(target.y - 2), 4, 4);
        }
      }
      if (entity.kind === "bot" && entity.path.tiles[entity.path.currentIndex]) {
        const node = this.iso(entity.path.tiles[entity.path.currentIndex]!);
        this.debugLayer.fillStyle(0xffffff, 1);
        this.debugLayer.fillRect(Math.round(node.x - 3), Math.round(node.y - 3), 6, 6);
      }
    }
    if (selected) {
      const point = this.iso(selected.position);
      this.debugLayer.lineBetween(point.x - 40, point.y, point.x + 40, point.y);
      this.debugLayer.lineBetween(point.x, point.y - 36, point.x, point.y + 28);
    }
  }

  private entityDepth(entity: SelectableEntity): number {
    if (entity.kind !== "building") return isoDepth(entity.position);
    return isoDepth({
      x: entity.position.x + entity.footprint.width - 1,
      y: entity.position.y + entity.footprint.height - 1,
    });
  }

  private buildingGround(building: BuildingEntity): PointLike {
    const first = this.iso(building.position);
    const last = this.iso({
      x: building.position.x + building.footprint.width - 1,
      y: building.position.y + building.footprint.height - 1,
    });
    const center = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    return {
      x: center.x,
      y: center.y + ((building.footprint.width + building.footprint.height) * TILE_HEIGHT) / 4,
    };
  }

  private iso(point: GridPoint): PointLike {
    const screen = gridToScreen(point);
    return { x: screen.x + ORIGIN_X, y: screen.y + ORIGIN_Y };
  }

  private clampCamera(): void {
    this.cameras.main.scrollX = Math.round(Phaser.Math.Clamp(this.cameras.main.scrollX, -1800, 1800));
    this.cameras.main.scrollY = Math.round(Phaser.Math.Clamp(this.cameras.main.scrollY, -200, 1900));
  }

  private centerCameraOnSeed(): void {
    const seedScreen = this.iso(runtime.simulation.seed.position);
    this.cameras.main.centerOn(Math.round(seedScreen.x), Math.round(seedScreen.y - 38));
    this.cameras.main.scrollX = Math.round(this.cameras.main.scrollX);
    this.cameras.main.scrollY = Math.round(this.cameras.main.scrollY);
  }
}

function interactionPointForView(
  building: BuildingEntity,
  mode: "input" | "output" | "operator" | "construction",
): GridPoint {
  if (mode === "input") {
    return { x: building.position.x - 1, y: building.position.y + building.footprint.height - 1 };
  }
  if (mode === "output") {
    return { x: building.position.x + building.footprint.width, y: building.position.y };
  }
  if (mode === "operator") {
    return { x: building.position.x + building.footprint.width, y: building.position.y + 1 };
  }
  return { x: building.position.x - 1, y: building.position.y };
}
