.DEFAULT_GOAL := up

.PHONY: up stop restart logs build

## Start the dev environment (Docker)
up:
	docker compose up -d --build
	@echo ""
	@echo "Dev server: http://localhost:5173/deepseek-peakprice/"

## Stop the dev environment
stop:
	docker compose down

## Restart the dev environment
restart: stop up

## Follow the dev server logs
logs:
	docker compose logs -f web

## Rebuild the dev image
build:
	docker compose build
