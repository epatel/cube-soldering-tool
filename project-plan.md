# Project plan

Every agent reads this first and updates "Current state" before finishing.
Update status in place; append to Decisions and Open questions.

## Goal

Plan the hand-soldering of the ESP32 balancing-cube electronics on one 5x7 cm perfboard: place
the parts, lay the solder paths and wires as seen from below, and prove against the schematic
that everything that should be joined is joined and nothing else is.

## Non-goals

- Autorouting or automatic placement.
- A general PCB or schematic editor. The netlist is edited as a JSON file.
- Multi-user or remote hosting. It is a local, single-user tool.
- Exporting Gerbers or any manufacturing file.

## Milestones

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Netlist transcribed from `pics/schematic.png` | done (2026-10-04), awaiting the user's per-net verification |
| 2 | Server, persistence, websocket, connectivity check with tests | done (2026-10-04) |
| 3 | Interactive board page: move parts, solder, wire, erase, undo, ratsnest, flip view | done (2026-10-04) |
| 4 | User verifies all 20 nets against the schematic (tick boxes, `/verify` page) | open |
| 5 | User lays out the real board until `make check` reports 20/20 and 0 shorts | done (2026-10-04): 20/20, 0 shorts |
| 6 | Netlist verifier page with schematic overlay | done (2026-10-04) |

## Decisions

- 2026-10-04: Server owns the state; the page is a view. See `cards/server-owns-state.md`.
- 2026-10-04: aiohttp serves both HTTP and the websocket in one process. No JS dependencies, no build step.
- 2026-10-04: Coordinates are stored as seen from the component side; only the drawing mirrors them.
- 2026-10-04: ESP32 pin rows are 10 holes apart (user confirmed 25.4 mm).
- 2026-10-04: Battery and ESP32 use connectors; motors and MPU-6050 are loose wires to pads; the rest is soldered in (user's choice).
- 2026-10-04: The buzzer, its transistor Q1 and base resistor R4 are dropped from the board (user's change to the schematic). ESP.D27 is unused.
- 2026-10-04: Motors and MPU-6050 are drawn as off-board connectors beside the board with coloured wires to their pads (pin 8 red, pin 7 black). Ratsnest is off by default. Resistors are at least 4 holes long, the ceramic at least 2, the electrolytic fixed on a diagonal.
- 2026-10-04: Connector cables are soldered on the solder side; jumper wires and components are on the component side. Each view fades the far side (user's choice).
- 2026-10-04: State is a JSON file with a `version` and a forward-only migration list.

## Current state

Working end to end and committed on `main`. The user's layout is saved in `data/state.json`
(20/20 nets joined, 0 shorts) with a backup in `data/backups/`. 18 unit tests pass.
The verifier page at `/verify` is built and committed.

A re-run of the wire trace agrees with the netlist except for the known soft spots (R2.1, ESP.GND2).

Next: the user verifies the nets on `/verify` (milestone 4).

## Open questions

- Motor cable colours after red and black are a guess (yellow, green, blue, white, orange, brown). The user should correct `wires` in `netlist.json`.
- Is the component side the silkscreen side? The page assumes so; `F` flips the view either way.
- Are the two side rails isolated from each other and from the edge pads? Assumed yes; check with a multimeter.
