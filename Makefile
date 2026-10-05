.PHONY: up down logs ps seed reset test test-e2e build

up:            ## build & start the whole stack (test-selloq)
	@test -f .env || cp .env.example .env
	docker compose up --build -d
	@echo "App: http://localhost:5173  (demo@selloq.local / demo1234)  API: http://localhost:8000/docs  Mail: http://localhost:8025"

down:
	docker compose down

logs:
	docker compose logs -f --tail=200 backend worker

ps:
	docker compose ps

seed:          ## (re)seed demo data if missing
	docker compose exec backend python -m scripts.seed_demo

reset:         ## wipe all data (DB + uploads) and start fresh
	docker compose down -v
	$(MAKE) up

test:          ## backend unit tests
	docker compose exec backend python -m pytest -q tests --ignore=tests/e2e

test-e2e:      ## end-to-end checks of the two demo flows against the running stack
	docker compose exec backend python -m pytest -q tests/e2e
