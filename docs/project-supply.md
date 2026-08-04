# Automated Project Supply

Automated Project Supply extends the existing logistics interpreter without automating player intent or skilled Seed labor. The player chooses a construction site or research node. A Utility Bot can move the requested physical items, but the Seed Drone remains the constructor and Research Bench operator.

## Construction projects

Placing an unlocked blueprint validates and blocks its footprint immediately, creates an incomplete site, records the full recipe, and opens one request per missing item type. Placement does not spend Seed cargo. Each site row reports required, delivered, reserved-at-source, in-transit, and missing quantities.

`Supply and Construct` preserves the bootstrap route. If the Seed carries every still-missing item, it reserves that cargo, follows the shared A* route to the site, delivers it, and begins labor once the site is ready. If bots already supplied everything, the same action sends the Seed to perform labor only. Delivered material remains at the site until construction completes.

Cancelling an incomplete site releases bot claims and Seed reservations, moves delivered material into the cancelled site's output bay, and only then unblocks the footprint. The recovery cache exposes ordinary output requests, so a compatible Factory Hauler program or the Seed can recover the salvage.

## Research projects

Selecting an available node assigns it to one completed Research Bench and opens one request for each distinct missing example. Research does not progress until every example is physically present and the Seed reaches the operator point. A supplied bench reports `Ready: Awaiting operator`.

The Seed consumes its own energy and bench power while operating. Completion unlocks the result and moves non-consumed examples to bench output. Cancellation returns delivered examples to the same physical output. Ordinary output requests allow a Factory Hauler whose output filter is set to `Any output item` to return those examples to Field Storage.

`Project Coordination` is the post-bot demonstration node. It requires one Structural Frame, one Controller, and one Copper Ingot, runs longer than Basic Utility Bot Systems, returns all three examples, and unlocks player-facing High, Normal, and Low project priorities.

## Request accounting and selection

The simulation derives each outstanding quantity as:

`missing = required - delivered - reserved at source - in transit`

A cargo-limited claim reserves only what the bot can carry. After a partial delivery, the same per-item request reopens for the exact remainder. No two source reservations can claim the same available quantity.

Requests sort by High, Normal, then Low; oldest open time; lowest feasible combined path cost; and stable request ID. For each request, source candidates sort by available unreserved quantity, reachable route, combined path cost, and stable entity ID. Unreachable stock is never selected merely because it is geometrically near.

## Persistence and diagnostics

Save version 3 stores project recipes, destination inventories, priorities, requests, claims, reservations, in-transit cargo, supplier instruction pointers, cancellation recovery, new objective progress, and Project Coordination. Restore validation releases references whose bot, source, destination, request, reserved stock, or carried cargo no longer exists. Valid snapshots resume unchanged.

Debug mode lists project requests and quantities, priorities, project inventories, the selected Supplier's instruction pointer and path state, and recent claim-release events. These diagnostics do not own or mutate gameplay state.
