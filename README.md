# Bot Colony Prototype (Godot 4.5.1)

## Overview
This repo contains a minimal, readable top-down colony/factory sim prototype built in Godot 4.5.1 using GDScript only. The focus is on clarity and grid-based logic rather than polish.

## File Responsibilities
- `Main.tscn`: Root scene with the required node hierarchy and UI layout.
- `scripts/main.gd`: Scene setup, input handling, UI updates, and wiring between player + sim.
- `scripts/constants.gd`: Centralized constants (item keys, smelt time, tile size, furnace cost).
- `scripts/sim.gd`: World state (resources, furnaces), ticking loop, and furnace auto-smelting logic.
- `scripts/player.gd`: Player grid movement, inventory, and mining action.
- `scripts/resource_node.gd`: Resource type/remaining count, plus simple visual color.
- `scripts/furnace.gd`: Furnace inventory and smelt progress storage.

## Smelting Loop
1. `main.gd` calls `sim.tick(delta)` every frame.
2. `sim.gd` checks each furnace:
   - If it has at least 1 coal and at least 1 ore, it increments `smelt_progress`.
   - When `smelt_progress` reaches `SMELT_TIME`, it consumes 1 coal and 1 ore and produces a plate.
3. If the furnace lacks fuel or ore, `smelt_progress` resets to 0.

While standing on a furnace tile, the sim automatically transfers the player's coal and ore into the furnace so it can smelt without extra UI steps.

## Extending Later (Bots / Modules)
- Add new units as separate scenes and register them in `sim.gd` (e.g., bots).
- Introduce a job system in `sim.gd` for mining, hauling, and fueling.
- Expand item types in `constants.gd` and add new production buildings (assemblers, crushers).
- Replace the simple auto-transfer with explicit inventory UIs or logistics modules.
