# Bot Colony — 1990s Isometric Tycoon Slice

Bot Colony is an isometric browser factory-management prototype about a self-replicating von Neumann probe. The Seed Drone lands with no stored resources and bootstraps a physical iron-production loop from sunlight and local ore.

This implementation uses Phaser 3, strict TypeScript, Vite, a deterministic fixed-step simulation, committed pixel-sprite atlases, and a DOM tycoon interface. The simulation owns all authoritative/saveable state; Phaser only renders and translates pointer input.

## Run

```powershell
npm.cmd install
npm.cmd run assets:generate
npm.cmd run dev
```

Open the local URL printed by Vite. For a production check:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

## Opening loop

1. Select the Seed Drone and deploy its solar array.
2. Retract solar, mine iron, and micro-smelt the first ingots.
3. Place and physically construct Field Storage.
4. Mine copper, refine it, and construct a Research Bench.
5. Deliver one Iron Ore and one Iron Ingot to research Dedicated Smelting.
6. Build and supply the unlocked Basic Furnace.
7. Fabricate one Frame, Motor, Battery, and Controller; research Basic Utility Bot Systems.
8. Build a Bot Construction Cradle and activate Utility Bots.
9. Assign one bot the Iron Miner program. Let furnace output fill to expose the bottleneck.
10. Assign a second bot Factory Hauler to close the deposit → furnace → storage loop.

The exact provisional recipes are shown in the UI and are intentionally compact for this foundation.

## Controls

- Click/tap: select or place
- Drag: pan camera
- Mouse wheel/pinch: zoom
- Right click or Escape: cancel placement
- Space: pause/resume
- `1`, `2`, `3`: normal, 2×, 4× simulation speed
- `D`: debug overlay

Save and Load store the plain simulation snapshot in browser local storage.

## Visual pipeline

- `docs/art-direction.md` defines the shipped projection, palette, lighting, anchors, animation, UI, and scaling rules.
- `scripts/generate-pixel-assets.mjs` deterministically rebuilds the original PNG sprite atlases without external art services.
- `src/game/assets/manifest.ts` owns stable texture keys, frame numbers, anchors, zoom steps, and state-to-frame mapping.
- `public/assets/sprites/` contains the committed runtime atlases.
- `docs/screenshots/90s-tycoon-slice/` contains the desktop and mobile visual-QA evidence for the opening slice.

## Code map

- `src/data/content.ts` — items, recipes, blueprints, research, objectives
- `src/simulation/` — inventories, tasks, research, production, logistics, programs, save state
- `src/game/` — isometric projection, asset manifest, and Phaser sprite rendering/input
- `src/ui/` — responsive retro-industrial management UI
- `src/tests/` — projection, inventory, resource flow, research, logistics, persistence, and visual-state tests

## Repository transition

The earlier Godot prototype is preserved in Git history only. This branch contains no Godot scenes, GDScript, or Godot project metadata.
