GO_DIR := services/match-service-go
RUST_DIR := services/player-profile-service-rust
WEB_DIR := apps/web
CLIENT2_DIR := apps/client-secondary

.PHONY: up down build logs ps compose-config test test-go test-rust lint lint-go lint-rust \
	quality quality-go quality-rust quality-web quality-client-secondary quality-contracts quality-infra

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
	cd $(GO_DIR) && go test ./... && go test -race ./...

test-rust:
	cd $(RUST_DIR) && cargo test --locked

lint: lint-go lint-rust

lint-go:
	cd $(GO_DIR) && test -z "$$(gofmt -l .)" && go vet ./...

lint-rust:
	cd $(RUST_DIR) && cargo fmt --check && cargo clippy --locked --all-targets --all-features -- -D warnings

quality: quality-go quality-rust quality-web quality-client-secondary quality-contracts quality-infra

quality-go:
	@echo "==> Go quality gate"
	cd $(GO_DIR) && test -z "$$(gofmt -l .)" && go vet ./... && go test ./... && go test -race ./...

quality-rust:
	@echo "==> Rust quality gate"
	cd $(RUST_DIR) && cargo fmt --check && cargo clippy --locked --all-targets --all-features -- -D warnings && cargo test --locked

quality-web:
	@echo "==> Web quality gate"
	cd $(WEB_DIR) && npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm test

quality-client-secondary:
	@echo "==> Python client quality gate"
	cd $(CLIENT2_DIR) && python3 -m compileall -q compunube_client && python3 -m pytest -q

quality-contracts:
	@echo "==> Contracts quality gate"
	@command -v protoc >/dev/null 2>&1 || { echo "ERROR: protoc is required for quality-contracts"; exit 1; }
	@files="$$(find proto -type f -name '*.proto' -print)"; \
		test -n "$$files" || { echo "ERROR: no .proto files found"; exit 1; }; \
		protoc --proto_path=proto --descriptor_set_out=/tmp/compunube-contracts.pb --include_imports $$files

quality-infra:
	@echo "==> Infrastructure quality gate"
	docker compose config
	docker run --rm \
		-v "$(CURDIR)/infra/envoy/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
		envoyproxy/envoy:v1.31.10 \
		envoy --mode validate -c /etc/envoy/envoy.yaml
