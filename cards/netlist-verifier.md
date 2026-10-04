# netlist-verifier

The `/verify` page: the schematic picture with one net of `netlist.json` highlighted, so a person can confirm the transcription net by net.

## Pieces

| File | Role |
|------|------|
| `tools/trace_schematic.py` | Reads `pics/schematic.png`, traces the wire runs, writes `schematic-map.json`. Run with `make trace`. Needs `requirements-dev.txt` (numpy, pillow). |
| `schematic-map.json` | Generated, committed. `size`, `pins` (name to `[x, y]` in image pixels) and `wires` (one entry per traced group: `net`, `pins`, `segs` as `[x1, y1, x2, y2]`). |
| `static/verify.html`, `static/verify.js` | The page. An SVG with the picture, a white veil, the highlight, and a clickable circle on every pin. |

The page uses the same websocket as the planner. It reads `netlist` and the `verified` flags from
the snapshot and sends the `verify` op, so a tick made here shows up in the planner and the other way round.

## Two sources, shown separately

- The **netlist** decides which pins get a ring and a label.
- The **trace** decides which wire runs are drawn.

They are independent, so a mismatch is visible instead of hidden:

- A dashed ring means the netlist has the pin in this net but no traced wire reaches it.
- A grey dashed ring means the traced wire reaches a pin of a part that is left off the board.
- The same findings are listed as text above the net list, and the net shows "check" in the list.
- Pins joined inside a part (`internal` in the netlist) are not expected to be reached by a wire.

## How the trace decides what is joined

The Fritzing picture draws wires as straight blue or red runs about 9 px thick.

1. Mask the wire colours; collect horizontal and vertical runs longer than 16 px and merge them into bars.
2. Drop bars thicker than 13 px (part artwork) or shorter than 24 px (pin pad outlines).
3. A horizontal and a vertical bar are joined when one of them ends at the other (corner or T). Two bars that cross through each other are not joined.
4. Bars that come within 16 px of the same pin are joined there.
5. A group is given the net its pins have in `netlist.json`. A group whose pins are in two nets is reported as `DISAGREE`.

Pin positions are a hand-measured table in the script, named as in `netlist.json`, plus the pins of
the parts that are on the picture but left off the board.

## Known findings of the trace

- `R2.1`: the stub between R3 and R2 is too short to be detected, so no wire reaches it. It is in VSENSE by circuit logic.
- `ESP.GND2`: no wire in the picture; it is joined to `ESP.GND` inside the ESP32 board.
- `BUZ.+` and `Q1.E` hang on the 5V and GND wires in the picture; those parts are left off the board.

## When to re-run the trace

After replacing `pics/schematic.png`, or after renaming pins or nets in `netlist.json` (the map
stores net names). The script prints `CHECK` and `DISAGREE` lines; only the findings above are expected.

## Keys

Up/Down step through the nets, Space ticks the selected net, Esc clears the selection, +/- zoom.
