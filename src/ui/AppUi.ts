import { BUILDINGS, ITEMS, OBJECTIVES, RECIPES, RESEARCH } from "../data/content";
import { replaceSimulation, runtime } from "../runtime";
import { inventoryTotal, itemCount } from "../simulation/inventory";
import { Simulation } from "../simulation/simulation";
import type {
  BotEntity,
  BuildingEntity,
  BuildingTypeId,
  Inventory,
  ItemId,
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

function itemRows(inventory: Inventory): string {
  const entries = (Object.entries(inventory) as Array<[ItemId, number]>).filter(([, quantity]) => quantity > 0);
  if (entries.length === 0) return '<span class="empty">— empty —</span>';
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
    .join(" · ");
}

function colorHex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function progress(value: number, maximum: number): string {
  const percent = maximum <= 0 ? 0 : Math.max(0, Math.min(100, (value / maximum) * 100));
  return `<div class="meter"><i style="width:${percent}%"></i><span>${Math.floor(percent)}%</span></div>`;
}

function button(label: string, action: string, options?: { disabled?: boolean; data?: string; className?: string }): string {
  return `<button class="control ${options?.className ?? ""}" data-action="${action}" ${options?.data ?? ""} ${
    options?.disabled ? "disabled" : ""
  }>${label}</button>`;
}

export class AppUi {
  private lastRenderTick = -1;
  private objectiveCollapsed = false;
  private researchOpen = false;
  private mobilePanel?: "build" | "selection";

  public constructor() {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("App root is missing");
    app.innerHTML = `
      <div class="game-shell">
        <header id="topbar" class="topbar panel"></header>
        <aside id="objectives" class="objectives panel"></aside>
        <aside id="build-panel" class="build-panel panel"></aside>
        <main id="playfield" class="playfield">
          <div id="game-canvas"></div>
          <div id="placement-hint" class="placement-hint hidden"></div>
          <div id="notifications" class="notifications"></div>
          <pre id="debug-readout" class="debug-readout hidden"></pre>
          <div class="controls-hint">DRAG: PAN · WHEEL/PINCH: ZOOM · CLICK/TAP: SELECT · SPACE: PAUSE</div>
        </main>
        <aside id="selection-panel" class="selection-panel panel"></aside>
        <nav id="command-dock" class="command-dock panel"></nav>
        <section id="research-drawer" class="research-drawer panel hidden"></section>
      </div>
    `;
    app.addEventListener("click", (event) => this.handleClick(event));
    runtime.refreshUi = () => this.render();
    this.render(true);
  }

  public render(force = false): void {
    const state = runtime.simulation.state;
    if (!force && this.lastRenderTick === state.tick) return;
    this.lastRenderTick = state.tick;
    this.renderTopbar();
    this.renderObjectives();
    this.renderBuildPanel();
    this.renderSelection();
    this.renderCommandDock();
    this.renderResearchDrawer();
    this.renderNotifications();
    this.renderPlacementHint();
    this.renderDebugReadout();
  }

  private renderTopbar(): void {
    const simulation = runtime.simulation;
    const state = simulation.state;
    const seed = simulation.seed;
    const colonyEnergy = Object.values(state.buildings)
      .filter((building) => building.complete)
      .reduce((sum, building) => sum + building.power, 0);
    const componentTotal =
      simulation.totalPhysicalItem("structuralFrame") +
      simulation.totalPhysicalItem("simpleMotor") +
      simulation.totalPhysicalItem("basicBattery") +
      simulation.totalPhysicalItem("controller");
    const resources: Array<[string, number, string]> = [
      ["Fe Ore", simulation.totalPhysicalItem("ironOre"), "iron"],
      ["Fe", simulation.totalPhysicalItem("ironIngot"), "iron-ingot"],
      ["Cu Ore", simulation.totalPhysicalItem("copperOre"), "copper"],
      ["Cu", simulation.totalPhysicalItem("copperIngot"), "copper-ingot"],
      ["Parts", componentTotal, "parts"],
      ["Bots", Object.keys(state.bots).length, "bots"],
    ];
    this.setHtml(
      "topbar",
      `<div class="brand"><span class="brand-mark">BC</span><span>BOT COLONY<small>BOOTSTRAP PROTOCOL</small></span></div>
       <div class="power-readout"><label>SEED CELL <b>${Math.floor(seed.battery)}%</b></label>${progress(
         seed.battery,
         seed.maxBattery,
       )}<small>COLONY BUFFER // ${Math.floor(colonyEnergy)} u</small></div>
       <div class="resource-strip">${resources
         .map(([label, value, tone]) => `<span class="resource ${tone}"><small>${label}</small><b>${value}</b></span>`)
         .join("")}</div>
       <div class="time-controls">
         ${button(state.speed === 0 ? "▶" : "Ⅱ", "pause", { className: state.speed === 0 ? "active" : "" })}
         ${button("1×", "speed", { data: 'data-speed="1"', className: state.speed === 1 ? "active" : "" })}
         ${button("2×", "speed", { data: 'data-speed="2"', className: state.speed === 2 ? "active" : "" })}
         ${button("4×", "speed", { data: 'data-speed="4"', className: state.speed === 4 ? "active" : "" })}
       </div>`,
    );
  }

  private renderObjectives(): void {
    const state = runtime.simulation.state;
    const objective = OBJECTIVES[Math.min(state.objectiveIndex, OBJECTIVES.length - 1)];
    const complete = state.flags.autonomousLoop;
    this.setHtml(
      "objectives",
      `<button class="panel-tab" data-action="toggle-objective">BOOTSTRAP OBJECTIVE <span>${this.objectiveCollapsed ? "+" : "−"}</span></button>
       ${
         this.objectiveCollapsed
           ? ""
           : `<div class="objective-content ${complete ? "complete" : ""}">
                <div class="objective-index">${String(state.objectiveIndex + 1).padStart(2, "0")} / ${OBJECTIVES.length}</div>
                <h2>${complete ? "Autonomous Loop Established" : escapeHtml(objective?.title ?? "")}</h2>
                <p>${complete ? "The colony can now mine, refine, and store iron without individual orders." : escapeHtml(objective?.detail ?? "")}</p>
                <div class="objective-track"><i style="width:${((state.objectiveIndex + (complete ? 1 : 0)) / OBJECTIVES.length) * 100}%"></i></div>
              </div>`
       }`,
    );
  }

  private renderBuildPanel(): void {
    const simulation = runtime.simulation;
    const seed = simulation.seed;
    const buildingButtons = (Object.entries(BUILDINGS) as Array<[BuildingTypeId, (typeof BUILDINGS)[BuildingTypeId]]>)
      .map(([type, definition]) => {
        const unlocked = simulation.state.unlocks.includes(definition.unlockId);
        const affordable = Object.entries(definition.cost).every(
          ([itemId, quantity]) =>
            itemCount(seed.inventory, itemId as ItemId) - itemCount(seed.reservedInventory, itemId as ItemId) >= quantity,
        );
        const selected = runtime.placementType === type;
        return `<button class="build-card ${selected ? "selected" : ""}" data-action="place" data-building="${type}" ${
          !unlocked || !affordable ? "disabled" : ""
        }>
          <span class="blueprint-preview ${type}"><i></i></span>
          <span><b>${escapeHtml(definition.name)}</b><small>${unlocked ? costLabel(definition.cost) : "LOCKED // Research required"}</small></span>
        </button>`;
      })
      .join("");
    this.setHtml(
      "build-panel",
      `<div class="panel-heading"><span>CONSTRUCTION</span><small>SEED BLUEPRINTS</small></div>
       <div class="build-list">${buildingButtons}
         <button class="build-card future" disabled><span class="blueprint-preview"><i></i></span><span><b>Assembler</b><small>FUTURE RESEARCH</small></span></button>
       </div>`,
    );
  }

  private renderSelection(): void {
    const entity = runtime.simulation.getEntity(runtime.selectedId);
    if (!entity) {
      this.setHtml(
        "selection-panel",
        `<div class="panel-heading"><span>INSPECTOR</span><small>NO SELECTION</small></div>
         <div class="empty-selection"><div class="reticle"></div><p>Select a bot, structure, resource, or tile.</p></div>`,
      );
      return;
    }
    if (entity.kind === "bot") this.renderBotSelection(entity);
    else if (entity.kind === "building") this.renderBuildingSelection(entity);
    else this.renderDepositSelection(entity);
  }

  private renderBotSelection(bot: BotEntity): void {
    const program = bot.program;
    const taskProgress = bot.task.duration > 0 ? progress(bot.task.progress, bot.task.duration) : "";
    const programRows = program
      ? `<div class="program-list">${program.commands
          .map(
            (command, index) => `<div class="program-row ${index === program.currentStep ? "active" : ""}">
              <span>${String(index + 1).padStart(2, "0")}</span><b>${escapeHtml(command.label)}</b>
              <button data-action="program-up" data-index="${index}" aria-label="Move command up">↑</button>
              <button data-action="program-down" data-index="${index}" aria-label="Move command down">↓</button>
            </div>`,
          )
          .join("")}</div>`
      : "";
    this.setHtml(
      "selection-panel",
      `<div class="panel-heading"><span>UNIT INSPECTOR</span><small>${escapeHtml(bot.id)}</small></div>
       <div class="entity-title bot-title"><i></i><div><h2>${escapeHtml(bot.name)}</h2><p>${bot.frame === "seed" ? "VON NEUMANN SEED" : "BASIC UTILITY FRAME"}</p></div></div>
       <section class="readout">
         <label>BATTERY <b>${bot.battery.toFixed(1)} / ${bot.maxBattery}</b></label>${progress(bot.battery, bot.maxBattery)}
         <label>CARGO <b>${inventoryTotal(bot.inventory)} / ${bot.inventoryCapacity}</b></label><div class="item-row">${itemRows(bot.inventory)}</div>
         ${
           inventoryTotal(bot.reservedInventory) > 0
             ? `<label>RESERVED / NOT AVAILABLE</label><div class="item-row reserved">${itemRows(bot.reservedInventory)}</div>`
             : ""
         }
         <label>MODULES</label><div class="tag-row">${bot.modules.map((module) => `<span>${escapeHtml(module)}</span>`).join("") || '<span class="muted">none</span>'}</div>
       </section>
       <section class="status-block ${bot.blockingReason ? "blocked" : ""}">
         <small>CURRENT TASK</small><strong>${escapeHtml(bot.task.label)}</strong>${taskProgress}
         <p>${escapeHtml(bot.status)}</p>
         ${bot.blockingReason ? `<em>${escapeHtml(bot.blockingReason)}</em>` : ""}
         ${bot.task.destination ? `<small>DESTINATION // ${bot.task.destination.x.toFixed(1)}, ${bot.task.destination.y.toFixed(1)}</small>` : ""}
       </section>
       ${
         bot.frame === "utility"
           ? `<section><div class="section-title">ORDERED PROGRAM</div>
               <div class="button-grid">
                 ${button("IRON MINER", "assign-program", { data: 'data-program="ironMiner"', className: program?.templateId === "ironMiner" ? "active" : "" })}
                 ${button("FACTORY HAULER", "assign-program", { data: 'data-program="factoryHauler"', className: program?.templateId === "factoryHauler" ? "active" : "" })}
                 ${program?.running ? button("STOP PROGRAM", "stop-program", { className: "danger" }) : ""}
               </div>
               ${programRows}
               ${program?.blockedReason ? `<p class="blocking-copy">${escapeHtml(program.blockedReason)}</p>` : ""}
             </section>`
           : ""
       }`,
    );
  }

  private renderBuildingSelection(building: BuildingEntity): void {
    const definition = BUILDINGS[building.type];
    const researchNode = building.activeResearchId ? runtime.simulation.state.research[building.activeResearchId] : undefined;
    const researchDefinition = building.activeResearchId ? RESEARCH[building.activeResearchId] : undefined;
    const requests = Object.values(runtime.simulation.state.logisticsRequests).filter(
      (request) => request.buildingId === building.id && request.active,
    );
    this.setHtml(
      "selection-panel",
      `<div class="panel-heading"><span>STRUCTURE INSPECTOR</span><small>${escapeHtml(building.id)}</small></div>
       <div class="entity-title building-title ${building.type}"><i></i><div><h2>${escapeHtml(building.name)}</h2><p>${escapeHtml(definition.description)}</p></div></div>
       ${
         building.complete
           ? `<section class="readout">
                <label>INPUT / STORAGE</label><div class="item-row">${itemRows(building.input)}</div>
                ${definition.outputCapacity > 0 ? `<label>OUTPUT</label><div class="item-row">${itemRows(building.output)}</div>` : ""}
                <label>POWER <b>${Math.floor(building.power)}%</b></label>${progress(building.power, 100)}
              </section>`
           : `<section class="readout"><label>CONSTRUCTION</label>${progress(building.constructionProgress, 1)}
                <div class="item-row">${itemRows(building.constructionInventory)}</div></section>`
       }
       ${
         building.type === "furnace"
           ? `<section class="readout"><label>RECIPE <b>IRON ORE → IRON INGOT</b></label>${progress(
               building.productionProgress,
               RECIPES.furnaceIron.duration,
             )}</section>`
           : ""
       }
       ${
         researchNode && researchDefinition
           ? `<section class="research-active">
                <div class="section-title">ACTIVE RESEARCH</div>
                <h3>${escapeHtml(researchDefinition.name)}</h3>
                ${progress(researchNode.progress, researchDefinition.duration)}
                <p>Operator: ${escapeHtml(building.operatorId ?? "none")}</p>
                <div class="item-row">${itemRows(building.researchHold)}</div>
                <small>${researchNode.blockingReason ? `PAUSED // ${escapeHtml(researchNode.blockingReason)}` : `${Math.ceil(
                    researchDefinition.duration - researchNode.progress,
                  )}s remaining`}</small>
              </section>`
           : ""
       }
       ${
         building.type === "botCradle" && building.cradleQueued
           ? `<section class="readout"><label>BOT ASSEMBLY</label>${progress(building.productionProgress, RECIPES.utilityBot.duration)}</section>`
           : ""
       }
       <section class="status-block ${building.blockingReason ? "blocked" : ""}">
         <small>OPERATING STATE</small><strong>${escapeHtml(building.status)}</strong>
         ${building.blockingReason ? `<em>${escapeHtml(building.blockingReason)}</em>` : ""}
       </section>
       ${
         requests.length
           ? `<section><div class="section-title">LOGISTICS REQUESTS</div>${requests
               .map(
                 (request) =>
                   `<div class="request-row"><span>${escapeHtml(request.label)}</span><b>${request.claimedBy ? `CLAIMED ${escapeHtml(request.claimedBy)}` : "OPEN"}</b></div>`,
               )
               .join("")}</section>`
           : ""
       }`,
    );
  }

  private renderDepositSelection(deposit: SelectableEntity & { kind: "deposit" }): void {
    this.setHtml(
      "selection-panel",
      `<div class="panel-heading"><span>SURVEY RECORD</span><small>${escapeHtml(deposit.id)}</small></div>
       <div class="entity-title deposit-title"><i style="--ore:${colorHex(ITEMS[deposit.itemId].color)}"></i><div><h2>${escapeHtml(deposit.name)}</h2><p>EXPOSED ${escapeHtml(
         ITEMS[deposit.itemId].name,
       ).toUpperCase()}</p></div></div>
       <section class="readout"><label>ESTIMATED YIELD <b>${deposit.remaining}</b></label>${progress(deposit.remaining, 80)}</section>
       <section class="status-block"><small>RESERVATION</small><strong>${deposit.reservedBy ? `CLAIMED BY ${escapeHtml(deposit.reservedBy)}` : "AVAILABLE"}</strong></section>`,
    );
  }

  private renderCommandDock(): void {
    const entity = runtime.simulation.getEntity(runtime.selectedId);
    let actions = "";
    if (entity?.kind === "bot" && entity.frame === "seed") {
      actions = `
        ${button(entity.solarDeployed ? "RETRACT SOLAR" : "DEPLOY SOLAR", "solar", { className: entity.solarDeployed ? "active" : "" })}
        ${button("MINE IRON", "mine", { data: 'data-item="ironOre"' })}
        ${button("MINE COPPER", "mine", { data: 'data-item="copperOre"' })}
        ${button("SMELT Fe", "craft", { data: 'data-recipe="microIron"' })}
        ${button("SMELT Cu", "craft", { data: 'data-recipe="microCopper"' })}
        <span class="dock-divider"></span>
        ${button("FRAME", "craft", { data: 'data-recipe="structuralFrame"' })}
        ${button("MOTOR", "craft", { data: 'data-recipe="simpleMotor"' })}
        ${button("BATTERY", "craft", { data: 'data-recipe="basicBattery"' })}
        ${button("CONTROLLER", "craft", { data: 'data-recipe="controller"' })}
      `;
    } else if (entity?.kind === "building") {
      if (!entity.complete) {
        actions += button("RESUME CONSTRUCTION", "construct-site");
      } else {
        if (entity.type === "furnace") {
          actions += button("SUPPLY INPUT", "supply-building");
          actions += button("COLLECT OUTPUT", "collect-building");
        }
        if (entity.type === "storage") actions += button("DEPOSIT SEED CARGO", "deposit-storage");
        if (entity.type === "researchBench") {
          actions += button("RESEARCH TREE", "toggle-research", { className: this.researchOpen ? "active" : "" });
          actions += button("COLLECT RETURNED ITEMS", "collect-building");
          if (entity.activeResearchId) actions += button("CANCEL RESEARCH", "cancel-research", { className: "danger" });
        }
        if (entity.type === "botCradle") actions += button("BUILD UTILITY BOT", "build-bot");
      }
    } else {
      actions = `<span class="dock-message">SELECT THE SEED DRONE OR A COMPLETED STRUCTURE FOR COMMANDS</span>`;
    }
    this.setHtml(
      "command-dock",
      `<span class="dock-label">COMMAND</span><div class="dock-actions">${actions}</div>
       <div class="dock-system">${button("SAVE", "save")}${button("LOAD", "load", { disabled: !localStorage.getItem(SAVE_KEY) })}${button(
         "DEBUG",
         "debug",
         { className: runtime.simulation.state.debug ? "active" : "" },
       )}${button("BUILD", "mobile-panel", { data: 'data-panel="build"', className: "mobile-toggle" })}${button(
         "INSPECT",
         "mobile-panel",
         { data: 'data-panel="selection"', className: "mobile-toggle" },
       )}</div>`,
    );
  }

  private renderResearchDrawer(): void {
    const drawer = document.querySelector<HTMLElement>("#research-drawer");
    if (!drawer) return;
    drawer.classList.toggle("hidden", !this.researchOpen);
    if (!this.researchOpen) return;
    const bench =
      runtime.simulation.getEntity(runtime.selectedId)?.kind === "building" &&
      (runtime.simulation.getEntity(runtime.selectedId) as BuildingEntity).type === "researchBench"
        ? (runtime.simulation.getEntity(runtime.selectedId) as BuildingEntity)
        : runtime.simulation.findBuilding("researchBench");
    const cards = (Object.entries(RESEARCH) as Array<[ResearchId, (typeof RESEARCH)[ResearchId]]>)
      .map(([id, definition]) => {
        const node = runtime.simulation.state.research[id];
        const prerequisitesMet = definition.prerequisites.every((researchId) => runtime.simulation.state.research[researchId].completed);
        const required = Object.fromEntries(definition.requiredItems.map((itemId) => [itemId, 1])) as Inventory;
        const itemsPresent = definition.requiredItems.every(
          (itemId) => itemCount(runtime.simulation.seed.inventory, itemId) >= 1,
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
                ? "AVAILABLE"
              : itemsPresent
                ? "READY"
                : "MISSING ITEMS";
        return `<article class="research-card ${state.toLowerCase().replace(" ", "-")}">
          <div class="research-state">${state}</div>
          <h3>${escapeHtml(definition.name)}</h3>
          <p>${escapeHtml(definition.description)}</p>
          <div class="research-items">${definition.requiredItems
            .map(
              (itemId) =>
                `<span class="${itemCount(runtime.simulation.seed.inventory, itemId) > 0 ? "owned" : ""}">${escapeHtml(
                  ITEMS[itemId].name,
                )} ×1</span>`,
            )
            .join("")}</div>
          <small>${definition.duration}s · Bench tier ${definition.benchTier} · Items ${definition.consumeItems ? "consumed" : "returned"}</small>
          ${progress(node.progress, definition.duration)}
          ${button("BEGIN RESEARCH", "research", {
            data: `data-research="${id}" data-cost="${escapeHtml(costLabel(required))}"`,
            disabled: !bench || node.completed || !!definition.disabled || !prerequisitesMet || !itemsPresent || !!bench.activeResearchId,
          })}
        </article>`;
      })
      .join("");
    drawer.innerHTML = `<div class="drawer-heading"><div><small>PHYSICAL SYSTEMS ANALYSIS</small><h2>RESEARCH TREE</h2></div><button data-action="toggle-research">×</button></div>
      <p class="drawer-note">Research reserves exactly one real example of every listed item. Progress requires the Seed Drone to remain at the bench.</p>
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
        ? `PLACE ${BUILDINGS[runtime.placementType!].name.toUpperCase()} // CLICK OR TAP`
        : `INVALID // ${runtime.placementReason || "MOVE POINTER OVER PLAYFIELD"}`;
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
    const reservedResearch = Object.values(state.research).flatMap((node) => node.reservedItemRefs);
    element.textContent = [
      "DEBUG // AUTHORITATIVE SIMULATION",
      `tick ${state.tick} | fixed ${10 * state.speed} steps/s | time ${state.gameTime.toFixed(1)}s | speed ${state.speed}x`,
      `tile ${runtime.hoverTile ? `${runtime.hoverTile.x},${runtime.hoverTile.y}` : "—"} | selected ${selected?.id ?? "—"}`,
      `objective ${state.objectiveIndex + 1}/${OBJECTIVES.length} | ${state.flags.autonomousLoop ? "MILESTONE COMPLETE" : "ACTIVE"}`,
      `requests ${activeRequests.length} | claims ${Object.keys(state.reservations).length} | research refs ${reservedResearch.length}`,
      ...activeRequests.slice(0, 5).map(
        (request) => `${request.id} :: ${request.claimedBy ? `CLAIM ${request.claimedBy}` : "OPEN"} x${request.quantity}`,
      ),
      ...reservedResearch.slice(0, 4).map((reservation) => `RESEARCH :: ${reservation.itemId} x1 @ ${reservation.holderId}`),
    ].join("\n");
  }

  private handleClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target || target instanceof HTMLButtonElement && target.disabled) return;
    const action = target.dataset.action;
    const simulation = runtime.simulation;
    const selected = simulation.getEntity(runtime.selectedId);
    if (action === "pause") simulation.togglePause();
    if (action === "speed") simulation.setSpeed(Number(target.dataset.speed) as 1 | 2 | 4);
    if (action === "toggle-objective") this.objectiveCollapsed = !this.objectiveCollapsed;
    if (action === "mobile-panel") {
      const requested = target.dataset.panel as "build" | "selection";
      this.mobilePanel = this.mobilePanel === requested ? undefined : requested;
      document.querySelector("#build-panel")?.classList.toggle("mobile-open", this.mobilePanel === "build");
      document.querySelector("#selection-panel")?.classList.toggle("mobile-open", this.mobilePanel === "selection");
    }
    if (action === "place") {
      runtime.placementType = target.dataset.building as BuildingTypeId;
      runtime.placementTile = undefined;
    }
    if (action === "solar") simulation.commandSolar();
    if (action === "mine") simulation.commandMine(target.dataset.item as "ironOre" | "copperOre");
    if (action === "craft") simulation.commandCraft(target.dataset.recipe as keyof typeof RECIPES);
    if (action === "construct-site" && selected?.kind === "building") simulation.commandConstructSite(selected.id);
    if (action === "supply-building" && selected?.kind === "building") simulation.commandSupplyBuilding(selected.id);
    if (action === "collect-building" && selected?.kind === "building") simulation.commandCollectBuilding(selected.id);
    if (action === "deposit-storage" && selected?.kind === "building") simulation.commandDepositToStorage(selected.id);
    if (action === "toggle-research") this.researchOpen = !this.researchOpen;
    if (action === "research") {
      const bench = selected?.kind === "building" && selected.type === "researchBench" ? selected : simulation.findBuilding("researchBench");
      if (bench) {
        simulation.commandResearch(target.dataset.research as ResearchId, bench.id);
        this.researchOpen = false;
        runtime.selectedId = bench.id;
      }
    }
    if (action === "cancel-research" && selected?.kind === "building") simulation.cancelResearch(selected.id);
    if (action === "build-bot" && selected?.kind === "building") simulation.commandBuildBot(selected.id);
    if (action === "assign-program" && selected?.kind === "bot") {
      simulation.assignProgram(selected.id, target.dataset.program as "ironMiner" | "factoryHauler");
    }
    if (action === "stop-program" && selected?.kind === "bot") simulation.stopProgram(selected.id);
    if ((action === "program-up" || action === "program-down") && selected?.kind === "bot") {
      simulation.reorderProgram(selected.id, Number(target.dataset.index), action === "program-up" ? -1 : 1);
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
