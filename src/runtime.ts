import type { BuildingTypeId } from "./simulation/types";
import { Simulation } from "./simulation/simulation";

export interface RuntimeState {
  simulation: Simulation;
  simulationRevision: number;
  selectedId?: string;
  placementType?: BuildingTypeId;
  placementTile?: { x: number; y: number };
  hoverTile?: { x: number; y: number };
  placementValid: boolean;
  placementReason: string;
  refreshUi: () => void;
}

export const runtime: RuntimeState = {
  simulation: new Simulation(),
  simulationRevision: 0,
  selectedId: "bot-seed",
  placementValid: false,
  placementReason: "",
  refreshUi: () => undefined,
};

export function replaceSimulation(simulation: Simulation): void {
  runtime.simulation = simulation;
  runtime.simulationRevision += 1;
  runtime.selectedId = "bot-seed";
  runtime.placementType = undefined;
  runtime.placementTile = undefined;
  runtime.hoverTile = undefined;
  runtime.refreshUi();
}
