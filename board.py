"""Board geometry, netlist loading and the connectivity check.

A node is [col, row] seen from the component side:
  holes      col 1..18, row 1..24 (A..X)
  edge pads  row 0 (top) / row 25 (bottom), col 2..17
  rails      col 0 / col 19, any row 1..24 - each rail is one conductor
"""
import json
import math

COLS, ROWS = 18, 24


def valid_node(n):
    try:
        c, r = n
    except (TypeError, ValueError):
        return False
    if not (type(c) is int and type(r) is int):
        return False
    if 1 <= c <= COLS and 1 <= r <= ROWS:
        return True
    if r in (0, ROWS + 1) and 2 <= c <= COLS - 1:
        return True
    return c in (0, COLS + 1) and 1 <= r <= ROWS


def key(n):
    """Electrical identity of a node: every position on a rail is the same key."""
    c, r = n
    if c == 0:
        return "railL"
    if c == COLS + 1:
        return "railR"
    return f"{c},{r}"


def adjacent(a, b):
    return a != b and abs(a[0] - b[0]) <= 1 and abs(a[1] - b[1]) <= 1


def node_name(k):
    if k == "railL":
        return "rail by column 01"
    if k == "railR":
        return f"rail by column {COLS}"
    c, r = map(int, k.split(","))
    if r == 0:
        return f"top pad {c:02d}"
    if r == ROWS + 1:
        return f"bottom pad {c:02d}"
    return f"{chr(64 + r)}{c:02d}"


def default_pins(part):
    ac, ar = part["at"]
    return {name: [ac + dc, ar + dr] for name, (dc, dr) in part["pins"].items()}


def shape_problem(part, pins):
    """Why these pin positions are not a legal placement of the part, or None."""
    names = list(part["pins"])
    nodes = [tuple(pins[n]) for n in names]
    if part.get("rigid"):
        shape = [tuple(part["pins"][n]) for n in names]
        shape = [(c - shape[0][0], r - shape[0][1]) for c, r in shape]
        placed = [(c - nodes[0][0], r - nodes[0][1]) for c, r in nodes]
        for _ in range(4):
            if placed == shape:
                break
            shape = [(-r, c) for c, r in shape]
        else:
            return "is rigid and must keep its footprint"
    if "min_len" in part and math.dist(nodes[0], nodes[-1]) < part["min_len"]:
        return f"needs its pins at least {part['min_len']} holes apart"
    return None


def load_netlist(path):
    with open(path, encoding="utf-8") as f:
        nl = json.load(f)
    known = {f"{pid}.{pn}" for pid, p in nl["parts"].items() for pn in p["pins"]}
    seen = {}
    for net, pins in nl["nets"].items():
        for p in pins:
            if p not in known:
                raise ValueError(f"netlist: net {net} uses unknown pin {p}")
            if p in seen:
                raise ValueError(f"netlist: pin {p} is in both {seen[p]} and {net}")
            seen[p] = net
    for pair in nl.get("internal", []):
        for p in pair:
            if p not in known:
                raise ValueError(f"netlist: internal link uses unknown pin {p}")
    for pair in nl.get("heavy_paths", []):
        for p in pair:
            if p not in known:
                raise ValueError(f"netlist: heavy path uses unknown pin {p}")
    for pid, part in nl["parts"].items():
        for pn, node in default_pins(part).items():
            if not valid_node(node):
                raise ValueError(f"netlist: default position of {pid}.{pn} is off the board")
        if "min_len" in part and len(part["pins"]) != 2:
            raise ValueError(f"netlist: {pid} has min_len but is not a two-pin part")
        problem = shape_problem(part, default_pins(part))
        if problem:
            raise ValueError(f"netlist: default position of {pid} {problem}")
    return nl


class _UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)


def heavy_links(netlist, state):
    """Ids of the solder paths and wires that lie on a high-current path.

    For each pin pair in the netlist's `heavy_paths` this follows the shortest chain of links
    between the two pins. With no loop in the layout that chain is the only one.
    """
    edges = {}
    for link in state["links"]:
        path = [key(p) for p in link["path"]]
        steps = zip(path, path[1:]) if link["type"] == "solder" else [(path[0], path[-1])]
        for a, b in steps:
            edges.setdefault(a, []).append((b, link["id"]))
            edges.setdefault(b, []).append((a, link["id"]))
    where = {f"{pid}.{pn}": key(node) for pid, part in state["parts"].items() for pn, node in part["pins"].items()}
    heavy = set()
    for a, b in netlist.get("heavy_paths", []):
        start, goal = where.get(a), where.get(b)
        came = {start: None}
        queue = [start]
        for node in queue:
            if node == goal:
                break
            for nxt, link_id in edges.get(node, []):
                if nxt not in came:
                    came[nxt] = (node, link_id)
                    queue.append(nxt)
        node = goal
        while came.get(node):
            node, link_id = came[node]
            heavy.add(link_id)
    return sorted(heavy)


def check(netlist, state):
    """Compare what is joined on the board with the schematic nets.

    What counts as a connection:
      - a solder path joins every pad it runs over
      - a wire joins only its two ends (waypoints and crossings join nothing)
      - a rail is one conductor; pins in the same hole are joined
      - two solder paths that cross on a diagonal touch, so they are joined
    """
    uf = _UnionFind()
    warnings = []
    diagonals = {}
    for link in state["links"]:
        path = [tuple(p) for p in link["path"]]
        if link["type"] == "solder":
            for a, b in zip(path, path[1:]):
                uf.union(key(a), key(b))
                if a[0] != b[0] and a[1] != b[1]:
                    cell = (min(a[0], b[0]), min(a[1], b[1]))
                    falling = (b[0] - a[0]) * (b[1] - a[1]) > 0
                    diagonals.setdefault(cell, {})[falling] = key(a)
        else:
            uf.union(key(path[0]), key(path[-1]))
    for (c, r), d in diagonals.items():
        if len(d) == 2:
            uf.union(d[True], d[False])
            warnings.append(f"Solder paths cross diagonally at {node_name(f'{c},{r}')} - treated as joined")

    pin_key, at = {}, {}
    for pid, part in state["parts"].items():
        for pn, node in part["pins"].items():
            k = key(node)
            uf.find(k)
            pin_key[f"{pid}.{pn}"] = k
            at.setdefault(k, []).append(f"{pid}.{pn}")
    for k, pins in at.items():
        if len(pins) > 1 and not k.startswith("rail"):
            warnings.append(f"{', '.join(pins)} share {node_name(k)}")
    for a, b in netlist.get("internal", []):
        if a in pin_key and b in pin_key:
            uf.union(pin_key[a], pin_key[b])

    pin_net = {p: net for net, pins in netlist["nets"].items() for p in pins}
    by_root = {}
    for pin, k in pin_key.items():
        by_root.setdefault(uf.find(k), []).append(pin)

    nets = {}
    for net, pins in netlist["nets"].items():
        groups = {}
        for p in pins:
            if p in pin_key:
                groups.setdefault(uf.find(pin_key[p]), []).append(p)
        nets[net] = {
            "status": "ok" if len(groups) == 1 else "open",
            "groups": sorted(groups.values(), key=len, reverse=True),
            "verified": bool(state.get("verified", {}).get(net)),
        }

    shorts = []
    for root, pins in by_root.items():
        joined = sorted({pin_net[p] for p in pins if p in pin_net})
        if len(joined) > 1:
            shorts.append({"nets": joined, "pins": sorted(pins)})
            for n in joined:
                nets[n]["status"] = "short"
        stray = [p for p in pins if p not in pin_net]
        if stray and len(pins) > 1:
            warnings.append(f"{', '.join(stray)} is not in the schematic but is joined to {', '.join(p for p in pins if p not in stray) or 'another unused pin'}")

    gid = {root: i for i, root in enumerate(sorted({uf.find(k) for k in uf.parent}))}
    return {
        "nets": nets,
        "shorts": shorts,
        "warnings": warnings,
        "node_group": {k: gid[uf.find(k)] for k in uf.parent},
        "groups": {
            gid[root]: {"pins": sorted(pins), "nets": sorted({pin_net[p] for p in pins if p in pin_net})}
            for root, pins in by_root.items()
        },
        "heavy": heavy_links(netlist, state),
        "summary": {
            "ok": sum(n["status"] == "ok" for n in nets.values()),
            "total": len(nets),
            "shorts": len(shorts),
            "verified": sum(n["verified"] for n in nets.values()),
        },
    }
