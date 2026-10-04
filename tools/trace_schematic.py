"""Trace the wires in pics/schematic.png and write schematic-map.json for the verifier page.

    .venv/bin/python tools/trace_schematic.py      (needs requirements-dev.txt)

The Fritzing picture draws wires as straight blue or red runs. Two runs are joined where one ends
on the other (corner or T); two runs that merely cross are not. Each group of joined runs is then
matched to the pins it reaches, using the hand-measured pin positions below, and compared with
netlist.json. The script prints every disagreement.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MIN_RUN = 16      # px: shorter runs are a wire's own thickness, not a wire
MAX_THICK = 13    # px: thicker blobs are part artwork, not a wire
MIN_LENGTH = 24   # px: drops the outlines of the ESP32 pin pads
END = 9           # px: how close to a run's end counts as "ends here"
PIN_REACH = 16    # px: how close a run must come to a pin to count as attached


def pin_positions():
    """Pin centres in image pixels, named as in netlist.json (plus the parts left off the board)."""
    pins = {}
    left = "EN VP VN D34 D35 D32 D33 D25 D26 D27 D14 D12 D13 GND VIN".split()
    right = "D23 D22 TX0 RX0 D21 D19 D18 D5 TX2 RX2 D4 D2 D15 GND2 3V3".split()
    for i, (a, b) in enumerate(zip(left, right)):
        pins[f"ESP.{a}"] = (894, 619 + 27 * i)
        pins[f"ESP.{b}"] = (1164, 619 + 27 * i)
    pins.update({
        "BAT.+": (138, 322), "BAT.-": (167, 322),
        "IC1.IN": (570, 295), "IC1.GND": (597, 295), "IC1.OUT": (624, 295),
        "C3.-": (706, 295), "C3.+": (732, 295),
        "BUZ.+": (814, 268), "BUZ.-": (895, 268),
        "Q1.C": (1003, 160), "Q1.E": (1030, 160), "Q1.B": (1057, 160),
        "R4.1": (1057, 323), "R4.2": (1057, 213),
        "MPU.VCC": (1243, 268), "MPU.GND": (1270, 268), "MPU.SCL": (1297, 268), "MPU.SDA": (1324, 268),
        "R3.1": (437, 592), "R3.2": (437, 700), "R2.1": (437, 727), "R2.2": (437, 835),
        "C2.1": (382, 700), "C2.2": (382, 727),
    })
    motor_x = [[130, 170, 210, 250, 293, 335, 375, 415], [778, 818, 858, 898, 940, 982, 1022, 1062],
               [1425, 1465, 1505, 1545, 1587, 1629, 1669, 1709]]
    for m, xs in enumerate(motor_x):
        for i, x in enumerate(xs):
            pins[f"M{m + 1}.{8 - i}"] = (1550 + x / 2, 376)
    return pins


def runs(mask):
    out = []
    for line in range(mask.shape[0]):
        d = np.diff(np.concatenate(([0], mask[line].astype(int), [0])))
        for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            if e - s >= MIN_RUN:
                out.append((line, int(s), int(e) - 1))
    return out


def merge(rs):
    """Join runs on neighbouring lines into (centre, start, end) bars; drop anything too thick."""
    rs.sort()
    parent = list(range(len(rs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    by_line = {}
    for i, (line, _, _) in enumerate(rs):
        by_line.setdefault(line, []).append(i)
    for i, (line, s, e) in enumerate(rs):
        for j in by_line.get(line + 1, []):
            _, s2, e2 = rs[j]
            if min(e, e2) - max(s, s2) >= MIN_RUN * 0.6:
                parent[find(i)] = find(j)
    boxes = {}
    for i, (line, s, e) in enumerate(rs):
        b = boxes.setdefault(find(i), [line, line, s, e])
        b[0], b[1], b[2], b[3] = min(b[0], line), max(b[1], line), min(b[2], s), max(b[3], e)
    return [((b[0] + b[1]) / 2, b[2], b[3]) for b in boxes.values()
            if b[1] - b[0] <= MAX_THICK and b[3] - b[2] > MIN_LENGTH]


def distance(seg, p):
    kind, centre, s, e = seg
    along, across = (p[0], p[1]) if kind == "H" else (p[1], p[0])
    gap = 0 if s <= along <= e else min(abs(along - s), abs(along - e))
    return math.hypot(gap, across - centre)


def main():
    img = np.asarray(Image.open(ROOT / "pics" / "schematic.png").convert("RGB")).astype(int)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    wire = ((b > 150) & (b > r + 60) & (g < 170)) | ((r > 120) & (g < 60) & (b < 60))
    segs = [("H",) + s for s in merge(runs(wire))] + [("V",) + s for s in merge(runs(wire.T))]

    parent = list(range(len(segs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, (k, y, x0, x1) in enumerate(segs):
        if k != "H":
            continue
        for j, (k2, x, y0, y1) in enumerate(segs):
            if k2 != "V" or not (x0 - 5 <= x <= x1 + 5 and y0 - 5 <= y <= y1 + 5):
                continue
            h_ends = abs(x - x0) <= END or abs(x - x1) <= END
            v_ends = abs(y - y0) <= END or abs(y - y1) <= END
            if h_ends or v_ends:  # corner or T; a plain crossing joins nothing
                parent[find(i)] = find(j)

    pins = pin_positions()
    reached = {}
    for name, p in pins.items():
        near = [i for i, s in enumerate(segs) if distance(s, p) <= PIN_REACH]
        for i in near[1:]:  # wires that meet at a pin are joined there
            parent[find(i)] = find(near[0])
        if near:
            reached[name] = near[0]

    groups = {}
    for name, i in reached.items():
        groups.setdefault(find(i), []).append(name)

    netlist = json.loads((ROOT / "netlist.json").read_text(encoding="utf-8"))
    pin_net = {p: net for net, ps in netlist["nets"].items() for p in ps}
    wires = []
    for root, names in groups.items():
        nets = sorted({pin_net[p] for p in names if p in pin_net})
        if len(nets) > 1:
            print(f"DISAGREE: the picture joins {', '.join(sorted(names))} but the netlist has them in {nets}")
        lines = []
        for i, (k, c, s, e) in enumerate(segs):
            if find(i) == root:
                lines.append([s, round(c), e, round(c)] if k == "H" else [round(c), s, round(c), e])
        wires.append({"net": nets[0] if len(nets) == 1 else None, "pins": sorted(names), "segs": lines})
    for net, ps in netlist["nets"].items():
        traced = {p for w in wires if w["net"] == net for p in w["pins"]}
        pieces = sum(w["net"] == net for w in wires)
        missing = [p for p in ps if p not in traced]
        if missing or pieces != 1:
            print(f"CHECK {net}: {pieces} traced piece(s), not reached by a traced wire: {missing or 'none'}")

    out = {
        "image": "/pics/schematic.png",
        "size": [img.shape[1], img.shape[0]],
        "pins": {n: [round(x), round(y)] for n, (x, y) in pins.items()},
        "wires": sorted(wires, key=lambda w: (w["net"] is None, w["net"] or "", w["pins"])),
    }
    (ROOT / "schematic-map.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote schematic-map.json: {len(pins)} pins, {len(wires)} traced wires")


if __name__ == "__main__":
    main()
