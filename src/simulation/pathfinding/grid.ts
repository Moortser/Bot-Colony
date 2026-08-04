import type {
  BuildingEntity,
  DepositEntity,
  GridPoint,
  InteractionKind,
  SelectableEntity,
  SimulationState,
} from "../types";

export interface PathResult {
  path: GridPoint[];
  reason: string;
  visited: number;
}

export interface InteractionResult extends PathResult {
  requestedDestination: GridPoint;
  interactionDestination?: GridPoint;
}

const NEIGHBORS: ReadonlyArray<Readonly<GridPoint>> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function tileKey(point: GridPoint): string {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

export function sameTile(a: GridPoint | undefined, b: GridPoint | undefined): boolean {
  return !!a && !!b && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
}

export function isInsideMap(mapSize: number, point: GridPoint): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < mapSize && point.y < mapSize;
}

export function blockedTileKeys(state: SimulationState): Set<string> {
  const blocked = new Set<string>();
  for (const deposit of Object.values(state.deposits)) blocked.add(tileKey(deposit.position));
  for (const building of Object.values(state.buildings)) {
    if (building.cancelled) continue;
    for (let x = 0; x < building.footprint.width; x += 1) {
      for (let y = 0; y < building.footprint.height; y += 1) {
        blocked.add(tileKey({ x: building.position.x + x, y: building.position.y + y }));
      }
    }
  }
  return blocked;
}

export function findPath(
  mapSize: number,
  blocked: ReadonlySet<string>,
  startPosition: GridPoint,
  destination: GridPoint,
): PathResult {
  const start = { x: Math.round(startPosition.x), y: Math.round(startPosition.y) };
  const goal = { x: Math.round(destination.x), y: Math.round(destination.y) };
  if (!isInsideMap(mapSize, goal)) return { path: [], reason: "Destination outside map", visited: 0 };
  if (blocked.has(tileKey(goal)) && !sameTile(start, goal)) return { path: [], reason: "Target interaction point blocked", visited: 0 };
  if (sameTile(start, goal)) return { path: [start], reason: "", visited: 1 };

  const open: Array<{ point: GridPoint; g: number; h: number; order: number }> = [
    { point: start, g: 0, h: manhattan(start, goal), order: 0 },
  ];
  const cameFrom = new Map<string, string>();
  const points = new Map<string, GridPoint>([[tileKey(start), start]]);
  const bestCost = new Map<string, number>([[tileKey(start), 0]]);
  const closed = new Set<string>();
  let insertionOrder = 1;
  let visited = 0;

  while (open.length > 0) {
    open.sort((a, b) => a.g + a.h - (b.g + b.h) || a.h - b.h || a.order - b.order);
    const current = open.shift();
    if (!current) break;
    const currentKey = tileKey(current.point);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited += 1;
    if (sameTile(current.point, goal)) {
      return { path: reconstructPath(cameFrom, points, currentKey), reason: "", visited };
    }

    for (const offset of NEIGHBORS) {
      const next = { x: current.point.x + offset.x, y: current.point.y + offset.y };
      const nextKey = tileKey(next);
      if (!isInsideMap(mapSize, next) || closed.has(nextKey)) continue;
      if (blocked.has(nextKey) && !sameTile(next, goal)) continue;
      const tentative = current.g + 1;
      if (tentative >= (bestCost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(nextKey, currentKey);
      points.set(nextKey, next);
      bestCost.set(nextKey, tentative);
      open.push({ point: next, g: tentative, h: manhattan(next, goal), order: insertionOrder++ });
    }
  }
  return { path: [], reason: "No route to target", visited };
}

export function resolveInteractionPath(
  state: SimulationState,
  start: GridPoint,
  target: SelectableEntity,
  interaction: InteractionKind,
): InteractionResult {
  const blocked = blockedTileKeys(state);
  const requestedDestination = { x: Math.round(target.position.x), y: Math.round(target.position.y) };
  const candidates = interactionCandidates(target, interaction)
    .filter((point) => isInsideMap(state.mapSize, point) && !blocked.has(tileKey(point)))
    .sort((a, b) => manhattan(start, a) - manhattan(start, b) || a.y - b.y || a.x - b.x);
  if (candidates.length === 0) {
    return { path: [], reason: "No valid interaction point", visited: 0, requestedDestination };
  }
  let visited = 0;
  for (const candidate of candidates) {
    const result = findPath(state.mapSize, blocked, start, candidate);
    visited += result.visited;
    if (result.path.length > 0) {
      return { ...result, visited, requestedDestination, interactionDestination: candidate };
    }
  }
  return { path: [], reason: "No valid path", visited, requestedDestination };
}

export function interactionCandidates(target: SelectableEntity, interaction: InteractionKind): GridPoint[] {
  if (target.kind === "deposit") return cardinalNeighbors(target);
  if (target.kind !== "building") return cardinalNeighbors(target);
  const preferred = preferredBuildingInteraction(target, interaction);
  return uniquePoints([preferred, ...buildingPerimeter(target)]);
}

export function preferredBuildingInteraction(building: BuildingEntity, interaction: InteractionKind): GridPoint {
  switch (interaction) {
    case "input":
      return { x: building.position.x - 1, y: building.position.y + building.footprint.height - 1 };
    case "output":
      return { x: building.position.x + building.footprint.width, y: building.position.y };
    case "operator":
      return { x: building.position.x + building.footprint.width, y: building.position.y + 1 };
    case "charging":
      return { x: building.position.x - 1, y: building.position.y };
    case "construction":
      return { x: building.position.x - 1, y: building.position.y };
    case "deposit":
      return { x: building.position.x - 1, y: building.position.y };
  }
}

function cardinalNeighbors(target: DepositEntity | SelectableEntity): GridPoint[] {
  const x = Math.round(target.position.x);
  const y = Math.round(target.position.y);
  return NEIGHBORS.map((offset) => ({ x: x + offset.x, y: y + offset.y }));
}

function buildingPerimeter(building: BuildingEntity): GridPoint[] {
  const points: GridPoint[] = [];
  for (let x = 0; x < building.footprint.width; x += 1) {
    points.push({ x: building.position.x + x, y: building.position.y - 1 });
    points.push({ x: building.position.x + x, y: building.position.y + building.footprint.height });
  }
  for (let y = 0; y < building.footprint.height; y += 1) {
    points.push({ x: building.position.x - 1, y: building.position.y + y });
    points.push({ x: building.position.x + building.footprint.width, y: building.position.y + y });
  }
  return uniquePoints(points);
}

function uniquePoints(points: GridPoint[]): GridPoint[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = tileKey(point);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reconstructPath(cameFrom: Map<string, string>, points: Map<string, GridPoint>, endKey: string): GridPoint[] {
  const path: GridPoint[] = [];
  let cursor: string | undefined = endKey;
  while (cursor) {
    const point = points.get(cursor);
    if (point) path.push(point);
    cursor = cameFrom.get(cursor);
  }
  return path.reverse();
}

function manhattan(a: GridPoint, b: GridPoint): number {
  return Math.abs(Math.round(a.x) - Math.round(b.x)) + Math.abs(Math.round(a.y) - Math.round(b.y));
}
