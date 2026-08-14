import { describe, expect, it } from "vitest";
import { gridToScreen, roundGrid, screenToGrid } from "../game/iso";

describe("isometric projection", () => {
  it("round-trips logical grid positions", () => {
    const points = [
      { x: 0, y: 0, elevation: 0 },
      { x: 12, y: 7, elevation: 0 },
      { x: 31, y: 31, elevation: 0 },
      { x: 3.25, y: 19.75, elevation: 0 },
    ];
    for (const point of points) {
      const restored = screenToGrid(gridToScreen(point));
      expect(restored.x).toBeCloseTo(point.x);
      expect(restored.y).toBeCloseTo(point.y);
    }
  });

  it("selects the nearest logical tile", () => {
    const screen = gridToScreen({ x: 9.1, y: 12.15 });
    expect(roundGrid(screenToGrid(screen))).toMatchObject({ x: 9, y: 12 });
  });

  it("preserves optional elevation when requested", () => {
    const screen = gridToScreen({ x: 4, y: 5, elevation: 2 });
    const restored = screenToGrid(screen, 2);
    expect(restored).toMatchObject({ x: 4, y: 5, elevation: 2 });
  });
});
