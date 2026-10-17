.PHONY: up down build logs ps compose-config test test-go test-rust lint lint-go lint-rust

up:
	docker compose up -d --build

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

ps:
	docker compose ps

compose-config:
	docker compose config

test: test-go test-rust

test-go:
	cd services/match-service-go && go test -race ./...

test-rust:
	cd services/player-profile-service-rust && cargo test

lint: lint-go lint-rust

lint-go:
	cd services/match-service-go && test -z "$$(gofmt -l .)" && go vet ./...

lint-rust:
	cd services/player-profile-service-rust && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings
