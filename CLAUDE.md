# Cube soldering tool

A local planner for hand-soldering the ESP32 balancing-cube electronics onto a 5x7 cm perfboard
(18 columns x 24 rows). A Python aiohttp server owns the board state and serves one HTML page;
the page draws the board seen from below and sends every edit over a websocket. The server
checks what is joined on the board against the schematic netlist in `netlist.json`.

@project-plan.md

## Commands

- `make start` - serve on http://127.0.0.1:8765 (planner at `/`, netlist verifier at `/verify`)
- `make test` - unit tests (stdlib `unittest`)
- `make check` - print the schematic check for the saved board; exit code 1 while nets are open or shorted
- `make backup` - timestamped copy of `data/state.json` in `data/backups/`
- `make trace` - re-trace `pics/schematic.png` into `schematic-map.json` for the verifier
- Always use `.venv/bin/python`; never install into the system Python.

## Cards

Open a card when its trigger matches what you are about to do.

### Architecture
- [architecture](cards/architecture.md) — changing how the server, the page and the saved file talk to each other, or working out where a new feature belongs

### Domains
- [board-geometry](cards/board-geometry.md) — anything that reads or writes `[col, row]` coordinates, draws pads, mirrors the view, or touches rails and edge pads
- [netlist](cards/netlist.md) — adding or moving a part, changing a footprint or a net, or doubting whether the schematic was transcribed correctly

### Features
- [connection-check](cards/connection-check.md) — deciding whether two things count as electrically joined, or changing what the check reports as open, short or warning
- [ws-protocol](cards/ws-protocol.md) — adding an edit operation, changing a websocket message, or debugging an edit that does not stick
- [netlist-verifier](cards/netlist-verifier.md) — working on the `/verify` page, the schematic overlay, `schematic-map.json` or the wire trace of the picture

### Decisions
- [server-owns-state](cards/server-owns-state.md) — tempted to keep state in the browser, add optimistic updates, or move the check into JavaScript
- [standing-defaults](cards/standing-defaults.md) — installing a Python dependency or changing the shape of the saved state file
