# Bootstrap baseline acceptance

## Scope

This run validates Milestone 1 only: landing, solar recharge, iron mining,
micro-smelting, and construction of the first Field Storage Platform. It does
not validate research, dedicated industry, utility bots, or automation.

- Run date: 2026-08-14
- Pull request: #17 (`agent/phaser-browser-foundation`)
- Starting commit: `7a22a8dac4646900c4d30d0c9b006bb068629698`
- Browser: headless Chromium, 1440 x 900
- Simulation speed: 4x after initial load

## Fresh-save sequence

1. Cleared browser local storage and reloaded the game.
   - The Seed Drone started at 12% battery with empty cargo.
   - Iron ore, iron ingots, copper ore, copper ingots, and components all
     displayed zero.
   - The first objective was `Wake the Seed`.
2. Selected 4x speed and issued `Deploy Solar`.
   - Battery charge increased past 28%.
   - The inspector reported that movement was locked while the solar array was
     deployed.
   - The objective advanced to `First Matter`.
3. Retracted solar and issued `Mine Iron`.
   - The Seed Drone travelled from the landing area to Ferric Outcrop A before
     mining.
   - Cargo reached 8/8 with eight Iron Ore.
   - The drone stopped with the visible reason `Cargo capacity reached`.
   - The objective advanced to `Shape the Ore`.
4. Issued `Smelt Fe` twice.
   - Cargo changed from eight Iron Ore to six Iron Ore and two Iron Ingots.
   - The objective advanced to `A Permanent Foothold`.
   - The Field Storage blueprint became available.
5. Selected Field Storage and placed its isometric footprint near the landing
   area.
   - The Seed Drone travelled to the construction access point.
   - Two Iron Ingots were reserved, delivered, and removed from cargo during
     construction.
   - Construction completed over simulation time.
   - The structure inspector showed an idle, completed Field Storage Platform.
   - The objective advanced to `Second Metal`, completing Milestone 1.

Result: **PASS**

The initial and completed states were inspected by screenshot. The playfield,
objective panel, construction panel, inspector, resource strip, and command
dock remained readable throughout the sequence.

The managed test environment blocked the optional Google Fonts stylesheet and
logged `ERR_NETWORK_ACCESS_DENIED`. Local font fallbacks rendered correctly,
and no application JavaScript exceptions were observed.

## Research behavior audit

The current implementation does not consume research items in the opening
scenario:

- Research definitions list distinct item IDs, and the reservation command
  converts each ID to a quantity of exactly one.
- The Seed Drone reserves those items in cargo while travelling to the bench.
- On delivery, they move into the bench's `researchHold` inventory and remain
  unavailable while analysis is active.
- Completion removes each item from `researchHold` and places it in the bench
  output whenever `consumeItems` is false.
- Every current research definition, including disabled future placeholders,
  sets `consumeItems: false`.
- Dedicated Smelting uses one Iron Ore and one Iron Ingot for 12 seconds.
- Basic Utility Bot Systems uses one each of Structural Frame, Simple Motor,
  Basic Battery, and Controller for 22 seconds.
- Existing tests cover exact-one reservation, operator-dependent progress, and
  returned items.

The implementation therefore matches the current research contract. The
earlier description of the game as having "item-consuming research" was
incorrect; no research-system redesign is required for this baseline.
