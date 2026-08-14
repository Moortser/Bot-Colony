import type { GridPoint } from "../simulation/types";

export const TILE_WIDTH = 96;
export const TILE_HEIGHT = 48;

export interface ScreenPoint {
  x: number;
  y: number;
}

export function gridToScreen(point: GridPoint): ScreenPoint {
  const elevation = point.elevation ?? 0;
  return {
    x: (point.x - point.y) * (TILE_WIDTH / 2),
    y: (point.x + point.y) * (TILE_HEIGHT / 2) - elevation * (TILE_HEIGHT / 2),
  };
}

export function screenToGrid(point: ScreenPoint, elevation = 0): GridPoint {
  const adjustedY = point.y + elevation * (TILE_HEIGHT / 2);
  return {
    x: point.x / TILE_WIDTH + adjustedY / TILE_HEIGHT,
    y: adjustedY / TILE_HEIGHT - point.x / TILE_WIDTH,
    elevation,
  };
}

export function roundGrid(point: GridPoint): GridPoint {
  return { x: Math.round(point.x), y: Math.round(point.y), elevation: point.elevation ?? 0 };
}

export function isoDepth(point: GridPoint, offset = 0): number {
  return (point.x + point.y) * 100 + (point.elevation ?? 0) * 10 + offset;
}
