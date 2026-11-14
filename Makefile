ifeq ($(OS),Windows_NT)
PY := backend/.venv/Scripts/python
else
PY := backend/.venv/bin/python
endif

.PHONY: setup seed dev test demo reset-demo openapi build

setup:
	python -m venv backend/.venv
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -r backend/requirements.txt
	cd frontend && npm install --no-audit --no-fund

seed:
	cd backend && ../$(PY) -m app.seed.cli

dev:
	@echo "API http://localhost:8000   Web http://localhost:3000"
	@trap 'kill 0' INT TERM; \
	(cd backend && ../$(PY) -m uvicorn app.main:app --port 8000 --reload) & \
	(cd frontend && npm run dev) & \
	wait

test:
	cd backend && ../$(PY) -m pytest -q
	cd frontend && npx tsc --noEmit

demo: seed
	@echo ""
	@echo "Demo ready. Run 'make dev', open http://localhost:3000 and follow docs/DEMO_SCRIPT.md"
	@echo "Accounts (password Demo@1234): admin@jklu.demo, faculty01@jklu.demo, student001@jklu.demo"

reset-demo:
	cd backend && ../$(PY) -m app.seed.cli --reset

openapi:
	cd backend && ../$(PY) ../scripts/export_openapi.py
	cd frontend && npx openapi-typescript ../docs/openapi.json -o lib/api-types.ts

build:
	cd frontend && npm run build
