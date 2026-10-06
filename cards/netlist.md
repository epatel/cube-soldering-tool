# netlist

`netlist.json`: the parts, their footprints and the schematic nets the board is checked against.

## Format

```json
{
  "parts": {
    "R3": { "label": "R3 33k", "kind": "resistor", "rigid": false, "color": "#d8b27a",
            "at": [2, 5], "min_len": 4, "bands": ["#f08c3a", "#f08c3a", "#f08c3a", "#c9a227"],
            "pins": { "1": [0, 0], "2": [0, 4] } },
    "MPU": { "label": "MPU-6050", "kind": "conn", "rigid": false, "at": [18, 14], "dock": [21.6, 14],
             "wires": ["#e5484d", "#2b2f36", "#f2c94c", "#3fb950"],
             "pins": { "VCC": [0, 0], "GND": [0, 1], "SCL": [0, 2], "SDA": [0, 3] } }
  },
  "internal": [["ESP.GND", "ESP.GND2"]],
  "nets": { "VSENSE": ["ESP.D34", "R3.2", "R2.1", "C2.1"] }
}
```

- `at` is the default `[col, row]` of the part; each pin is an offset from it. Coordinates are seen from the component side.
- `rigid: true` parts move as one block and must keep their footprint in one of its four 90 degree rotations (ESP32 socket, battery connector, TO-220, the electrolytic with its legs on diagonal-neighbour holes). Other parts let each pin be dragged alone.
- `min_len` (two-pin parts only) is the shortest allowed distance between the pins, in holes: 4 for the resistors, 2 for the ceramic capacitor.
- `kind` picks the drawing: `esp` (box, labels inside), `inline` (box around a row of pins), `resistor` (body with colour `bands`), `ceramic` (disc), `elec` (round can, stripe at the first pin = negative), `conn` (off-board connector).
- A `conn` part is a wire source drawn beside the board at `dock` (`[x, y]` in hole units, x outside 1..18). Its pins are the pads where its wires are soldered; each wire is drawn from the connector to its pad in the colour from `wires`. Pins and `wires` are ordered by footprint offset, not by key, because JSON keys that look like integers get re-sorted in JavaScript.
- `board.shape_problem` enforces `rigid` and `min_len` for the default layout, for every `move` op, and when a saved state is loaded: a part whose saved pins no longer fit goes back to its default position.
- A pin is named `PART.PIN`. Part ids must not contain a dot.
- `internal` lists pins joined inside a part. Both pins are also listed in the net; joining either one satisfies it.
- `heavy_paths` lists pin pairs with high current between them (battery to each motor's supply and ground pin). The links on the path between each pair are reported as heavy.
- A pin may be in at most one net. Pins in no net are "not in the schematic"; joining them to anything is a warning.

`board.load_netlist` validates all of this and raises `ValueError` on a bad file. The server
re-reads the file whenever its mtime changes; a broken edit keeps the last good netlist and shows
the error in the page. Parts added to the file appear at their default position; removed parts vanish.

## What is on the board

ESP32 DevKit 30-pin in a socket (pin rows 10 holes apart) and the battery connector are connectors.
IC1 (78xx regulator), C2 (100 nF ceramic), C3 (100 µF electrolytic), R2 and R3 are soldered in. The schematic's buzzer, its transistor Q1
and base resistor R4 are deliberately left off this board, so ESP.D27 is unused. The three Nidec 24H
motors (8 wires each) and the MPU-6050 (4 wires) are off-board connectors whose wires are soldered to pads.
Motor wire colours run red (pin 8, VBAT), black (pin 7, GND), yellow, green, blue, white, orange, brown (pin 1);
only red and black are confirmed by the user, the rest is a guess to be edited in `wires`.

## Where the nets came from

Transcribed from `pics/schematic.png` (a Fritzing breadboard drawing) by tracing the wire pixels:
straight segments were joined where one ends on another, and left apart where two merely cross.
The result matches the published pinout of this cube design: brake on D26,
battery sense on D34, and per motor PWM/DIR/ENC on 32/4/33+35, 25/15/14+13 and 18/5/17+16.

Known soft spots, flagged in the file's `notes`:
- `R2.1` is on VSENSE by circuit logic; the wire stub in the picture is too short to read.
- Motor pin numbers follow the "8 ... 1" marking in the picture.

The page has a tick box per net: the user ticks a net after comparing it with the schematic.
Ticks are stored in the state file under `verified`.
