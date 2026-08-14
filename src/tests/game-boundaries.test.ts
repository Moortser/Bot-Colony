import { describe, expect, it } from "vitest";
import { PointerGestureGuard } from "../game/pointerGesture";
import { RenderTimeline } from "../game/renderTimeline";
import { replaceSimulation, runtime } from "../runtime";
import { addItem } from "../simulation/inventory";
import { Simulation } from "../simulation/simulation";

describe("restored simulation rendering", () => {
  it("invalidates stale renderer timing and renders the older snapshot immediately", () => {
    const originalSimulation = runtime.simulation;
    const simulation = new Simulation();
    simulation.seed.position = { x: 15, y: 15 };
    simulation.seed.battery = 12;
    const saved = simulation.serialize();

    simulation.seed.position = { x: 10, y: 14 };
    simulation.seed.battery = 73;
    addItem(simulation.seed.inventory, "ironOre", 4);
    simulation.stepFixed(100);
    replaceSimulation(simulation);

    const timeline = new RenderTimeline();
    expect(timeline.shouldRender(simulation.state.gameTime, simulation.state.speed, runtime.simulationRevision)).toBe(true);
    expect(timeline.shouldRender(simulation.state.gameTime, simulation.state.speed, runtime.simulationRevision)).toBe(false);

    const restored = Simulation.restore(saved);
    replaceSimulation(restored);

    expect(timeline.isStale(runtime.simulationRevision)).toBe(true);
    expect(runtime.simulation.state.gameTime).toBe(0);
    expect(runtime.simulation.seed.position).toEqual({ x: 15, y: 15 });
    expect(runtime.simulation.seed.battery).toBe(12);
    expect(runtime.simulation.seed.inventory).toEqual({});
    expect(timeline.shouldRender(restored.state.gameTime, restored.state.speed, runtime.simulationRevision)).toBe(true);

    replaceSimulation(originalSimulation);
  });
});

describe("multi-pointer gesture suppression", () => {
  it("does not change selection when either pinch pointer is released", () => {
    const gesture = new PointerGestureGuard();
    let selectionChanges = 0;
    gesture.pointerDown(1);
    gesture.pointerDown(2);

    if (gesture.pointerUp(1)) selectionChanges += 1;
    if (gesture.pointerUp(2)) selectionChanges += 1;

    expect(selectionChanges).toBe(0);
    gesture.pointerDown(3);
    if (gesture.pointerUp(3)) selectionChanges += 1;
    expect(selectionChanges).toBe(1);
  });

  it("does not confirm building placement when either pinch pointer is released", () => {
    const gesture = new PointerGestureGuard();
    let placements = 0;
    gesture.pointerDown(11);
    gesture.pointerDown(12);
    gesture.markMultiPointerGesture();

    if (gesture.pointerUp(11)) placements += 1;
    if (gesture.pointerUp(12)) placements += 1;

    expect(placements).toBe(0);
  });
});
