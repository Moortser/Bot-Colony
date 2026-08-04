# 1990s Tycoon Slice — Visual QA

The vertical slice was exercised in Chromium against both the Vite development server and the production preview build.

## Review viewports

- Desktop: 1440×900, 1× device scale
- Mobile: 390×844, 1× device scale with touch enabled
- Reduced-motion CSS was retained for nonessential interface motion.

## Desktop state evidence

| State | Screenshot |
| --- | --- |
| Initial landing / low power | [`desktop-initial-landing.png`](screenshots/90s-tycoon-slice/desktop-initial-landing.png) |
| Solar deployed / charging | [`desktop-solar-deployed.png`](screenshots/90s-tycoon-slice/desktop-solar-deployed.png) |
| Seed moving | [`desktop-seed-moving.png`](screenshots/90s-tycoon-slice/desktop-seed-moving.png) |
| Mining with impact effect | [`desktop-mining.png`](screenshots/90s-tycoon-slice/desktop-mining.png) |
| External cargo visible | [`desktop-cargo-visible.png`](screenshots/90s-tycoon-slice/desktop-cargo-visible.png) |
| Internal micro-smelter | [`desktop-micro-smelting.png`](screenshots/90s-tycoon-slice/desktop-micro-smelting.png) |
| Storage construction start | [`desktop-storage-construction-start.png`](screenshots/90s-tycoon-slice/desktop-storage-construction-start.png) |
| Storage construction mid-stage | [`desktop-storage-construction-mid.png`](screenshots/90s-tycoon-slice/desktop-storage-construction-mid.png) |
| Storage complete and empty | [`desktop-storage-completed.png`](screenshots/90s-tycoon-slice/desktop-storage-completed.png) |
| Storage visibly occupied | [`desktop-storage-occupied.png`](screenshots/90s-tycoon-slice/desktop-storage-occupied.png) |
| Construction palette open | [`desktop-build-palette-open.png`](screenshots/90s-tycoon-slice/desktop-build-palette-open.png) |
| Context window open | [`desktop-selection-window-open.png`](screenshots/90s-tycoon-slice/desktop-selection-window-open.png) |

## Mobile evidence

| State | Screenshot |
| --- | --- |
| Normal mobile gameplay | [`mobile-gameplay-390x844.png`](screenshots/90s-tycoon-slice/mobile-gameplay-390x844.png) |
| Selection drawer open | [`mobile-selection-drawer-open.png`](screenshots/90s-tycoon-slice/mobile-selection-drawer-open.png) |
| Build drawer open | [`mobile-build-drawer-open.png`](screenshots/90s-tycoon-slice/mobile-build-drawer-open.png) |

## Checks performed

- Core sprites remained nearest-filtered and crisp at the supported default 1× zoom.
- Camera scroll and sprite positions were whole-pixel aligned in normal pan and follow-free play.
- Seed, deposits, cargo, and Field Storage maintained their bottom/ground anchors.
- Entity and selection depth order stayed correct during movement, mining, and construction.
- Field Storage visibly advanced through construction and changed when ore was deposited.
- Desktop normal play left the center clear; optional build/research/system surfaces remained closed.
- Mobile document dimensions stayed exactly 390×844 with no horizontal or vertical page overflow.
- Mobile command targets measured at least 56×62 px in the opening state.
- Open mobile drawers intercepted hit testing; clicking inside a drawer did not start placement or select the world beneath it.
- A map drag did not activate toolbar or drawer controls.
- The Seed and surrounding tiles remained visible above both mobile drawers.
- Production desktop and mobile pages booted with no application console errors; solar interaction and drawer interaction both succeeded.

The only build diagnostic is Vite's expected large-chunk warning from the Phaser bundle. No acceptance-blocking visual defect remained after the interaction-refresh fix.

## Automated Project Supply

The stacked Automated Project Supply milestone was independently played from the zero-resource landing state at 1440Ã—900, then retested at 390Ã—844. Every progression action used the shipped player interface; no simulation snapshot, console mutation, resource grant, or debug bypass was used.

| State | Screenshot |
| --- | --- |
| Fresh zero-resource landing | [`01-fresh-landing.png`](screenshots/automated-project-supply/final/01-fresh-landing.png) |
| Sustained Miner and Hauler loop | [`06-full-autonomous-loop.png`](screenshots/automated-project-supply/final/06-full-autonomous-loop.png) |
| Construction request claimed | [`20-construction-request-claimed.png`](screenshots/automated-project-supply/final/20-construction-request-claimed.png) |
| Site ready for the Seed constructor | [`08-site-ready-for-constructor.png`](screenshots/automated-project-supply/final/08-site-ready-for-constructor.png) |
| Research supply requests open | [`10-research-requests-open.png`](screenshots/automated-project-supply/final/10-research-requests-open.png) |
| Research ready for the Seed operator | [`13-research-ready-for-operator.png`](screenshots/automated-project-supply/final/13-research-ready-for-operator.png) |
| Project Coordination complete | [`14-project-coordination-complete.png`](screenshots/automated-project-supply/final/14-project-coordination-complete.png) |
| Returned example item in Hauler cargo | [`15-returned-example-hauling.png`](screenshots/automated-project-supply/final/15-returned-example-hauling.png) |
| Automation resumed after save restoration | [`17-active-automation-reloaded.png`](screenshots/automated-project-supply/final/17-active-automation-reloaded.png) |
| Mobile Supplier editor | [`18-mobile-supplier-program.png`](screenshots/automated-project-supply/final/18-mobile-supplier-program.png) |
| Mobile project requirements and priorities | [`19-mobile-project-panel.png`](screenshots/automated-project-supply/final/19-mobile-project-panel.png) |

### Checks performed

- Construction placement immediately showed footprint, access point, per-item required, delivered, reserved, in-transit, and missing quantities.
- Supplier claims, physical source pickup, delivery, ready-for-constructor state, and cancellation salvage were visible in the normal tycoon UI.
- Project Coordination visibly progressed from three open example requests to ready-for-operator, completion, returned output, and ordinary Hauler pickup.
- A save restored while automation was active; bots resumed, carried no duplicated cargo, and exposed no orphaned claim.
- Project priority controls changed through the UI after Project Coordination unlocked them.
- The mobile Supplier filter was changed through the native editor and the Hauler program was restored afterward.
- A tap inside the open mobile project drawer left the selected project unchanged, confirming that the drawer blocks world input.
- Mobile document and viewport dimensions both remained exactly 390Ã—844 with no page overflow.
- Mobile template and stop controls measured 40 px high after the QA fix; command reorder/remove controls measured 36Ã—36 px and remained separated, visible, and usable in the scrollable drawer.
- Browser console inspection returned no warnings or errors.

### Findings by severity

- Critical/high: none.
- Medium: project metadata labels were visually cramped on desktop, and program-template controls were only 30 px high on mobile. Both were fixed and retested.
- Low: no remaining gameplay or visual issue. The documented Phaser bundle-size warning remains outside this milestone's scope.
