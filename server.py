"""Solder planner server: static page + one websocket that carries all state.

    .venv/bin/python server.py            serve on http://127.0.0.1:8765
    .venv/bin/python server.py --check    print the schematic check and exit
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from aiohttp import WSMsgType, web

import board
from store import Store, reconcile

ROOT = Path(__file__).parent
NETLIST = ROOT / "netlist.json"
STATE = ROOT / "data" / "state.json"


class Hub:
    def __init__(self):
        self.clients = set()
        self.mtime = None
        self.netlist = None
        self.reload_netlist()
        self.store = Store(str(STATE), self.netlist)

    def reload_netlist(self):
        """Pick up hand edits to netlist.json. A broken edit keeps the last good one."""
        mtime = NETLIST.stat().st_mtime
        if mtime == self.mtime:
            return None
        self.mtime = mtime
        try:
            self.netlist = board.load_netlist(NETLIST)
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            if self.netlist is None:
                raise
            return f"netlist.json not reloaded: {e}"
        if hasattr(self, "store"):
            reconcile(self.store.state, self.netlist)
        return None

    def snapshot(self):
        return {
            "t": "state",
            "state": self.store.state,
            "netlist": self.netlist,
            "check": board.check(self.netlist, self.store.state),
            "can_undo": bool(self.store.undo),
            "can_redo": bool(self.store.redo),
        }

    async def broadcast(self):
        snap = self.snapshot()
        for ws in list(self.clients):
            try:
                await ws.send_json(snap)
            except ConnectionError:
                self.clients.discard(ws)


async def ws_handler(request):
    # Only pages served by this server may drive the board.
    origin = request.headers.get("Origin")
    if origin and urlparse(origin).netloc != request.host:
        raise web.HTTPForbidden(text="cross-origin websocket refused")
    hub = request.app["hub"]
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    hub.clients.add(ws)
    try:
        problem = hub.reload_netlist()
        await ws.send_json(hub.snapshot())
        if problem:
            await ws.send_json({"t": "error", "message": problem})
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            problem = hub.reload_netlist()
            try:
                hub.store.apply(json.loads(msg.data), hub.netlist)
            except (ValueError, KeyError, TypeError, AttributeError) as e:
                problem = str(e)
            if problem:
                await ws.send_json({"t": "error", "message": problem})
            await hub.broadcast()
    finally:
        hub.clients.discard(ws)
    return ws


async def index(request):
    return web.FileResponse(ROOT / "static" / "index.html")


@web.middleware
async def no_cache(request, handler):
    resp = await handler(request)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def make_app():
    app = web.Application(middlewares=[no_cache])
    app["hub"] = Hub()
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_static("/static", ROOT / "static")
    app.router.add_static("/pics", ROOT / "pics")
    return app


def report():
    hub = Hub()
    result = board.check(hub.netlist, hub.store.state)
    s = result["summary"]
    print(f"{s['ok']}/{s['total']} nets complete, {s['shorts']} shorts, {s['verified']}/{s['total']} nets verified")
    for name, net in result["nets"].items():
        if net["status"] != "ok":
            print(f"  {net['status']:5} {name}: " + "  |  ".join(" ".join(g) for g in net["groups"]))
    for short in result["shorts"]:
        print(f"  SHORT {' + '.join(short['nets'])}: {' '.join(short['pins'])}")
    for w in result["warnings"]:
        print(f"  warn  {w}")
    return 1 if s["shorts"] or s["ok"] < s["total"] else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="print the schematic check and exit")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    if args.check:
        sys.exit(report())
    web.run_app(make_app(), host=args.host, port=args.port)
