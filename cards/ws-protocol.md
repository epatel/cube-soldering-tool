# ws-protocol

The messages on `/ws` and the shape of the saved state.

## Server to page

After connecting, and after every op from any page, every page gets a full snapshot:

```json
{ "t": "state", "state": {}, "netlist": {}, "check": {}, "can_undo": true, "can_redo": false }
```

An op that fails validation also sends `{ "t": "error", "message": "..." }` to the sender only.

## Page to server

| Op | Fields | Effect |
|----|--------|--------|
| `move` | `part`, `pins: {name: [c, r]}` | Set the listed pins' positions. All must be valid nodes, a rigid part must keep its footprint, and a part with `min_len` must stay that long. |
| `add` | `link: {type, path, color?}` | Add a `solder` or `wire` link. The server assigns the id. |
| `del` | `id` | Remove a link. |
| `verify` | `net`, `value` | Tick or untick "verified against the schematic". |
| `reset` | | Remove all links and put parts back at their netlist defaults. Undoable. |
| `undo` / `redo` | | Step through the in-memory history (last 200 states, lost on restart). |

Rules for `add`: at least two different points, all valid nodes; a solder path may only step to a
neighbouring node; a wire must end somewhere other than where it starts. Repeated consecutive
points are dropped.

## Saved state (`data/state.json`)

```json
{
  "version": 1,
  "parts": { "R3": { "pins": { "1": [2, 5], "2": [2, 9] } } },
  "links": [ { "id": 1, "type": "wire", "path": [[1, 1], [4, 2]], "color": "#e5484d" },
             { "id": 2, "type": "solder", "path": [[2, 1], [3, 1], [4, 2]] } ],
  "verified": { "VBAT": true },
  "next_id": 3
}
```

## Changing the shape

`store.MIGRATIONS` is an ordered list of functions; entry N moves a state from version N to N+1.
A missing file is version 0 and runs all of them, so there is one code path. To change the shape,
append a function. Never edit one that has already run on a saved file.

## Adding an op

1. Write `_name(state, op, netlist)` in `store.py`; raise `ValueError` for bad input. It gets a copy, so it may mutate freely.
2. Register it in `_OPS`.
3. Send it from `static/app.js` with `send({op: 'name', ...})`. No client-side apply is needed; the snapshot redraws the page.
4. Add a test.
