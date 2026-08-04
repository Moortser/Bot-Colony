import { itemCount } from "../inventory";
import type { BuildingEntity, ItemId, LogisticsRequest, Reservation, SimulationState } from "../types";

export function reservedAtSource(state: SimulationState, sourceId: string, itemId: ItemId): number {
  return Object.values(state.reservations)
    .filter(
      (reservation) =>
        reservation.sourceId === sourceId &&
        reservation.itemId === itemId &&
        reservation.state === "reserved",
    )
    .reduce((sum, reservation) => sum + reservation.quantity, 0);
}

export function availableOutput(state: SimulationState, building: BuildingEntity, itemId: ItemId): number {
  return Math.max(0, itemCount(building.output, itemId) - reservedAtSource(state, building.id, itemId));
}

export function completeReservation(state: SimulationState, reservation: Reservation, request: LogisticsRequest): void {
  reservation.state = "completed";
  request.state = "completed";
  request.active = false;
  request.claimedBy = undefined;
  request.reservedQuantity = 0;
  delete state.reservations[reservation.id];
}

export function releaseReservation(state: SimulationState, reservation: Reservation, nextState: "released" | "invalid" = "released"): void {
  const request = state.logisticsRequests[reservation.requestId];
  const wasInTransit = reservation.state === "inTransit";
  reservation.state = nextState;
  if (request && request.state !== "completed") {
    request.claimedBy = undefined;
    request.reservedQuantity = 0;
    if (wasInTransit) request.active = false;
    request.state = wasInTransit ? "cancelled" : request.active ? "open" : nextState === "invalid" ? "invalid" : "cancelled";
  }
  delete state.reservations[reservation.id];
}
