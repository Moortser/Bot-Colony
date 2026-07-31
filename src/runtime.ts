import type { BuildingTypeId } from "./simulation/types";
import { Simulation } from "./simulation/simulation";

export interface RuntimeState {
  simulation: Simulation;
  selectedId?: string;
  placementType?: BuildingTypeId;
  placementTile?: { x: number; y: number };
  hoverTile?: { x: number; y: number };
  placementValid: boolean;
  placementReason: string;
  selectionVersion: number;
  refreshUi: () => void;
}

export const runtime: RuntimeState = {
  simulation: new Simulation(),
  selectedId: "bot-seed",
  selectionVersion: 0,
  placementValid: false,
  placementReason: "",
  refreshUi: () => undefined,
};

export function replaceSimulation(simulation: Simulation): void {
  runtime.simulation = simulation;
  runtime.selectedId = "bot-seed";
  runtime.placementType = undefined;
  runtime.placementTile = undefined;
  runtime.hoverTile = undefined;
  runtime.selectionVersion += 1;
  runtime.refreshUi();
}
