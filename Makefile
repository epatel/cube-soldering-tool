SHELL := bash
PY := .venv/bin/python
PORT := 8765
URL := http://127.0.0.1:$(PORT)

info: menu select

menu:
	echo "1 make start                - serve the planner on http://127.0.0.1:8765"
	echo "2 make stop                 - stop the running server"
	echo "3 make open                 - open the planner in the browser"
	echo "4 make verify               - open the netlist verifier in the browser"
	echo "5 make print                - open the printable sheets in the browser"
	echo "6 make check                - print the schematic check for the saved board"
	echo "7 make test                 - run the unit tests"
	echo "8 make backup               - copy data/state.json to data/backups/ with a timestamp"
	echo "9 make trace                - re-trace pics/schematic.png into schematic-map.json"
	echo "10 make setup               - create .venv and install requirements"
	echo "11 make update_phony        - update .PHONY in Makefile"

select:
	read -p ">>> " P ; make menu | grep "^$$P " | cut -d ' ' -f2-3 | bash

.SILENT:

.PHONY: info menu select start stop open verify print test check setup backup trace update_phony 

start: .venv
	$(PY) server.py --port $(PORT)

stop:
	pids=$$(lsof -ti tcp:$(PORT) -sTCP:LISTEN); \
	if [ -n "$$pids" ]; then kill $$pids && echo "stopped server on port $(PORT)"; else echo "no server on port $(PORT)"; fi

open:
	open $(URL)/

verify:
	open $(URL)/verify

print:
	open $(URL)/print

test: .venv
	$(PY) -m unittest discover -s tests

check: .venv
	$(PY) server.py --check

setup:
	python3 -m venv .venv
	.venv/bin/pip install -q -r requirements.txt

.venv:
	$(MAKE) setup

backup:
	mkdir -p data/backups
	cp data/state.json data/backups/state-$$(date +%Y%m%d-%H%M%S).json
	ls -1 data/backups | tail -1

trace: .venv
	.venv/bin/pip install -q -r requirements-dev.txt
	$(PY) tools/trace_schematic.py

update_phony:
	echo "##### Updating .PHONY targets #####"
	targets=$$(grep -E '^[a-zA-Z_][a-zA-Z0-9_-]*:' Makefile | grep -v '=' | cut -d: -f1 | tr '\n' ' '); \
	sed -i.bak "s/^\.PHONY:.*/.PHONY: $$targets/" Makefile && \
	echo "Updated .PHONY: $$targets" && \
	rm -f Makefile.bak
