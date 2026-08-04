import { BOT_FRAMES } from "../../data/content";
import { blockedTileKeys, resolveInteractionPath, sameTile, tileKey } from "../pathfinding/grid";
import type { BotEntity, InteractionKind, SelectableEntity, SimulationState } from "../types";

export type MoveResult = "moving" | "arrived" | "blocked";

export function planBotPath(
  state: SimulationState,
  bot: BotEntity,
  target: SelectableEntity,
  interaction: InteractionKind,
  reason: string,
): boolean {
  const result = resolveInteractionPath(state, bot.position, target, interaction);
  bot.path = {
    tiles: result.path,
    currentIndex: result.path.length > 1 ? 1 : 0,
    requestedDestination: result.requestedDestination,
    interactionDestination: result.interactionDestination,
    status: result.path.length > 0 ? (result.path.length === 1 ? "arrived" : "planned") : "blocked",
    repathReason: result.path.length > 0 ? reason : result.reason,
    targetId: target.id,
    interaction,
    worldRevision: state.worldRevision,
  };
  return result.path.length > 0;
}

export function followBotPath(state: SimulationState, bot: BotEntity, delta: number): MoveResult {
  if (bot.path.status === "arrived") return "arrived";
  if (bot.path.status === "blocked" || bot.path.tiles.length === 0) return "blocked";
  if (state.worldRevision !== bot.path.worldRevision) {
    const blocked = blockedTileKeys(state);
    const invalid = bot.path.tiles
      .slice(bot.path.currentIndex)
      .some((tile) => blocked.has(tileKey(tile)) && !sameTile(tile, bot.path.interactionDestination));
    if (invalid) {
      bot.path.status = "blocked";
      bot.path.repathReason = "Current route became blocked";
      return "blocked";
    }
    bot.path.worldRevision = state.worldRevision;
  }
  const node = bot.path.tiles[bot.path.currentIndex];
  if (!node) {
    bot.path.status = "arrived";
    return "arrived";
  }
  const dx = node.x - bot.position.x;
  const dy = node.y - bot.position.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining <= 0.0001) {
    bot.position = { x: node.x, y: node.y };
    bot.path.currentIndex += 1;
    if (bot.path.currentIndex >= bot.path.tiles.length) {
      bot.path.status = "arrived";
      return "arrived";
    }
    return "moving";
  }
  if (bot.battery <= 0.01) {
    bot.path.status = "blocked";
    bot.path.repathReason = "Insufficient energy to continue";
    return "blocked";
  }
  bot.path.status = "moving";
  const amount = Math.min(remaining, BOT_FRAMES[bot.frame].moveSpeed * delta);
  bot.position.x += (dx / remaining) * amount;
  bot.position.y += (dy / remaining) * amount;
  bot.battery = Math.max(0, bot.battery - (bot.frame === "seed" ? 0.16 : 0.22) * amount);
  if (amount >= remaining - 0.0001) {
    bot.position = { x: node.x, y: node.y };
    bot.path.currentIndex += 1;
    if (bot.path.currentIndex >= bot.path.tiles.length) {
      bot.path.status = "arrived";
      return "arrived";
    }
  }
  return "moving";
}

export function clearBotPath(bot: BotEntity, reason = ""): void {
  bot.path = {
    tiles: [],
    currentIndex: 0,
    status: "idle",
    repathReason: reason,
    worldRevision: bot.path.worldRevision,
  };
}

export function isBotAtInteraction(bot: BotEntity): boolean {
  return bot.path.status === "arrived" && sameTile(bot.position, bot.path.interactionDestination);
}
