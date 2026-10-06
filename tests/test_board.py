import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import board
from store import Store, migrate

ROOT = os.path.join(os.path.dirname(__file__), "..")


def tiny_netlist():
    return {
        "parts": {
            "A": {"at": [1, 1], "pins": {"1": [0, 0], "2": [0, 4]}},
            "B": {"at": [5, 1], "pins": {"1": [0, 0], "2": [0, 4]}},
            "X": {"at": [9, 9], "pins": {"nc": [0, 0]}},
            "R": {"at": [12, 3], "min_len": 4, "pins": {"1": [0, 0], "2": [0, 4]}},
            "E": {"at": [15, 3], "rigid": True, "pins": {"-": [0, 0], "+": [1, 1]}},
        },
        "nets": {"N1": ["A.1", "B.1"], "N2": ["A.2", "B.2"]},
    }


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.nl = tiny_netlist()
        self.dir = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.dir.name, "state.json"), self.nl)

    def tearDown(self):
        self.dir.cleanup()

    def add(self, type, path):
        self.store.apply({"op": "add", "link": {"type": type, "path": path}}, self.nl)

    def result(self):
        return board.check(self.nl, self.store.state)

    def test_nothing_joined_is_open(self):
        r = self.result()
        self.assertEqual(r["nets"]["N1"]["status"], "open")
        self.assertEqual(r["summary"], {"ok": 0, "total": 2, "shorts": 0, "verified": 0})

    def test_solder_path_joins_every_pad_it_crosses(self):
        self.add("solder", [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]])
        r = self.result()
        self.assertEqual(r["nets"]["N1"]["status"], "ok")
        self.assertEqual(r["node_group"]["3,1"], r["node_group"]["1,1"])

    def test_wire_joins_only_its_ends(self):
        self.add("wire", [[1, 1], [1, 5], [5, 1]])  # waypoint sits on A.2
        r = self.result()
        self.assertEqual(r["nets"]["N1"]["status"], "ok")
        self.assertEqual(r["shorts"], [])

    def test_crossing_wires_do_not_join(self):
        self.add("wire", [[1, 1], [5, 1]])
        self.add("wire", [[3, 0], [3, 3]])
        self.assertEqual(self.result()["shorts"], [])

    def test_short_between_nets(self):
        self.add("solder", [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]])
        r = self.result()
        self.assertEqual(r["shorts"][0]["nets"], ["N1", "N2"])
        self.assertEqual(r["nets"]["N1"]["status"], "short")

    def test_rail_is_one_conductor(self):
        self.add("solder", [[1, 1], [0, 1]])
        self.add("wire", [[0, 20], [5, 1]])
        self.assertEqual(self.result()["nets"]["N1"]["status"], "ok")

    def test_diagonal_solder_crossing_joins(self):
        self.add("solder", [[2, 2], [3, 3]])
        self.add("solder", [[3, 2], [2, 3]])
        r = self.result()
        self.assertEqual(r["node_group"]["2,2"], r["node_group"]["3,2"])
        self.assertTrue(any("cross diagonally" in w for w in r["warnings"]))

    def test_heavy_links_follow_the_path_between_the_pin_pair(self):
        self.nl["heavy_paths"] = [["A.1", "B.1"]]
        self.add("solder", [[1, 1], [2, 1], [3, 1]])   # id 1, on the path
        self.add("wire", [[3, 1], [5, 1]])             # id 2, on the path
        self.add("solder", [[3, 1], [3, 2], [3, 3]])   # id 3, a side branch
        self.assertEqual(self.result()["heavy"], [1, 2])

    def test_unused_pin_joined_to_a_net_warns(self):
        self.add("wire", [[9, 9], [1, 1]])
        self.assertTrue(any("X.nc is not in the schematic" in w for w in self.result()["warnings"]))

    def test_rejects_bad_links_and_keeps_state(self):
        for link in (
            {"type": "solder", "path": [[1, 1], [3, 1]]},
            {"type": "wire", "path": [[1, 1], [40, 1]]},
            {"type": "wire", "path": [[1, 1], [1, 1]]},
            {"type": "glue", "path": [[1, 1], [2, 1]]},
        ):
            with self.assertRaises(ValueError):
                self.store.apply({"op": "add", "link": link}, self.nl)
        self.assertEqual(self.store.state["links"], [])

    def test_undo_redo_and_persistence(self):
        self.add("wire", [[1, 1], [5, 1]])
        self.store.apply({"op": "move", "part": "A", "pins": {"1": [2, 2]}}, self.nl)
        self.store.apply({"op": "undo"}, self.nl)
        self.assertEqual(self.store.state["parts"]["A"]["pins"]["1"], [1, 1])
        self.store.apply({"op": "redo"}, self.nl)
        reopened = Store(self.store.path, self.nl)
        self.assertEqual(reopened.state["parts"]["A"]["pins"]["1"], [2, 2])
        self.assertEqual(len(reopened.state["links"]), 1)

    def test_move_off_board_is_refused(self):
        with self.assertRaises(ValueError):
            self.store.apply({"op": "move", "part": "A", "pins": {"1": [1, 0]}}, self.nl)

    def move(self, part, pins):
        self.store.apply({"op": "move", "part": part, "pins": pins}, self.nl)

    def test_two_pin_part_respects_min_len(self):
        self.move("R", {"2": [16, 3]})  # exactly 4 holes, now horizontal
        with self.assertRaises(ValueError):
            self.move("R", {"2": [14, 5]})  # about 2.8 holes

    def test_rigid_part_keeps_its_footprint_but_may_rotate(self):
        self.move("E", {"-": [15, 3], "+": [14, 4]})  # rotated diagonal
        with self.assertRaises(ValueError):
            self.move("E", {"+": [16, 3]})  # side by side is not the footprint

    def test_changed_footprint_resets_the_part(self):
        self.move("R", {"1": [12, 10], "2": [12, 14]})
        self.nl["parts"]["R"]["min_len"] = 6
        self.nl["parts"]["R"]["pins"]["2"] = [0, 6]
        reopened = Store(self.store.path, self.nl)
        self.assertEqual(reopened.state["parts"]["R"]["pins"], {"1": [12, 3], "2": [12, 9]})

    def test_migrate_from_empty(self):
        self.assertEqual(migrate({})["version"], 1)
        with self.assertRaises(ValueError):
            migrate({"version": 99})


class ProjectNetlistTest(unittest.TestCase):
    def test_netlist_loads_and_default_layout_is_clean(self):
        nl = board.load_netlist(os.path.join(ROOT, "netlist.json"))
        with tempfile.TemporaryDirectory() as d:
            state = Store(os.path.join(d, "s.json"), nl).state
        r = board.check(nl, state)
        self.assertEqual(r["shorts"], [])
        self.assertEqual(r["warnings"], [])
        self.assertEqual(r["summary"]["total"], 20)

    def test_internal_ground_pins_count_as_joined(self):
        nl = board.load_netlist(os.path.join(ROOT, "netlist.json"))
        with tempfile.TemporaryDirectory() as d:
            state = Store(os.path.join(d, "s.json"), nl).state
        r = board.check(nl, state)
        self.assertIn(["ESP.GND", "ESP.GND2"], r["nets"]["GND"]["groups"])

    def test_bad_netlist_is_rejected(self):
        with open(os.path.join(ROOT, "netlist.json"), encoding="utf-8") as f:
            bad = json.load(f)
        bad["nets"]["DUP"] = ["ESP.D34"]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(bad, f)
        try:
            with self.assertRaises(ValueError):
                board.load_netlist(f.name)
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
