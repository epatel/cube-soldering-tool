"""Saved board state: JSON file, forward-only migrations, ops and undo."""
import copy
import json
import os

from board import adjacent, default_pins, shape_problem, valid_node


def _m0_initial(state):
    state.setdefault("parts", {})
    state.setdefault("links", [])
    state.setdefault("verified", {})
    state.setdefault("next_id", 1)
    return state


# Ordered, immutable steps: MIGRATIONS[n] moves a state from version n to n+1.
# Never edit a step that has shipped; append a new one.
MIGRATIONS = [_m0_initial]


def migrate(state):
    version = state.get("version", 0)
    if version > len(MIGRATIONS):
        raise ValueError(f"state file is version {version}, this code knows up to {len(MIGRATIONS)}")
    for i in range(version, len(MIGRATIONS)):
        state = MIGRATIONS[i](state)
        state["version"] = i + 1
    return state


def reconcile(state, netlist):
    """Make the placed parts match the netlist: add new parts/pins, drop removed ones."""
    parts = {}
    for pid, part in netlist["parts"].items():
        pins = default_pins(part)
        old = state["parts"].get(pid, {}).get("pins", {})
        kept = {name: old.get(name, node) for name, node in pins.items()}
        # A footprint that changed in the netlist puts the part back at its default spot.
        parts[pid] = {"pins": pins if shape_problem(part, kept) else kept}
    state["parts"] = parts
    state["verified"] = {n: v for n, v in state["verified"].items() if n in netlist["nets"]}
    return state


class Store:
    def __init__(self, path, netlist):
        self.path = path
        self.undo, self.redo = [], []
        state = {}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                state = json.load(f)
        self.state = reconcile(migrate(state), netlist)

    def save(self):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.state, f, indent=1)
        os.replace(tmp, self.path)

    def apply(self, op, netlist):
        """Apply one client op. Raises ValueError and leaves the state alone if it is invalid."""
        kind = op.get("op")
        if kind in ("undo", "redo"):
            src, dst = (self.undo, self.redo) if kind == "undo" else (self.redo, self.undo)
            if not src:
                raise ValueError(f"nothing to {kind}")
            dst.append(self.state)
            self.state = reconcile(src.pop(), netlist)
        else:
            new = copy.deepcopy(self.state)
            _OPS.get(kind, _unknown)(new, op, netlist)
            self.undo.append(self.state)
            del self.undo[:-200]
            self.redo.clear()
            self.state = new
        self.save()


def _unknown(state, op, netlist):
    raise ValueError(f"unknown op {op.get('op')!r}")


def _move(state, op, netlist):
    part = state["parts"].get(op.get("part"))
    if part is None:
        raise ValueError(f"unknown part {op.get('part')!r}")
    for name, node in op["pins"].items():
        if name not in part["pins"]:
            raise ValueError(f"unknown pin {op['part']}.{name}")
        if not valid_node(node):
            raise ValueError(f"{op['part']}.{name} would be off the board")
        part["pins"][name] = list(node)
    problem = shape_problem(netlist["parts"][op["part"]], part["pins"])
    if problem:
        raise ValueError(f"{op['part']} {problem}")


def _add(state, op, netlist):
    link = op["link"]
    if link.get("type") not in ("solder", "wire"):
        raise ValueError("link type must be solder or wire")
    path = []
    for node in link["path"]:
        if not valid_node(node):
            raise ValueError("link leaves the board")
        if not path or path[-1] != list(node):
            path.append(list(node))
    if len(path) < 2:
        raise ValueError("a link needs two different points")
    if link["type"] == "solder":
        if any(not adjacent(a, b) for a, b in zip(path, path[1:])):
            raise ValueError("solder must run pad to neighbouring pad")
    elif path[0] == path[-1]:
        raise ValueError("a wire must end somewhere else than it starts")
    new = {"id": state["next_id"], "type": link["type"], "path": path}
    if link["type"] == "wire":
        new["color"] = str(link.get("color", "#e5484d"))[:20]
    state["next_id"] += 1
    state["links"].append(new)


def _delete(state, op, netlist):
    before = len(state["links"])
    state["links"] = [l for l in state["links"] if l["id"] != op.get("id")]
    if len(state["links"]) == before:
        raise ValueError("no such link")


def _verify(state, op, netlist):
    if op.get("net") not in netlist["nets"]:
        raise ValueError(f"unknown net {op.get('net')!r}")
    state["verified"][op["net"]] = bool(op.get("value"))


def _reset(state, op, netlist):
    state["parts"] = {}
    state["links"] = []
    reconcile(state, netlist)


_OPS = {"move": _move, "add": _add, "del": _delete, "verify": _verify, "reset": _reset}
