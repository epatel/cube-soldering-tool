# server-owns-state

Decision: the Python server is the only owner of board state and connectivity; the page is a view.

## The choice

Every edit is an op sent to the server. The server validates, saves, runs the check and sends a
full snapshot back to all pages. The page keeps only UI mode (tool, colour, zoom, view, selection)
and the gesture in progress. It applies nothing locally.

## Alternatives considered

- State in the browser with the server as a dumb save file: two tabs diverge, and the check would have to live in JavaScript.
- Incremental ops broadcast to other pages with optimistic local apply: needs conflict handling and a second copy of the validation rules.
- The check duplicated in JavaScript for instant feedback: two implementations of "what is a connection" that can disagree.

## Why

- "What is a connection" is the part that must be right. One implementation in `board.py`, covered by tests, and usable from the command line (`make check`) by a person or an agent.
- The state is tiny (a few kB), and the server is on localhost. A full snapshot per edit costs nothing noticeable.
- Undo is a list of previous states on the server; no inverse ops.

## Revisit when

- The board grows enough that a full redraw per edit is visibly slow.
- The planner is served over a real network, where round-trip latency would make dragging feel laggy.
