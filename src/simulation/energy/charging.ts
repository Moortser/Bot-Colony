import { blockedTileKeys, findPath, interactionCandidates } from "../pathfinding/grid";
import type { BotEntity, BuildingEntity, SimulationState } from "../types";

export const CHARGE_RATE = 12;
export const CHARGER_BUFFER_CAPACITY = 100;
export const CHARGER_REGEN_RATE = 1.2;

export function batteryPercent(bot: BotEntity): number {
  return (bot.battery / bot.maxBattery) * 100;
}

export function reachableChargingStations(state: SimulationState, bot: BotEntity): BuildingEntity[] {
  const blocked = blockedTileKeys(state);
  return Object.values(state.buildings)
    .filter(
      (building) =>
        building.complete &&
        building.type === "chargingStation" &&
        (!building.chargingBotId || building.chargingBotId === bot.id),
    )
    .map((building) => ({
      building,
      distance: interactionCandidates(building, "charging")
        .map((point) => findPath(state.mapSize, blocked, bot.position, point).path.length)
        .filter((length) => length > 0)
        .sort((a, b) => a - b)[0] ?? Number.POSITIVE_INFINITY,
    }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((a, b) => a.distance - b.distance || a.building.id.localeCompare(b.building.id))
    .map(({ building }) => building);
}
