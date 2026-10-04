# connection-check

`board.check(netlist, state)`: what counts as electrically joined, and what gets reported.

## What joins and what does not

| Thing | Joins |
|-------|-------|
| Solder path | Every pad it runs over. It is bare metal. |
| Wire | Only its first and last point. It is insulated. |
| Wire waypoint on a pad | Nothing. |
| Two wires crossing | Nothing. |
| Wire crossing a solder path | Nothing. |
| Two solder paths crossing on a diagonal between four pads | Joined, with a warning. They would touch. |
| Rail | All positions on one rail are one conductor. |
| Two pins in the same hole | Joined, with a warning. |
| Pins listed under `internal` in the netlist | Joined inside the part. |
| A part's own pins | Nothing. A resistor does not short its ends. |

Links attach to board nodes, not to pins. Moving a part leaves its old solder and wires where they were.

## Algorithm

Union-find over node keys. Union consecutive nodes of each solder path, the two ends of each wire,
crossing diagonals, and internal pin pairs. Each pin then belongs to the group of the node it sits on.

## Result

- `nets[name].status`: `ok` when all the net's pins are in one group, `short` when its group also holds another net's pin, otherwise `open`.
- `nets[name].groups`: the net's pins split by group, largest first. The page draws the ratsnest between these groups.
- `shorts`: one entry per group that holds pins of more than one net.
- `warnings`: diagonal crossings, shared holes, and pins that are not in the schematic but are joined to something.
- `node_group` and `groups`: group id per node key and the pins/nets per group. The page uses them to light up everything joined to the pad under the pointer.
- `summary`: counts for the header.

## Invariants

- The check is pure: same netlist and state give the same result. It never changes the state.
- It runs on the server after every op. The page never decides connectivity itself.
- Every rule in the table above has a test in `tests/test_board.py`. Change the rule and the test together.
