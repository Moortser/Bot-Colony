import Phaser from "phaser";
import { BOT_FRAMES, BUILDINGS, ITEMS } from "../data/content";
import { runtime } from "../runtime";
import type { BotEntity, BuildingEntity, DepositEntity, GridPoint, SelectableEntity } from "../simulation/types";
import { gridToScreen, isoDepth, roundGrid, screenToGrid, TILE_HEIGHT, TILE_WIDTH } from "./iso";

const ORIGIN_X = 0;
const ORIGIN_Y = 120;

interface PointLike {
  x: number;
  y: number;
}

export class GameScene extends Phaser.Scene {
  private terrain!: Phaser.GameObjects.Graphics;
  private world!: Phaser.GameObjects.Graphics;
  private debugLayer!: Phaser.GameObjects.Graphics;
  private pointerStart?: PointLike;
  private cameraStart?: PointLike;
  private dragging = false;
  private lastPinchDistance = 0;
  private lastRenderAt = -1;
  private cameraMovedByPlayer = false;

  public constructor() {
    super("world");
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#11191a");
    this.cameras.main.setZoom(0.78);
    this.centerCameraOnSeed();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (!this.cameraMovedByPlayer) this.centerCameraOnSeed();
    });
    this.time.delayedCall(100, () => {
      if (!this.cameraMovedByPlayer) this.centerCameraOnSeed();
    });
    this.terrain = this.add.graphics();
    this.world = this.add.graphics();
    this.debugLayer = this.add.graphics();
    this.drawTerrain();
    this.configureInput();
    this.renderWorld();
  }

  public update(_time: number, deltaMs: number): void {
    runtime.simulation.advance(deltaMs / 1000);
    if (runtime.simulation.state.gameTime - this.lastRenderAt >= 0.05 || runtime.simulation.state.speed === 0) {
      this.lastRenderAt = runtime.simulation.state.gameTime;
      this.renderWorld();
      runtime.refreshUi();
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
          if (this.lastPinchDistance > 0) {
            this.cameraMovedByPlayer = true;
            const zoom = this.cameras.main.zoom * (pinchDistance / this.lastPinchDistance);
            this.cameras.main.setZoom(Phaser.Math.Clamp(zoom, 0.48, 1.5));
          }
          this.lastPinchDistance = pinchDistance;
        }
        return;
      }
      this.lastPinchDistance = 0;
      if (pointer.isDown && this.pointerStart && this.cameraStart) {
        const distance = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.pointerStart.x, this.pointerStart.y);
        if (distance > 7) this.dragging = true;
        if (this.dragging) {
          this.cameraMovedByPlayer = true;
          this.cameras.main.scrollX = this.cameraStart.x - (pointer.x - this.pointerStart.x) / this.cameras.main.zoom;
          this.cameras.main.scrollY = this.cameraStart.y - (pointer.y - this.pointerStart.y) / this.cameras.main.zoom;
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
        const multiplier = deltaY > 0 ? 0.9 : 1.1;
        this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * multiplier, 0.48, 1.5));
        this.clampCamera();
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

  private handleWorldClick(pointer: Phaser.Input.Pointer): void {
    const tile = this.pointerToTile(pointer);
    if (runtime.placementType) {
      const placedId = runtime.simulation.placeBuilding(runtime.placementType, tile.x, tile.y);
      if (placedId) {
        runtime.selectedId = placedId;
        runtime.placementType = undefined;
        runtime.placementTile = undefined;
      }
      runtime.refreshUi();
      return;
    }
    runtime.selectedId = this.entityAt(tile)?.id;
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

  private drawTerrain(): void {
    this.terrain.clear();
    const size = runtime.simulation.state.mapSize;
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        const point = this.iso({ x, y });
        const noise = (x * 17 + y * 31 + x * y * 3) % 13;
        const color = noise < 2 ? 0x293f38 : noise > 10 ? 0x1e3431 : 0x233a34;
        this.drawDiamond(this.terrain, point.x, point.y, TILE_WIDTH, TILE_HEIGHT, color, 0x355048, 1);
        if ((x + y * 3) % 17 === 0) {
          this.terrain.fillStyle(0x60705a, 0.35);
          this.terrain.fillCircle(point.x + 8, point.y + 2, 2);
        }
      }
    }
  }

  private renderWorld(): void {
    this.world.clear();
    this.debugLayer.clear();
    const simulation = runtime.simulation;
    const selected = simulation.getEntity(runtime.selectedId);

    const entities: SelectableEntity[] = [
      ...Object.values(simulation.state.deposits),
      ...Object.values(simulation.state.buildings),
      ...Object.values(simulation.state.bots),
    ].sort((a, b) => isoDepth(a.position) - isoDepth(b.position));

    for (const entity of entities) {
      if (entity.kind === "deposit") this.drawDeposit(entity, selected?.id === entity.id);
      if (entity.kind === "building") this.drawBuilding(entity, selected?.id === entity.id);
      if (entity.kind === "bot") this.drawBot(entity, selected?.id === entity.id);
    }

    this.drawPlacement();
    if (simulation.state.debug) this.drawDebug(entities, selected);
  }

  private drawDeposit(deposit: DepositEntity, selected: boolean): void {
    const point = this.iso(deposit.position);
    const baseColor = deposit.itemId === "ironOre" ? ITEMS.ironOre.color : ITEMS.copperOre.color;
    this.world.fillStyle(0x121c1b, 0.7);
    this.world.fillEllipse(point.x, point.y + 8, 58, 20);
    const chunks = [
      { x: -18, y: -3, size: 17 },
      { x: 1, y: -11, size: 22 },
      { x: 20, y: 0, size: 14 },
      { x: -2, y: 5, size: 16 },
    ];
    for (const chunk of chunks) {
      this.world.fillStyle(baseColor, 1);
      this.world.lineStyle(2, 0x18201f, 1);
      this.world.fillTriangle(
        point.x + chunk.x - chunk.size,
        point.y + chunk.y + 8,
        point.x + chunk.x,
        point.y + chunk.y - chunk.size,
        point.x + chunk.x + chunk.size,
        point.y + chunk.y + 8,
      );
      this.world.strokeTriangle(
        point.x + chunk.x - chunk.size,
        point.y + chunk.y + 8,
        point.x + chunk.x,
        point.y + chunk.y - chunk.size,
        point.x + chunk.x + chunk.size,
        point.y + chunk.y + 8,
      );
    }
    if (selected) this.drawSelectionDiamond(deposit.position, 1, 1);
  }

  private drawBuilding(building: BuildingEntity, selected: boolean): void {
    const definition = BUILDINGS[building.type];
    const center = this.footprintCenter(building);
    const width = (definition.footprint.width + definition.footprint.height) * (TILE_WIDTH / 2);
    const height = (definition.footprint.width + definition.footprint.height) * (TILE_HEIGHT / 2);
    this.drawDiamond(this.world, center.x, center.y + 6, width, height, 0x252d2d, 0x101717, 2);

    if (!building.complete) {
      this.world.lineStyle(3, 0xe4b85e, 0.85);
      this.world.strokeRect(center.x - 28, center.y - 48, 56, 48);
      this.world.lineBetween(center.x - 28, center.y, center.x + 28, center.y - 48);
      this.world.lineBetween(center.x + 28, center.y, center.x - 28, center.y - 48);
      this.world.fillStyle(0xe4b85e, 0.8);
      this.world.fillRect(center.x - 24, center.y - 38, 48 * building.constructionProgress, 5);
    } else {
      const bodyWidth = Math.max(58, width * 0.52);
      const bodyHeight = building.type === "furnace" ? 44 : 34;
      this.drawIsoBlock(center.x, center.y - 8, bodyWidth, Math.max(34, height * 0.5), bodyHeight, definition.color);
      this.drawBuildingDetails(building, center);
    }
    if (selected) this.drawSelectionDiamond(building.position, building.footprint.width, building.footprint.height);
  }

  private drawBuildingDetails(building: BuildingEntity, center: PointLike): void {
    if (building.type === "storage") {
      this.world.fillStyle(0xbaa662, 1);
      for (let index = 0; index < 4; index += 1) {
        this.world.fillRect(center.x - 34 + index * 18, center.y - 22 - (index % 2) * 5, 14, 9);
      }
      this.world.lineStyle(3, 0xe0b447, 1);
      this.world.lineBetween(center.x - 45, center.y + 4, center.x + 45, center.y - 18);
    }
    if (building.type === "researchBench") {
      this.world.fillStyle(0x69c6c2, 1);
      this.world.fillRect(center.x - 25, center.y - 45, 50, 8);
      this.world.fillStyle(0xd8edcb, 1);
      this.world.fillCircle(center.x + 18, center.y - 48, 4);
    }
    if (building.type === "furnace") {
      this.world.fillStyle(0x303637, 1);
      this.world.fillRect(center.x + 20, center.y - 70, 16, 40);
      this.world.fillStyle(building.blockingReason === "" ? 0xf09a43 : 0x6a3f34, 1);
      this.world.fillCircle(center.x - 16, center.y - 18, 10);
      if (building.blockingReason === "") {
        this.world.fillStyle(0xf4d05c, 0.9);
        this.world.fillTriangle(center.x + 23, center.y - 71, center.x + 28, center.y - 84, center.x + 34, center.y - 71);
      }
    }
    if (building.type === "botCradle") {
      this.world.lineStyle(7, 0xbbb78d, 1);
      this.world.lineBetween(center.x - 42, center.y - 20, center.x - 24, center.y - 60);
      this.world.lineBetween(center.x + 42, center.y - 40, center.x + 24, center.y - 66);
      this.world.fillStyle(0x62c3c2, 1);
      this.world.fillCircle(center.x, center.y - 44, 6);
    }
  }

  private drawBot(bot: BotEntity, selected: boolean): void {
    const point = this.iso(bot.position);
    const color = BOT_FRAMES[bot.frame].color;
    this.world.fillStyle(0x101615, 0.6);
    this.world.fillEllipse(point.x, point.y + 7, 34, 13);
    this.world.lineStyle(4, 0x2b3332, 1);
    this.world.lineBetween(point.x - 11, point.y - 2, point.x - 15, point.y + 12);
    this.world.lineBetween(point.x + 11, point.y - 2, point.x + 15, point.y + 12);
    this.drawIsoBlock(point.x, point.y - 9, bot.frame === "seed" ? 34 : 27, 20, bot.frame === "seed" ? 25 : 19, color);
    this.world.fillStyle(bot.battery > 20 ? 0x9bd35f : 0xee6755, 1);
    this.world.fillRect(point.x - 3, point.y - 29, 7, 5);
    if (bot.solarDeployed) {
      this.world.lineStyle(3, 0x4b5856, 1);
      this.world.lineBetween(point.x, point.y - 20, point.x + 43, point.y - 40);
      this.world.fillStyle(0x426c7b, 1);
      this.world.lineStyle(2, 0x9dc0b9, 1);
      this.world.fillRect(point.x + 19, point.y - 52, 48, 25);
      this.world.strokeRect(point.x + 19, point.y - 52, 48, 25);
      this.world.lineBetween(point.x + 43, point.y - 52, point.x + 43, point.y - 27);
    }
    if (selected) this.drawSelectionDiamond(bot.position, 1, 1);
  }

  private drawPlacement(): void {
    if (!runtime.placementType || !runtime.placementTile) return;
    const definition = BUILDINGS[runtime.placementType];
    const color = runtime.placementValid ? 0x77d6a0 : 0xee6a5b;
    for (let x = 0; x < definition.footprint.width; x += 1) {
      for (let y = 0; y < definition.footprint.height; y += 1) {
        const point = this.iso({ x: runtime.placementTile.x + x, y: runtime.placementTile.y + y });
        this.drawDiamond(this.world, point.x, point.y, TILE_WIDTH, TILE_HEIGHT, color, color, 2, 0.35);
      }
    }
  }

  private drawDebug(entities: SelectableEntity[], selected?: SelectableEntity): void {
    this.debugLayer.lineStyle(1, 0x76d7d0, 0.45);
    for (let x = 0; x < runtime.simulation.state.mapSize; x += 4) {
      for (let y = 0; y < runtime.simulation.state.mapSize; y += 4) {
        const point = this.iso({ x, y });
        this.debugLayer.fillStyle(0xd9f1df, 0.75);
        this.debugLayer.fillCircle(point.x, point.y, 1.5);
      }
    }
    for (const entity of entities) {
      const point = this.iso(entity.position);
      this.debugLayer.fillStyle(0x071010, 0.8);
      this.debugLayer.fillRect(point.x - 30, point.y - 64, 60, 12);
      this.debugLayer.fillStyle(0xffffff, 1);
      for (let index = 0; index < Math.min(entity.id.length, 12); index += 1) {
        const code = entity.id.charCodeAt(index);
        if (code % 2 === 0) this.debugLayer.fillRect(point.x - 27 + index * 4, point.y - 61, 2, 6);
      }
      if (entity.kind === "bot" && entity.task.destination) {
        const destination = this.iso(entity.task.destination);
        this.debugLayer.lineStyle(2, 0x60e0d5, 0.9);
        this.debugLayer.lineBetween(point.x, point.y, destination.x, destination.y);
      }
      if (entity.kind === "building") {
        const points = [
          interactionPointForView(entity, "input"),
          interactionPointForView(entity, "output"),
          interactionPointForView(entity, "operator"),
          interactionPointForView(entity, "construction"),
        ];
        for (const interaction of points) {
          const screen = this.iso(interaction);
          this.debugLayer.fillStyle(0xf3c557, 1);
          this.debugLayer.fillCircle(screen.x, screen.y, 4);
        }
      }
    }
    if (selected) {
      const point = this.iso(selected.position);
      this.debugLayer.lineStyle(1, 0xffffff, 0.9);
      this.debugLayer.lineBetween(point.x - 50, point.y, point.x + 50, point.y);
      this.debugLayer.lineBetween(point.x, point.y - 50, point.x, point.y + 30);
    }
  }

  private footprintCenter(building: BuildingEntity): PointLike {
    const first = this.iso(building.position);
    const last = this.iso({
      x: building.position.x + building.footprint.width - 1,
      y: building.position.y + building.footprint.height - 1,
    });
    return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  }

  private drawSelectionDiamond(position: GridPoint, width: number, height: number): void {
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const point = this.iso({ x: position.x + x, y: position.y + y });
        this.drawDiamond(this.world, point.x, point.y, TILE_WIDTH - 5, TILE_HEIGHT - 4, 0x000000, 0xf3cf63, 3, 0);
      }
    }
  }

  private drawIsoBlock(x: number, y: number, width: number, depth: number, height: number, color: number): void {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const topY = y - height;
    this.world.fillStyle(color, 1);
    this.world.lineStyle(2, 0x151c1c, 1);
    this.world.beginPath();
    this.world.moveTo(x, topY - halfDepth);
    this.world.lineTo(x + halfWidth, topY);
    this.world.lineTo(x, topY + halfDepth);
    this.world.lineTo(x - halfWidth, topY);
    this.world.closePath();
    this.world.fillPath();
    this.world.strokePath();
    this.world.fillStyle(Phaser.Display.Color.ValueToColor(color).darken(28).color, 1);
    this.world.beginPath();
    this.world.moveTo(x - halfWidth, topY);
    this.world.lineTo(x, topY + halfDepth);
    this.world.lineTo(x, y + halfDepth);
    this.world.lineTo(x - halfWidth, y);
    this.world.closePath();
    this.world.fillPath();
    this.world.strokePath();
    this.world.fillStyle(Phaser.Display.Color.ValueToColor(color).darken(14).color, 1);
    this.world.beginPath();
    this.world.moveTo(x + halfWidth, topY);
    this.world.lineTo(x, topY + halfDepth);
    this.world.lineTo(x, y + halfDepth);
    this.world.lineTo(x + halfWidth, y);
    this.world.closePath();
    this.world.fillPath();
    this.world.strokePath();
  }

  private drawDiamond(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: number,
    stroke: number,
    strokeWidth: number,
    alpha = 1,
  ): void {
    graphics.fillStyle(fill, alpha);
    graphics.lineStyle(strokeWidth, stroke, Math.min(1, alpha + 0.25));
    graphics.beginPath();
    graphics.moveTo(x, y - height / 2);
    graphics.lineTo(x + width / 2, y);
    graphics.lineTo(x, y + height / 2);
    graphics.lineTo(x - width / 2, y);
    graphics.closePath();
    if (alpha > 0) graphics.fillPath();
    graphics.strokePath();
  }

  private iso(point: GridPoint): PointLike {
    const screen = gridToScreen(point);
    return { x: screen.x + ORIGIN_X, y: screen.y + ORIGIN_Y };
  }

  private clampCamera(): void {
    this.cameras.main.scrollX = Phaser.Math.Clamp(this.cameras.main.scrollX, -1800, 1800);
    this.cameras.main.scrollY = Phaser.Math.Clamp(this.cameras.main.scrollY, -200, 1900);
  }

  private centerCameraOnSeed(): void {
    const seedScreen = this.iso(runtime.simulation.seed.position);
    this.cameras.main.centerOn(seedScreen.x, seedScreen.y);
  }
}

function interactionPointForView(
  building: BuildingEntity,
  mode: "input" | "output" | "operator" | "construction",
): GridPoint {
  if (mode === "input") return { x: building.position.x - 1, y: building.position.y + building.footprint.height - 1 };
  if (mode === "output") return { x: building.position.x + building.footprint.width, y: building.position.y };
  if (mode === "operator") return { x: building.position.x + building.footprint.width, y: building.position.y + 1 };
  return { x: building.position.x - 1, y: building.position.y };
}
