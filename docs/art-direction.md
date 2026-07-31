# Bot Colony Visual Language: Bootstrap Slice

This document defines the visual rules implemented by the first isometric tycoon vertical slice. It is a production reference for this branch, not a claim that the full game's artwork is final.

## Projection and tile grid

- The simulation remains a flat logical 32×32 grid.
- The renderer uses a fixed 2:1 isometric projection with 96×48 pixel tiles.
- Tile `(x, y)` projects to `((x - y) × 48, (x + y) × 24)`.
- Terrain sprites use a center anchor at the tile diamond's center. Entity sprites use a bottom-center ground contact anchor.
- Buildings use their logical footprint origin and a documented footprint-center offset; no gameplay position is stored in a sprite.

## Sprite canvases and anchors

| Asset family | Frame canvas | Phaser origin | Ground/contact convention |
| --- | ---: | ---: | --- |
| Terrain and overlays | 96×48 | `0.5, 0.5` | diamond center |
| Seed and utility bots | 96×96 | `0.5, 0.86` | center between treads |
| Deposits | 96×96 | `0.5, 0.82` | center of outcrop shadow |
| Cargo | 32×32 | `0.5, 1` | external rear rack |
| Field Storage/support buildings | 192×128 | `0.5, 0.82` | center of footprint baseline |
| Activity effects | 48×48 | `0.5, 0.75` | action contact point |

Every animation frame in a sheet has the same canvas, scale, facing, and anchor. Transparent padding is intentional and must not be cropped independently.

## Palette and materials

The controlled palette is defined in `scripts/generate-pixel-assets.mjs`.

- Alien soil: dusty ochre, umber, clay brown, and restrained sand highlights.
- Colony machinery: cool charcoal steel, cool gray, oxidized teal, and small verdigris panels.
- Iron: rust red, hematite brown, and sparse warm mineral highlights.
- Copper: dark teal-green with copper-orange exposed faces.
- Signals: amber for operating, muted green for valid/ready, and red for warnings.
- Solar cells: deep photovoltaic blue with cool blue-gray traces.

Metal is stamped, bolted, vented, and repaired. Soil is dry, cracked, tracked, and locally scorched. Highlights are one- or two-pixel clusters; broad glossy shine and vector-style gradients are not used.

## Light, shadows, and outlines

- Key light arrives from the upper-left.
- Bright edges sit on upper and left-facing planes.
- Cast and contact shadows fall down-right.
- World silhouettes use a one- or two-pixel near-black brown outline.
- Internal machinery separations use dark steel, never pure black.
- UI focus and selection use amber; invalid placement uses brick red.

## Animation

- Machinery uses stepped sprite frames at an apparent 6–10 fps.
- Seed movement, mining, charging, smelting, and construction alternate deliberate two-frame poses.
- Solar deployment uses a four-stage unfold/retract view transition while simulation state changes remain immediate.
- Mining chips, restrained smelter heat, and construction sparks are short state-derived effects.
- Status lights may blink at 2–4 fps. Nothing bobs or pulses continuously.
- Reduced-motion mode freezes nonessential DOM transitions; world machinery still changes frames to communicate simulation state.

## Footprints and cargo

- Field Storage is a readable 2×2 diamond with its input ramp on the lower-left edge.
- Other buildings continue to respect their simulation footprints and use bottom-center anchored support sprites.
- Construction is shown in three visible stages derived from `constructionProgress`.
- Completed Field Storage has empty, partial, and full-looking frames derived from physical stored-item counts.
- Bot cargo is an external hopper/rack sprite. Iron ore, copper ore, and refined ingots use distinct frames and travel with the bot.

## Terrain dressing

- Six base soil tiles are selected deterministically from grid coordinates.
- Independent decal sprites add scorch, cracks, rocks, tread marks, survey stakes, utility plates, cable, and dust.
- The landing pad uses a scorch/debris cluster around the Seed's initial tile.
- Decoration never changes occupancy, selection, placement, or tile coordinates.

## Interface construction

- Text-heavy UI remains DOM-based.
- Panels are hard-edged stamped-metal windows with a light top/left bevel, dark bottom/right bevel, rivet details, and charcoal interiors.
- The persistent shell is one 48 px desktop toolbar, one 34 px status strip, and a compact command tray. Build, research, objectives, context, and system surfaces disclose as windows or drawers.
- Desktop normal play keeps the build palette closed and the center of the playfield clear.
- Mobile uses a 52 px resource toolbar and 74 px bottom command tray. Build and context surfaces become dismissible bottom drawers.
- UI controls intercept pointer input over their surfaces; map input remains on the Phaser canvas.

## Typography and icons

- UI labels use a bundled-free system monospace stack (`Consolas`, `Courier New`, monospace) with uppercase, compact tracking.
- Longer descriptions use the same readable stack at a relaxed line height; no remote font is loaded.
- Primary toolbar icons are 16×16 sprites from `ui-icons.png`, displayed at 16 or 32 CSS pixels with nearest-neighbor scaling.
- Command buttons pair 16×16 icons with short labels. Touch controls are at least 44 px high.

## Scaling and filtering

- Phaser runs with `pixelArt`, `roundPixels`, antialiasing disabled, and nearest-neighbor texture filtering.
- Supported camera zooms are discrete `0.5×`, `1×`, and `2×`.
- Camera scroll is rounded to whole world pixels after pan and centering.
- Desktop and mobile start at `1×`; pinch and wheel input step between supported zooms rather than applying arbitrary fractional values.
- Canvas and UI sprite CSS use `image-rendering: pixelated`.

## Naming and stable texture keys

Committed files live in `public/assets/sprites/`. Stable Phaser texture keys are declared in `src/game/assets/manifest.ts`:

- `world.terrain`
- `world.decals`
- `world.overlays`
- `bot.seed`
- `world.deposits`
- `building.storage`
- `building.support`
- `cargo.external`
- `fx.activity`
- `ui.icons`

Files use lower-case kebab names. Frame numbers and anchor offsets are centralized in the manifest; gameplay code must not embed asset paths or mutate simulation state to control sprites.
