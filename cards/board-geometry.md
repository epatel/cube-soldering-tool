# board-geometry

The perfboard's coordinate system and how the two views map onto it.

## The physical board

5x7 cm double-sided perfboard (photos in `pics/`). 18 columns labelled 01-18, 24 rows labelled A-X,
2.54 mm pitch. Every hole has its own isolated pad. Along the top and bottom edge are 16 long pads
lined up with columns 02-17. Down each long side runs one continuous rail strip.

## Nodes

Everything that can carry a pin, a wire end or solder is a node `[col, row]` of two integers.
Coordinates are always as seen from the COMPONENT side, whatever the page is showing.

| Node | col | row | Notes |
|------|-----|-----|-------|
| Hole | 1..18 | 1..24 | row 1 = A, row 24 = X |
| Top edge pad | 2..17 | 0 | |
| Bottom edge pad | 2..17 | 25 | |
| Rail by column 01 | 0 | 1..24 | every row is the same conductor |
| Rail by column 18 | 19 | 1..24 | every row is the same conductor |

`board.valid_node` (Python) and `validNode` (JS) implement this table and must stay in step.
`board.key` / `key` give a node's electrical identity: `"c,r"` for holes and edge pads,
`"railL"` / `"railR"` for any position on a rail.

## Views

The page defaults to the solder side seen from below, which mirrors left and right: column 18 is
drawn on the left. Only `pos()` and `nodeAt()` in `static/app.js` know about the mirror
(`x -> 19 - x`). State, ops and the check never see mirrored coordinates. `F` flips the view.

## Assumptions that are not verified

- Components sit on the silkscreen side, solder goes on the plain side.
- The two rails are not joined to each other or to the edge pads.
- Edge pads are isolated from each other.

If the real board differs, change `valid_node`/`key` and the drawing in `drawBoard()` together.

## Adjacency

Two nodes are adjacent when both coordinates differ by at most 1 (8 neighbours). Solder paths may
only step between adjacent nodes; the page fills in the steps when the pointer jumps.
