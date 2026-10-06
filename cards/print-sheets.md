# print-sheets

The `/print` page: paper sheets to solder from, drawn on white and enlarged to fill A4 portrait.

## Sheets

1. **Solder side**, seen from below and mirrored. Solder runs are dark; heavy-current runs are black and thicker. Jumper wires and component outlines are dashed, because they are on the other side.
2. **Component side**, seen from above. Components are filled, jumper wires are coloured and tagged W1, W2 ... Solder runs are pale grey.
3. **Wiring lists**, in two columns, flowing onto more pages as needed:
   - one table per off-board connector: pin, wire colour, hole to solder to, net
   - jumper wires: tag, from, to, colour, net, HEAVY mark
   - component legs: part, pin, hole, net
   - ESP32 socket pins in use: pin, hole, net
   - solder runs: net, path as corner points, HEAVY mark
   - continuity check: per net, the pins (with holes) that must beep together

Every row starts with a tick box. Holes are named row letter + column number (`R05`), edge pads `top pad 07`, rails `rail by column 01`.

## What is deliberately different from the planner

- No connector cables are drawn. On paper they hide the pads. Each wire's pad is a dot in the wire's colour with a label (`M1.8`, or `SCL` for a connector with a long name), solid on the solder side and dashed on the component side.
- ESP32 pin names are outside the socket outline, because the pads between the pin rows are used for connector wires.
- No net colours. Rings around component pins are black.
- The scale is whatever fills the page (about 8.5 mm per hole on A4), not 1:1.

## How it works

`static/print.js` opens the same websocket as the planner, takes the snapshot (`state`, `netlist`, `check`) and redraws on every later snapshot, so an open print page follows edits. It sends nothing. The drawing code is its own, simpler renderer; it shares only the geometry rules (node positions, mirroring, pin order by footprint offset) with `static/app.js`, so a change to those rules must be made in both files.

Heavy marks come from `check.heavy`, a list of link ids computed on the server from the netlist's `heavy_paths`.

Print styles are inside `static/print.html`: `@page` A4 portrait with 10 mm margins, one drawing per page (`.sheet.drawing` is 276 mm high in print), the toolbar hidden.

## Not verified

The sheets were checked on screen only. Page breaks and the size on paper have not been checked with a real print or PDF.
