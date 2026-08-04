import type { ProgramCommand, ProgramCommandType, ProgramTemplateId } from "../types";

export interface ProgramTemplate {
  name: string;
  commands: ProgramCommand[];
}

const LABELS: Record<ProgramCommandType, string> = {
  findDeposit: "Find available deposit",
  moveToTarget: "Move to current target",
  mineUntilFull: "Mine until cargo is full",
  claimSupplyRequest: "Claim building supply request",
  claimOutputRequest: "Claim output pickup request",
  collectReserved: "Collect reserved items",
  deliverReserved: "Deliver reserved items",
  deliverCargo: "Deliver cargo",
  rechargeIfBelow: "Recharge if below 25%",
  wait: "Wait",
  repeat: "Repeat",
};

export function createProgramCommand(kind: ProgramCommandType, id: string): ProgramCommand {
  const parameters: ProgramCommand["parameters"] = {};
  if (kind === "findDeposit") parameters.resourceType = "ironOre";
  if (kind === "mineUntilFull") {
    parameters.resourceType = "ironOre";
    parameters.stopPolicy = "cargoFullOrDepositExhausted";
  }
  if (kind === "claimSupplyRequest") parameters.itemId = "ironOre";
  if (kind === "claimOutputRequest") parameters.itemId = "ironIngot";
  if (kind === "deliverCargo") {
    parameters.itemId = "ironOre";
    parameters.destinationPolicy = "claimedRequest";
  }
  if (kind === "rechargeIfBelow") {
    parameters.startThreshold = 25;
    parameters.resumeThreshold = 90;
  }
  if (kind === "wait") parameters.duration = 2;
  return { id, kind, label: LABELS[kind], parameters, runtimeStatus: "pending" };
}

function commands(prefix: string, kinds: ProgramCommandType[]): ProgramCommand[] {
  return kinds.map((kind, index) => createProgramCommand(kind, `${prefix}-${index + 1}`));
}

export const PROGRAM_TEMPLATES: Record<ProgramTemplateId, ProgramTemplate> = {
  ironMiner: {
    name: "Iron Miner",
    commands: commands("miner", [
      "findDeposit",
      "moveToTarget",
      "mineUntilFull",
      "claimSupplyRequest",
      "moveToTarget",
      "deliverCargo",
      "rechargeIfBelow",
      "repeat",
    ]),
  },
  factoryHauler: {
    name: "Factory Hauler",
    commands: commands("hauler", [
      "claimOutputRequest",
      "moveToTarget",
      "collectReserved",
      "moveToTarget",
      "deliverReserved",
      "rechargeIfBelow",
      "repeat",
    ]),
  },
};

export const BASIC_BRAIN_COMMANDS = (Object.keys(LABELS) as ProgramCommandType[]).map((kind) => ({
  kind,
  label: LABELS[kind],
}));
