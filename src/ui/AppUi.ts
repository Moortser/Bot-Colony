import { BUILDINGS, ITEMS, OBJECTIVES, RECIPES, RESEARCH } from "../data/content";
import { UI_ICON_FRAMES } from "../game/assets/manifest";
import { replaceSimulation, runtime } from "../runtime";
import { inventoryTotal, itemCount } from "../simulation/inventory";
import { Simulation } from "../simulation/simulation";
import { BASIC_BRAIN_COMMANDS } from "../simulation/programs/templates";
import { preferredBuildingInteraction } from "../simulation/pathfinding/grid";
import type {
  BotEntity,
  BuildingEntity,
  BuildingTypeId,
  Inventory,
  ItemId,
  ProgramCommand,
  ProgramCommandParameters,
  ProgramCommandType,
  ProgramTemplateId,
  ProjectPriority,
  ResearchId,
  SelectableEntity,
} from "../simulation/types";

const SAVE_KEY = "bot-colony.bootstrap.save.v1";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[character] ?? character;
  });
}

function colorHex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function icon(frame: number): string {
  return `<span class="pixel-icon" aria-hidden="true" style="background-position:${frame * -16}px 0"></span>`;
}

function itemRows(inventory: Inventory): string {
  const entries = (Object.entries(inventory) as Array<[ItemId, number]>).filter(([, quantity]) => quantity > 0);
  if (entries.length === 0) return '<span class="empty">-- empty --</span>';
  return entries
    .map(
      ([itemId, quantity]) =>
        `<span class="item-chip"><i style="--item:${colorHex(ITEMS[itemId].color)}"></i>${escapeHtml(ITEMS[itemId].shortName)} <b>${quantity}</b></span>`,
    )
    .join("");
}

function costLabel(inventory: Inventory): string {
  return (Object.entries(inventory) as Array<[ItemId, number]>)
    .map(([itemId, quantity]) => `${ITEMS[itemId].shortName} ${quantity}`)
    .join(" / ");
}

function progress(value: number, maximum: number): string {
  const percent = maximum <= 0 ? 0 : Math.max(0, Math.min(100, (value / maximum) * 100));
  return `<div class="meter"><i style="width:${percent}%"></i><span>${Math.floor(percent)}%</span></div>`;
}

function toolButton(
  label: string,
  action: string,
  frame: number,
  options?: { active?: boolean; disabled?: boolean; data?: string; compact?: boolean },
): string {
  return `<button class="tool-button ${options?.active ? "active" : ""} ${options?.compact ? "compact" : ""}"
    data-action="${action}" ${options?.data ?? ""} ${options?.disabled ? "disabled" : ""} title="${escapeHtml(label)}"
    aria-label="${escapeHtml(label)}">${icon(frame)}<span>${escapeHtml(label)}</span></button>`;
}

function commandButton(
  label: string,
  action: string,
  frame: number,
  options?: { disabled?: boolean; data?: string; active?: boolean; danger?: boolean },
): string {
  return `<button class="command-button ${options?.active ? "active" : ""} ${options?.danger ? "danger" : ""}"
    data-action="${action}" ${options?.data ?? ""} ${options?.disabled ? "disabled" : ""}>
    ${icon(frame)}<span>${escapeHtml(label)}</span></button>`;
}

function titleBar(kicker: string, title: string, windowName: string): string {
  return `<div class="window-title"><span><small>${escapeHtml(kicker)}</small><b>${escapeHtml(title)}</b></span>
    <button data-action="close-window" data-window="${windowName}" aria-label="Close ${escapeHtml(title)}">X</button></div>`;
}

export class AppUi {
  private lastViewSignature = "";
  private objectiveExpanded = false;
  private buildOpen = false;
  private researchOpen = false;
  private systemOpen = false;
  private selectionOpen = true;
  private mobilePanel?: "build" | "selection";
  private chromePointerHeld = false;
  private pendingRender = false;
  private lastDomRenderAt = 0;
  private scheduledRender?: number;
  private selectionInitialized = false;
  private renderedSelectedId?: string;
  private renderedSelectionVersion = 0;

  public constructor() {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("App root is missing");
    app.innerHTML = `
      <div class="game-shell">
        <header id="topbar" class="topbar chrome-surface"></header>
        <main id="playfield" class="playfield">
          <div id="game-canvas"></div>
          <aside id="objectives" class="objective-strip chrome-surface"></aside>
          <aside id="build-window" class="window build-window chrome-surface hidden"></aside>
          <aside id="selection-window" class="window context-window chrome-surface"></aside>
          <aside id="system-window" class="window system-window chrome-surface hidden"></aside>
          <section id="research-drawer" class="window research-drawer chrome-surface hidden"></section>
          <div id="placement-hint" class="placement-hint hidden"></div>
          <div id="notifications" class="notifications"></div>
          <pre id="debug-readout" class="debug-readout hidden"></pre>
        </main>
        <nav id="command-dock" class="command-dock chrome-surface"></nav>
        <footer id="status-strip" class="status-strip chrome-surface"></footer>
      </div>
    `;
    app.addEventListener("click", (event) => this.handleClick(event));
    app.addEventListener("change", (event) => this.handleChange(event));
    app.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest(".chrome-surface")) {
        this.chromePointerHeld = true;
        event.stopPropagation();
      }
    });
    window.addEventListener("pointerup", () => this.releaseChromePointer());
    window.addEventListener("pointercancel", () => this.releaseChromePointer());
    runtime.refreshUi = () => this.render();
    this.render(true);
  }

  public render(force = false): void {
    const state = runtime.simulation.state;
    if (this.chromePointerHeld) {
      this.pendingRender = true;
      return;
    }
    const now = performance.now();
    const timeUntilNextRender = 200 - (now - this.lastDomRenderAt);
    if (!force && timeUntilNextRender > 0) {
      if (this.scheduledRender === undefined) {
        this.scheduledRender = window.setTimeout(() => {
          this.scheduledRender = undefined;
          this.render(true);
        }, timeUntilNextRender);
      }
      return;
    }
    const selectionChanged =
      this.selectionInitialized &&
      (this.renderedSelectedId !== runtime.selectedId || this.renderedSelectionVersion !== runtime.selectionVersion);
    if (selectionChanged) {
      this.selectionOpen = true;
      if (window.matchMedia("(max-width: 760px)").matches) this.mobilePanel = "selection";
    }
    this.selectionInitialized = true;
    this.renderedSelectedId = runtime.selectedId;
    this.renderedSelectionVersion = runtime.selectionVersion;
    const viewSignature = [
      state.tick,
      runtime.selectedId ?? "",
      runtime.selectionVersion,
      runtime.hoverTile ? `${runtime.hoverTile.x},${runtime.hoverTile.y}` : "",
      runtime.placementType ?? "",
      runtime.placementTile ? `${runtime.placementTile.x},${runtime.placementTile.y}` : "",
      runtime.placementValid,
      runtime.placementReason,
    ].join("|");
    if (!force && this.lastViewSignature === viewSignature) return;
    if (this.scheduledRender !== undefined) {
      window.clearTimeout(this.scheduledRender);
      this.scheduledRender = undefined;
    }
    this.lastViewSignature = viewSignature;
    this.lastDomRenderAt = now;
    this.renderTopbar();
    this.renderObjectives();
    this.renderBuildWindow();
    this.renderSelectionWindow();
    this.renderSystemWindow();
    this.renderCommandDock();
    this.renderStatusStrip();
    this.renderResearchDrawer();
    this.renderNotifications();
    this.renderPlacementHint();
    this.renderDebugReadout();
  }

  private releaseChromePointer(): void {
    this.chromePointerHeld = false;
    if (!this.pendingRender) return;
    this.pendingRender = false;
    window.setTimeout(() => this.render(true), 0);
  }

  private renderTopbar(): void {
    const simulation = runtime.simulation;
    const state = simulation.state;
    const seed = simulation.seed;
    const resources: Array<[string, ItemId, string]> = [
      ["Fe ore", "ironOre", "iron"],
      ["Fe", "ironIngot", "iron"],
      ["Cu ore", "copperOre", "copper"],
      ["Cu", "copperIngot", "copper"],
    ];
    this.setHtml(
      "topbar",
      `<div class="brand-plate"><span class="brand-mark">BC</span><span><b>BOT COLONY</b><small>BOOTSTRAP SECTOR 01</small></span></div>
       <div class="tool-cluster">
         ${toolButton("Build", "toggle-build", UI_ICON_FRAMES.build, { active: this.buildOpen })}
         ${toolButton("Research", "toggle-research", UI_ICON_FRAMES.research, { active: this.researchOpen })}
         ${toolButton("Objectives", "toggle-objective", UI_ICON_FRAMES.objectives, { active: this.objectiveExpanded })}
       </div>
       <div class="resource-strip">
         ${resources
           .map(
             ([label, itemId, tone]) =>
               `<span class="resource-counter ${tone}"><i></i><small>${label}</small><b>${simulation.totalPhysicalItem(itemId)}</b></span>`,
           )
           .join("")}
       </div>
       <div class="colony-readouts">
         <span title="Seed energy">${icon(UI_ICON_FRAMES.energy)}<b>${Math.floor(seed.battery)}%</b></span>
         <span title="Bot count">${icon(UI_ICON_FRAMES.bots)}<b>${Object.keys(state.bots).length}</b></span>
       </div>
       <div class="speed-cluster">
         ${toolButton(state.speed === 0 ? "Resume" : "Pause", "pause", state.speed === 0 ? UI_ICON_FRAMES.play : UI_ICON_FRAMES.pause, {
           active: state.speed === 0,
           compact: true,
         })}
         <button class="speed-button ${state.speed === 1 ? "active" : ""}" data-action="speed" data-speed="1">1</button>
         <button class="speed-button ${state.speed === 2 ? "active" : ""}" data-action="speed" data-speed="2">2</button>
         <button class="speed-button ${state.speed === 4 ? "active" : ""}" data-action="speed" data-speed="4">4</button>
         ${toolButton("System", "toggle-system", UI_ICON_FRAMES.save, { active: this.systemOpen, compact: true })}
       </div>`,
    );
  }

  private renderObjectives(): void {
    const state = runtime.simulation.state;
    const objective = OBJECTIVES[Math.min(state.objectiveIndex, OBJECTIVES.length - 1)];
    const complete = state.flags.delegatedResearch && state.research.projectCoordination.completed;
    this.setHtml(
      "objectives",
      `<button class="objective-button" data-action="toggle-objective">
         <span class="objective-number">${String(state.objectiveIndex + 1).padStart(2, "0")}</span>
         <span><small>BOOTSTRAP OBJECTIVE</small><b>${complete ? "Automated project supply established" : escapeHtml(objective?.title ?? "")}</b></span>
         <i>${this.objectiveExpanded ? "-" : "+"}</i>
       </button>
       ${
         this.objectiveExpanded
           ? `<div class="objective-detail">
                <p>${complete ? "Bots can now move public stock into player-chosen construction and research projects while the Seed remains the operator." : escapeHtml(objective?.detail ?? "")}</p>
                ${state.objectiveIndex === 11 ? `<p class="automation-progress">AUTOMATED FE ${state.automation.ironIngotsDelivered}/3 // SUSTAINED ${Math.floor(state.automation.productiveSeconds)}/30s</p>` : ""}
                <div class="objective-track"><i style="width:${((state.objectiveIndex + (complete ? 1 : 0)) / OBJECTIVES.length) * 100}%"></i></div>
              </div>`
           : ""
       }`,
    );
  }

  private renderBuildWindow(): void {
    const element = document.querySelector<HTMLElement>("#build-window");
    if (!element) return;
    element.classList.toggle("hidden", !this.buildOpen);
    element.classList.toggle("mobile-open", this.mobilePanel === "build");
    if (!this.buildOpen) return;
    const simulation = runtime.simulation;
    const cards = (Object.entries(BUILDINGS) as Array<[BuildingTypeId, (typeof BUILDINGS)[BuildingTypeId]]>)
      .map(([type, definition]) => {
        const unlocked = simulation.state.unlocks.includes(definition.unlockId);
        return `<button class="build-choice ${runtime.placementType === type ? "active" : ""}" data-action="place" data-building="${type}"
          ${!unlocked ? "disabled" : ""}>
          <span class="build-glyph ${type}"><i></i></span>
          <b>${escapeHtml(definition.name)}</b>
          <small>${unlocked ? costLabel(definition.cost) : "LOCKED / RESEARCH"}</small>
        </button>`;
      })
      .join("");
    element.innerHTML = `${titleBar("SEED FABRICATOR", "CONSTRUCTION", "build")}
      <div class="build-grid">${cards}
        <button class="build-choice locked" disabled><span class="build-glyph future"><i></i></span><b>Assembler</b><small>FUTURE RESEARCH</small></button>
      </div>`;
  }

  private renderSelectionWindow(): void {
    const element = document.querySelector<HTMLElement>("#selection-window");
    if (!element) return;
    element.classList.toggle("hidden", !this.selectionOpen);
    element.classList.toggle("mobile-open", this.mobilePanel === "selection");
    const entity = runtime.simulation.getEntity(runtime.selectedId);
    if (!entity) {
      element.innerHTML = `${titleBar("COLONY INSPECTOR", "NO SELECTION", "selection")}
        <div class="empty-selection"><span class="selection-reticle"></span><p>Select a unit, resource, or structure.</p></div>`;
      return;
    }
    if (entity.kind === "bot") element.innerHTML = this.botSelection(entity);
    else if (entity.kind === "building") element.innerHTML = this.buildingSelection(entity);
    else element.innerHTML = this.depositSelection(entity);
  }

  private botSelection(bot: BotEntity): string {
    const taskProgress = bot.task.duration > 0 ? progress(bot.task.progress, bot.task.duration) : "";
    const program = bot.program;
    const request = program?.currentRequestId ? runtime.simulation.state.logisticsRequests[program.currentRequestId] : undefined;
    const reservation = program?.currentReservationId ? runtime.simulation.state.reservations[program.currentReservationId] : undefined;
    const target = program?.currentTargetId ? runtime.simulation.getEntity(program.currentTargetId) : undefined;
    const source = reservation ? runtime.simulation.getEntity(reservation.sourceId) : undefined;
    const destination = reservation ? runtime.simulation.getEntity(reservation.destinationId) : undefined;
    const programRows = program
      ? `<div class="program-list">${program.commands
          .map(
            (command, index) => `<div class="program-row ${command.runtimeStatus} ${index === program.instructionPointer ? "active" : ""}">
              <span>${String(index + 1).padStart(2, "0")}</span><b>${escapeHtml(command.label)}<small>${command.runtimeStatus.toUpperCase()}</small></b>
              <button data-action="program-up" data-index="${index}" aria-label="Move command up">^</button>
              <button data-action="program-down" data-index="${index}" aria-label="Move command down">v</button>
              <button data-action="program-remove" data-index="${index}" aria-label="Remove command">X</button>
              ${this.programParameterEditor(command, index)}
            </div>`,
          )
          .join("")}</div>`
      : "";
    return `${titleBar(bot.frame === "seed" ? "VON NEUMANN SEED" : "UTILITY FRAME", bot.name, "selection")}
      <div class="entity-summary bot-summary"><span class="summary-glyph"></span><div><small>${escapeHtml(bot.id)}</small><b>${escapeHtml(bot.status)}</b></div></div>
      <section class="window-section compact-readouts">
        <label><span>BATTERY</span><b>${bot.battery.toFixed(1)} / ${bot.maxBattery}</b></label>${progress(bot.battery, bot.maxBattery)}
        <label><span>CARGO</span><b>${inventoryTotal(bot.inventory)} / ${bot.inventoryCapacity}</b></label>
        <div class="item-row">${itemRows(bot.inventory)}</div>
      </section>
      <section class="window-section state-block ${bot.blockingReason ? "blocked" : ""}">
        <small>CURRENT ACTION</small><b>${escapeHtml(bot.task.label)}</b>${taskProgress}
        ${bot.blockingReason ? `<em>${escapeHtml(bot.blockingReason)}</em>` : ""}
      </section>
      ${
        bot.frame === "utility"
          ? `<section class="window-section"><small class="section-label">ORDERED PROGRAM</small>
              <div class="mini-button-grid">
                <button data-action="assign-program" data-program="ironMiner">IRON MINER</button>
                <button data-action="assign-program" data-program="factoryHauler">FACTORY HAULER</button>
                <button data-action="assign-program" data-program="colonySupplier">COLONY SUPPLIER</button>
                ${program ? `<button data-action="restart-program">RESTART</button>${program.running ? '<button class="danger" data-action="stop-program">STOP PROGRAM</button>' : '<button data-action="start-program">START PROGRAM</button>'}` : ""}
              </div>
              ${
                program
                  ? `<div class="program-readout">
                       <span>COMMAND <b>${program.instructionPointer + 1}/${program.commands.length}</b></span>
                       <span>LOOPS <b>${program.loopCount}</b></span>
                       <span>TARGET <b>${escapeHtml(target?.name ?? "--")}</b></span>
                       <span>REQUEST <b>${escapeHtml(request ? `${request.state}: ${request.label}` : "--")}</b></span>
                       <span>PROJECT <b>${escapeHtml(request?.projectKind?.toUpperCase() ?? "--")}</b></span>
                       <span>SOURCE <b>${escapeHtml(source?.name ?? "--")}</b></span>
                       <span>DESTINATION <b>${escapeHtml(destination?.name ?? "--")}</b></span>
                       <span>RESERVED <b>${escapeHtml(reservation ? `${reservation.itemId} x${reservation.quantity} / ${reservation.state}` : "--")}</b></span>
                       <span>CARRIED <b>${escapeHtml(reservation ? `${ITEMS[reservation.itemId].shortName} x${itemCount(bot.inventory, reservation.itemId)}` : "--")}</b></span>
                       <span>PATH <b>${bot.path.status} ${bot.path.currentIndex}/${Math.max(0, bot.path.tiles.length - 1)}</b></span>
                     </div>`
                  : ""
              }
              ${programRows}
              ${
                program
                  ? `<div class="program-add"><select id="program-command-add">${BASIC_BRAIN_COMMANDS.map((entry) => `<option value="${entry.kind}">${escapeHtml(entry.label)}</option>`).join("")}</select><button data-action="program-add">ADD COMMAND</button></div>`
                  : ""
              }
              ${program?.blockingReason ? `<p class="blocking-copy">Blocked: ${escapeHtml(program.blockingReason)}</p>` : ""}
            </section>`
          : ""
      }`;
  }

  private programParameterEditor(command: ProgramCommand, index: number): string {
    const select = (parameter: keyof ProgramCommandParameters, value: string, values: Array<[string, string]>) =>
      `<label>${parameter}<select data-program-index="${index}" data-program-parameter="${parameter}">${values
        .map(([optionValue, label]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${label}</option>`)
        .join("")}</select></label>`;
    const number = (parameter: keyof ProgramCommandParameters, value: number, minimum: number, maximum: number) =>
      `<label>${parameter}<input type="number" min="${minimum}" max="${maximum}" step="1" value="${value}" data-program-index="${index}" data-program-parameter="${parameter}"></label>`;
    let controls = "";
    if (command.kind === "findDeposit" || command.kind === "mineUntilFull") {
      controls = select("resourceType", command.parameters.resourceType ?? "ironOre", [
        ["ironOre", "Iron Ore"],
        ["copperOre", "Copper Ore"],
      ]);
    }
    if (["claimSupplyRequest", "deliverCargo"].includes(command.kind)) {
      controls = select("itemId", command.parameters.itemId ?? "ironOre", [
        ["ironOre", "Iron Ore"],
        ["copperOre", "Copper Ore"],
        ["ironIngot", "Iron Ingot"],
        ["copperIngot", "Copper Ingot"],
      ]);
    }
    if (command.kind === "claimOutputRequest") {
      controls = select("itemId", command.parameters.itemId ?? "", [
        ["", "Any output item"],
        ...Object.values(ITEMS).map((item): [string, string] => [item.id, item.name]),
      ]);
    }
    if (command.kind === "claimProjectSupplyRequest") {
      controls =
        select("projectFilter", command.parameters.projectFilter ?? "any", [
          ["any", "Any project"],
          ["construction", "Construction"],
          ["research", "Research"],
        ]) +
        select("itemId", command.parameters.itemId ?? "", [
          ["", "Any item"],
          ...Object.values(ITEMS).map((item): [string, string] => [item.id, item.name]),
        ]);
    }
    if (command.kind === "rechargeIfBelow") {
      controls =
        number("startThreshold", command.parameters.startThreshold ?? 25, 1, 99) +
        number("resumeThreshold", command.parameters.resumeThreshold ?? 90, 2, 100);
    }
    if (command.kind === "wait") controls = number("duration", command.parameters.duration ?? 2, 0, 120);
    return controls ? `<div class="program-params">${controls}</div>` : "";
  }

  private buildingSelection(building: BuildingEntity): string {
    const definition = BUILDINGS[building.type];
    const researchNode = building.activeResearchId ? runtime.simulation.state.research[building.activeResearchId] : undefined;
    const researchDefinition = building.activeResearchId ? RESEARCH[building.activeResearchId] : undefined;
    const requests = Object.values(runtime.simulation.state.logisticsRequests).filter(
      (request) => request.buildingId === building.id && request.active,
    );
    const priorityUnlocked = runtime.simulation.state.unlocks.includes("project.priority");
    const priority = building.projectPriority ?? "normal";
    const priorityControls = `<div class="priority-controls" aria-label="Project priority">
      ${(["high", "normal", "low"] as ProjectPriority[])
        .map(
          (value) =>
            `<button data-action="project-priority" data-priority="${value}" class="${priority === value ? "active" : ""}" ${priorityUnlocked ? "" : "disabled"}>${value.toUpperCase()}</button>`,
        )
        .join("")}
      ${priorityUnlocked ? "" : "<small>Unlock with Project Coordination</small>"}
    </div>`;
    const projectRows = (
      !building.complete && !building.cancelled
        ? (Object.entries(definition.cost) as Array<[ItemId, number]>).map(([itemId, required]) => ({
            itemId,
            required,
            delivered: itemCount(building.constructionInventory, itemId),
            request: requests.find((entry) => entry.type === "construction" && entry.itemId === itemId),
          }))
        : researchDefinition
          ? [...new Set(researchDefinition.requiredItems)].map((itemId) => ({
              itemId,
              required: 1,
              delivered: itemCount(building.researchHold, itemId),
              request: requests.find((entry) => entry.type === "researchItem" && entry.itemId === itemId),
            }))
          : []
    )
      .map(({ itemId, required, delivered, request }) => {
        const reserved = request?.reservedQuantity ?? 0;
        const inTransit = request?.inTransitQuantity ?? 0;
        const missing = Math.max(0, required - delivered - reserved - inTransit);
        return `<div class="project-item-row">
          <b>${escapeHtml(ITEMS[itemId].name)}</b>
          <span>REQ ${required}</span><span>DEL ${delivered}</span><span>RES ${reserved}</span><span>MOVE ${inTransit}</span><span>MISS ${missing}</span>
          <small>${escapeHtml(request?.claimedBy ? `Supplier ${request.claimedBy} // ${request.state}` : request?.blockingReason ?? (missing === 0 ? "Delivered" : "Open"))}</small>
        </div>`;
      })
      .join("");
    const constructionAccess = preferredBuildingInteraction(building, "construction");
    const operatorAccess = preferredBuildingInteraction(building, "operator");
    const constructor = runtime.simulation.seed.task.targetId === building.id &&
      (runtime.simulation.seed.task.kind === "building" || runtime.simulation.seed.task.nextKind === "building")
      ? runtime.simulation.seed.id
      : "--";
    return `${titleBar(building.cancelled ? "RECOVERY CACHE" : building.complete ? "COLONY STRUCTURE" : "CONSTRUCTION SITE", building.name, "selection")}
      <div class="entity-summary building-summary ${building.type}"><span class="summary-glyph"></span>
        <div><small>${escapeHtml(building.id)}</small><b>${escapeHtml(definition.description)}</b></div></div>
      <section class="window-section compact-readouts">
        ${
          building.complete || building.cancelled
            ? `<label><span>INPUT / STORAGE</span></label><div class="item-row">${itemRows(building.input)}</div>
               ${definition.outputCapacity > 0 || building.cancelled ? `<label><span>${building.cancelled ? "RECOVERABLE SALVAGE" : "OUTPUT"}</span></label><div class="item-row">${itemRows(building.output)}</div>` : ""}`
            : `<label><span>CONSTRUCTION</span><b>${Math.floor(building.constructionProgress * 100)}%</b></label>
               ${progress(building.constructionProgress, 1)}
               <label><span>FOOTPRINT</span><b>${building.footprint.width}×${building.footprint.height}</b></label>
               <label><span>ACCESS</span><b>${constructionAccess.x},${constructionAccess.y}</b></label>
               <label><span>CONSTRUCTOR</span><b>${escapeHtml(constructor)}</b></label>
               ${priorityControls}<div class="project-materials">${projectRows}</div>`
        }
        ${
        building.type === "furnace"
            ? `<label><span>IRON ORE TO INGOT</span></label>${progress(building.productionProgress, RECIPES.furnaceIron.duration)}`
            : ""
        }
        ${
          building.type === "chargingStation"
            ? `<label><span>LOCAL POWER BUFFER</span><b>${building.power.toFixed(1)} / 100</b></label>${progress(building.power, 100)}
               <label><span>CHARGING DOCK</span><b>${escapeHtml(building.chargingBotId ?? "AVAILABLE")}</b></label>`
            : ""
        }
      </section>
      ${
        researchNode && researchDefinition
          ? `<section class="window-section project-panel"><small class="section-label">ACTIVE RESEARCH</small><b>${escapeHtml(researchDefinition.name)}</b>
              <p>Prerequisites: ${escapeHtml(researchDefinition.prerequisites.map((id) => RESEARCH[id].name).join(", ") || "None")}</p>
              <label><span>OPERATOR POINT</span><b>${operatorAccess.x},${operatorAccess.y}</b></label>
              <label><span>ASSIGNED OPERATOR</span><b>${escapeHtml(building.operatorId ?? "--")}</b></label>
              ${priorityControls}${progress(researchNode.progress, researchDefinition.duration)}
              <div class="project-materials">${projectRows}</div></section>`
          : ""
      }
      <section class="window-section state-block ${building.blockingReason ? "blocked" : ""}">
        <small>OPERATING STATE</small><b>${escapeHtml(building.status)}</b>
        ${building.blockingReason ? `<em>${escapeHtml(building.blockingReason)}</em>` : ""}
      </section>
      ${
        requests.length && projectRows.length === 0
          ? `<section class="window-section"><small class="section-label">LOGISTICS</small>${requests
              .map(
                (request) =>
                  `<div class="request-row"><span>${escapeHtml(request.label)}</span><b>${request.state.toUpperCase()}${request.reservedQuantity ? ` x${request.reservedQuantity}` : ""}</b></div>`,
              )
              .join("")}</section>`
          : ""
      }`;
  }

  private depositSelection(deposit: SelectableEntity & { kind: "deposit" }): string {
    return `${titleBar("SURVEY RECORD", deposit.name, "selection")}
      <div class="entity-summary deposit-summary"><span class="summary-glyph" style="--ore:${colorHex(ITEMS[deposit.itemId].color)}"></span>
        <div><small>${escapeHtml(deposit.id)}</small><b>EXPOSED ${escapeHtml(ITEMS[deposit.itemId].name).toUpperCase()}</b></div></div>
      <section class="window-section compact-readouts"><label><span>ESTIMATED YIELD</span><b>${deposit.remaining}</b></label>
        ${progress(deposit.remaining, 80)}</section>
      <section class="window-section state-block"><small>RESERVATION</small>
        <b>${deposit.reservedBy ? `CLAIMED BY ${escapeHtml(deposit.reservedBy)}` : "AVAILABLE"}</b></section>`;
  }

  private renderSystemWindow(): void {
    const element = document.querySelector<HTMLElement>("#system-window");
    if (!element) return;
    element.classList.toggle("hidden", !this.systemOpen);
    if (!this.systemOpen) return;
    element.innerHTML = `${titleBar("COLONY CONTROL", "SYSTEM", "system")}
      <div class="system-actions">
        ${commandButton("Save colony", "save", UI_ICON_FRAMES.save)}
        ${commandButton("Load colony", "load", UI_ICON_FRAMES.save, { disabled: !localStorage.getItem(SAVE_KEY) })}
        ${commandButton("Debug overlay", "debug", UI_ICON_FRAMES.inspect, { active: runtime.simulation.state.debug })}
      </div>
      <p>SPACE pauses. Number keys 1-3 set simulation speed. D toggles diagnostics.</p>`;
  }

  private renderCommandDock(): void {
    const entity = runtime.simulation.getEntity(runtime.selectedId);
    let actions = "";
    if (entity?.kind === "bot" && entity.frame === "seed") {
      actions = `
        ${commandButton(entity.solarDeployed ? "Retract solar" : "Deploy solar", "solar", UI_ICON_FRAMES.solar, { active: entity.solarDeployed })}
        ${commandButton("Mine iron", "mine", UI_ICON_FRAMES.mine, { data: 'data-item="ironOre"' })}
        ${commandButton("Mine copper", "mine", UI_ICON_FRAMES.mine, { data: 'data-item="copperOre"' })}
        ${commandButton("Smelt Fe", "craft", UI_ICON_FRAMES.smelt, { data: 'data-recipe="microIron"' })}
        ${commandButton("Smelt Cu", "craft", UI_ICON_FRAMES.smelt, { data: 'data-recipe="microCopper"' })}
        <span class="command-divider"></span>
        ${commandButton("Frame", "craft", UI_ICON_FRAMES.build, { data: 'data-recipe="structuralFrame"' })}
        ${commandButton("Motor", "craft", UI_ICON_FRAMES.build, { data: 'data-recipe="simpleMotor"' })}
        ${commandButton("Battery", "craft", UI_ICON_FRAMES.energy, { data: 'data-recipe="basicBattery"' })}
        ${commandButton("Controller", "craft", UI_ICON_FRAMES.build, { data: 'data-recipe="controller"' })}
      `;
    } else if (entity?.kind === "building") {
      if (entity.cancelled) actions = commandButton("Collect salvage", "collect-building", UI_ICON_FRAMES.build);
      else if (!entity.complete) {
        actions = commandButton("Supply and Construct", "construct-site", UI_ICON_FRAMES.build);
        actions += commandButton("Cancel Site", "cancel-site", UI_ICON_FRAMES.pause, { danger: true });
      }
      else {
        if (entity.type === "furnace") {
          actions += commandButton("Supply input", "supply-building", UI_ICON_FRAMES.mine);
          actions += commandButton("Collect output", "collect-building", UI_ICON_FRAMES.smelt);
        }
        if (entity.type === "storage") actions += commandButton("Deposit cargo", "deposit-storage", UI_ICON_FRAMES.build);
        if (entity.type === "researchBench") {
          actions += commandButton("Research tree", "toggle-research", UI_ICON_FRAMES.research, { active: this.researchOpen });
          actions += commandButton("Collect items", "collect-building", UI_ICON_FRAMES.build);
          if (entity.activeResearchId) {
            actions += commandButton("Operate Research", "operate-research", UI_ICON_FRAMES.research);
            actions += commandButton("Cancel research", "cancel-research", UI_ICON_FRAMES.pause, { danger: true });
          }
        }
        if (entity.type === "botCradle") actions += commandButton("Build utility bot", "build-bot", UI_ICON_FRAMES.bots);
      }
    } else {
      actions = `<span class="dock-message">SELECT THE SEED DRONE OR A STRUCTURE FOR COMMANDS</span>`;
    }
    this.setHtml(
      "command-dock",
      `<div class="dock-grip"><span></span><span></span><span></span></div>
       <div class="dock-actions">${actions}</div>
       <div class="dock-panel-buttons">
         ${toolButton("Build", "toggle-build", UI_ICON_FRAMES.build, { active: this.buildOpen, compact: true })}
         ${toolButton("Inspect", "toggle-context", UI_ICON_FRAMES.inspect, { active: this.mobilePanel === "selection", compact: true })}
       </div>`,
    );
  }

  private renderStatusStrip(): void {
    const selected = runtime.simulation.getEntity(runtime.selectedId);
    const tile = runtime.hoverTile ? `${runtime.hoverTile.x},${runtime.hoverTile.y}` : "--,--";
    const action = selected?.kind === "bot" ? selected.task.label : selected?.kind === "building" ? selected.status : "Survey";
    const blocking = selected?.kind === "bot" || selected?.kind === "building" ? selected.blockingReason : "";
    const placement = runtime.placementType
      ? `${BUILDINGS[runtime.placementType].name} / ${costLabel(BUILDINGS[runtime.placementType].cost)} / ${
          runtime.placementValid ? "VALID" : runtime.placementReason || "CHOOSE TILE"
        }`
      : "";
    this.setHtml(
      "status-strip",
      `<span class="status-cell coordinates">TILE <b>${tile}</b></span>
       <span class="status-cell selected-name">SELECTED <b>${escapeHtml(selected?.name ?? "NONE")}</b></span>
       <span class="status-cell current-action">ACTION <b>${escapeHtml(action ?? "IDLE")}</b></span>
       <span class="status-cell contextual ${blocking ? "warning" : ""}">${escapeHtml(
         placement || blocking || "DRAG TO PAN / WHEEL OR PINCH TO STEP ZOOM / TAP TO SELECT",
       )}</span>`,
    );
  }

  private renderResearchDrawer(): void {
    const drawer = document.querySelector<HTMLElement>("#research-drawer");
    if (!drawer) return;
    drawer.classList.toggle("hidden", !this.researchOpen);
    if (!this.researchOpen) return;
    const selected = runtime.simulation.getEntity(runtime.selectedId);
    const bench =
      selected?.kind === "building" && selected.type === "researchBench"
        ? selected
        : runtime.simulation.findBuilding("researchBench");
    const cards = (Object.entries(RESEARCH) as Array<[ResearchId, (typeof RESEARCH)[ResearchId]]>)
      .map(([id, definition]) => {
        const node = runtime.simulation.state.research[id];
        const prerequisitesMet = definition.prerequisites.every(
          (researchId) => runtime.simulation.state.research[researchId].completed,
        );
        const state = node.completed
          ? "COMPLETED"
          : definition.disabled
            ? "FUTURE"
            : node.assignedBenchId
              ? "ACTIVE"
              : !prerequisitesMet
                ? "LOCKED"
                : !bench
                  ? "NO BENCH"
                  : "AVAILABLE";
        return `<article class="research-card ${state.toLowerCase().replaceAll(" ", "-")}">
          <div class="research-state">${state}</div><h3>${escapeHtml(definition.name)}</h3>
          <p>${escapeHtml(definition.description)}</p>
          <div class="research-items">${definition.requiredItems
            .map(
              (itemId) =>
                `<span class="${itemCount(runtime.simulation.seed.inventory, itemId) > 0 ? "owned" : ""}">${escapeHtml(
                  ITEMS[itemId].shortName,
                )} x1</span>`,
            )
            .join("")}</div>
          <small>${definition.duration}s / bench tier ${definition.benchTier} / items ${definition.consumeItems ? "consumed" : "returned"}</small>
          ${progress(node.progress, definition.duration)}
          <button data-action="research" data-research="${id}" ${
            !bench || node.completed || definition.disabled || !prerequisitesMet || !!bench.activeResearchId
              ? "disabled"
              : ""
          }>SELECT PROJECT</button>
        </article>`;
      })
      .join("");
    drawer.innerHTML = `${titleBar("PHYSICAL SYSTEMS ANALYSIS", "RESEARCH TREE", "research")}
      <p class="drawer-note">Research reserves one physical example of every listed item while the Seed operates the bench.</p>
      <div class="research-grid">${cards}</div>`;
  }

  private renderNotifications(): void {
    this.setHtml(
      "notifications",
      runtime.simulation.state.notifications
        .slice(-3)
        .map((notification) => `<div class="notification ${notification.tone}">${escapeHtml(notification.text)}</div>`)
        .join(""),
    );
  }

  private renderPlacementHint(): void {
    const element = document.querySelector<HTMLElement>("#placement-hint");
    if (!element) return;
    const active = runtime.placementType !== undefined;
    element.classList.toggle("hidden", !active);
    if (active) {
      element.classList.toggle("invalid", !runtime.placementValid);
      element.textContent = runtime.placementValid
        ? `PLACE ${BUILDINGS[runtime.placementType!].name.toUpperCase()} / CLICK OR TAP`
        : `INVALID / ${runtime.placementReason || "MOVE POINTER OVER PLAYFIELD"}`;
    }
  }

  private renderDebugReadout(): void {
    const element = document.querySelector<HTMLElement>("#debug-readout");
    if (!element) return;
    const state = runtime.simulation.state;
    element.classList.toggle("hidden", !state.debug);
    if (!state.debug) return;
    const selected = runtime.simulation.getEntity(runtime.selectedId);
    const activeRequests = Object.values(state.logisticsRequests).filter((request) => request.active);
    const path = selected?.kind === "bot" ? selected.path : undefined;
    const requestStates = activeRequests.reduce<Record<string, number>>((summary, request) => {
      summary[request.state] = (summary[request.state] ?? 0) + 1;
      return summary;
    }, {});
    const projectRequests = activeRequests.filter((request) => request.type === "construction" || request.type === "researchItem");
    const supplier = selected?.kind === "bot" && selected.program?.templateId === "colonySupplier" ? selected : undefined;
    element.textContent = [
      "DEBUG / AUTHORITATIVE SIMULATION",
      `tick ${state.tick} / fixed ${10 * state.speed} steps/s / time ${state.gameTime.toFixed(1)}s / speed ${state.speed}x`,
      `tile ${runtime.hoverTile ? `${runtime.hoverTile.x},${runtime.hoverTile.y}` : "--"} / selected ${selected?.id ?? "--"}`,
      `objective ${state.objectiveIndex + 1}/${OBJECTIVES.length} / automated Fe ${state.automation.ironIngotsDelivered}/3 / sustained ${state.automation.productiveSeconds.toFixed(1)}/30s`,
      `requests ${activeRequests.length} ${JSON.stringify(requestStates)} / reservations ${Object.keys(state.reservations).length}`,
      `projects ${projectRequests.map((request) => `${request.projectKind}:${request.itemId}@${request.priority ?? "normal"} del${request.deliveredQuantity ?? 0}/res${request.reservedQuantity}/move${request.inTransitQuantity ?? 0} ${request.claimedBy ?? "open"}`).join(" | ") || "--"}`,
      `supplier ${supplier ? `${supplier.id} ip ${supplier.program?.instructionPointer ?? 0} / ${supplier.path.status} / ${supplier.program?.blockingReason || "running"}` : "--"}`,
      `project inventories ${Object.values(state.buildings).filter((building) => !building.complete || building.activeResearchId).map((building) => `${building.id}:build${JSON.stringify(building.constructionInventory)}:research${JSON.stringify(building.researchHold)}`).join(" | ") || "--"}`,
      `path ${path ? `${path.status} node ${path.currentIndex}/${Math.max(0, path.tiles.length - 1)} target ${path.targetId ?? "--"} / ${path.repathReason || "no repath"}` : "--"}`,
      `deposit claims ${Object.values(state.deposits).filter((deposit) => deposit.reservedBy).map((deposit) => `${deposit.id}:${deposit.reservedBy}`).join(", ") || "--"}`,
      `charging docks ${Object.values(state.buildings).filter((building) => building.type === "chargingStation").map((building) => `${building.id}:${building.chargingBotId ?? "open"}@${building.power.toFixed(0)}`).join(", ") || "--"}`,
      `release events ${state.releaseEvents.slice(-4).join(" | ") || "--"}`,
    ].join("\n");
  }

  private handleClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
    const action = target.dataset.action;
    const simulation = runtime.simulation;
    const selected = simulation.getEntity(runtime.selectedId);

    if (action === "toggle-build") {
      this.buildOpen = !this.buildOpen;
      this.systemOpen = false;
      this.mobilePanel = this.buildOpen ? "build" : undefined;
    }
    if (action === "toggle-context") {
      if (window.matchMedia("(max-width: 760px)").matches) {
        this.mobilePanel = this.mobilePanel === "selection" ? undefined : "selection";
        this.selectionOpen = true;
      } else {
        this.selectionOpen = !this.selectionOpen;
      }
    }
    if (action === "toggle-system") {
      this.systemOpen = !this.systemOpen;
      this.buildOpen = false;
      this.mobilePanel = undefined;
    }
    if (action === "toggle-objective") this.objectiveExpanded = !this.objectiveExpanded;
    if (action === "close-window") this.closeWindow(target.dataset.window);
    if (action === "pause") simulation.togglePause();
    if (action === "speed") simulation.setSpeed(Number(target.dataset.speed) as 1 | 2 | 4);
    if (action === "place") {
      runtime.placementType = target.dataset.building as BuildingTypeId;
      runtime.placementTile = undefined;
      if (window.matchMedia("(max-width: 760px)").matches) {
        this.buildOpen = false;
        this.mobilePanel = undefined;
      }
    }
    if (action === "solar") simulation.commandSolar();
    if (action === "mine") simulation.commandMine(target.dataset.item as "ironOre" | "copperOre");
    if (action === "craft") simulation.commandCraft(target.dataset.recipe as keyof typeof RECIPES);
    if (action === "construct-site" && selected?.kind === "building") simulation.commandConstructSite(selected.id);
    if (action === "cancel-site" && selected?.kind === "building") simulation.cancelConstructionSite(selected.id);
    if (action === "supply-building" && selected?.kind === "building") simulation.commandSupplyBuilding(selected.id);
    if (action === "collect-building" && selected?.kind === "building") simulation.commandCollectBuilding(selected.id);
    if (action === "deposit-storage" && selected?.kind === "building") simulation.commandDepositToStorage(selected.id);
    if (action === "toggle-research") {
      this.researchOpen = !this.researchOpen;
      this.buildOpen = false;
      this.mobilePanel = undefined;
    }
    if (action === "research") {
      const bench =
        selected?.kind === "building" && selected.type === "researchBench"
          ? selected
          : simulation.findBuilding("researchBench");
      if (bench) {
        simulation.commandResearch(target.dataset.research as ResearchId, bench.id);
        this.researchOpen = false;
        runtime.selectedId = bench.id;
      }
    }
    if (action === "cancel-research" && selected?.kind === "building") simulation.cancelResearch(selected.id);
    if (action === "operate-research" && selected?.kind === "building") simulation.commandOperateResearch(selected.id);
    if (action === "project-priority" && selected?.kind === "building") {
      simulation.setProjectPriority(selected.id, target.dataset.priority as ProjectPriority);
    }
    if (action === "build-bot" && selected?.kind === "building") simulation.commandBuildBot(selected.id);
    if (action === "assign-program" && selected?.kind === "bot") {
      simulation.assignProgram(selected.id, target.dataset.program as ProgramTemplateId);
    }
    if (action === "stop-program" && selected?.kind === "bot") simulation.stopProgram(selected.id);
    if (action === "start-program" && selected?.kind === "bot") simulation.startProgram(selected.id);
    if (action === "restart-program" && selected?.kind === "bot") simulation.restartProgram(selected.id);
    if ((action === "program-up" || action === "program-down") && selected?.kind === "bot") {
      simulation.reorderProgram(selected.id, Number(target.dataset.index), action === "program-up" ? -1 : 1);
    }
    if (action === "program-remove" && selected?.kind === "bot") {
      simulation.removeProgramCommand(selected.id, Number(target.dataset.index));
    }
    if (action === "program-add" && selected?.kind === "bot") {
      const input = document.querySelector<HTMLSelectElement>("#program-command-add");
      if (input) simulation.addProgramCommand(selected.id, input.value as ProgramCommandType);
    }
    if (action === "debug") simulation.toggleDebug();
    if (action === "save") {
      localStorage.setItem(SAVE_KEY, simulation.serialize());
      this.flashSystemMessage("SIMULATION STATE SAVED");
    }
    if (action === "load") {
      const serialized = localStorage.getItem(SAVE_KEY);
      if (serialized) {
        replaceSimulation(Simulation.restore(serialized));
        this.flashSystemMessage("SIMULATION STATE RESTORED");
      }
    }
    this.render(true);
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const parameter = target.dataset.programParameter as keyof ProgramCommandParameters | undefined;
    const index = Number(target.dataset.programIndex);
    const selected = runtime.simulation.getEntity(runtime.selectedId);
    if (!parameter || !Number.isFinite(index) || selected?.kind !== "bot") return;
    const numeric = target instanceof HTMLInputElement && target.type === "number";
    const update = {
      [parameter]: numeric ? Number(target.value) : target.value,
    } as ProgramCommandParameters;
    runtime.simulation.updateProgramCommand(selected.id, index, update);
    this.render(true);
  }

  private closeWindow(windowName: string | undefined): void {
    if (windowName === "build") {
      this.buildOpen = false;
      this.mobilePanel = undefined;
    }
    if (windowName === "selection") {
      if (window.matchMedia("(max-width: 760px)").matches) this.mobilePanel = undefined;
      else this.selectionOpen = false;
    }
    if (windowName === "system") this.systemOpen = false;
    if (windowName === "research") this.researchOpen = false;
  }

  private flashSystemMessage(text: string): void {
    const element = document.querySelector<HTMLElement>("#placement-hint");
    if (!element) return;
    element.textContent = text;
    element.classList.remove("hidden", "invalid");
    window.setTimeout(() => element.classList.add("hidden"), 1200);
  }

  private setHtml(id: string, html: string): void {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
  }
}
