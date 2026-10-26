# H67-Final: correlación HTTP → Go → Envoy → Rust

## Convención

- Header público y de respuesta: `X-Request-ID`.
- Metadata gRPC interna: `x-correlation-id`.
- Valores válidos: 1–64 caracteres ASCII alfanuméricos, `-` y `_`. Go genera 128 bits aleatorios hexadecimales cuando falta o es inválido.
- `correlation_id` es un campo de log, nunca un label de Prometheus ni un `requestId` de idempotencia.

## Pruebas reproducibles

Desde `services/match-service-go`, ejecutar `go vet ./...`, `go test ./...` y `go test -race ./...`. Las pruebas de `internal/correlation` cubren generación, preservación, rechazo de entradas inseguras, contexto y metadata saliente; `internal/playerprofile` verifica que los ocho RPC entregan la metadata a un servidor gRPC real en memoria.

Desde `services/player-profile-service-rust`, ejecutar `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` y `cargo test`. La prueba de `transport::observe` captura las líneas JSON de los ocho RPC y comprueba que un valor inválido y metadata sensible no aparecen.

El [harness público J83](../../scripts/validation/j83-profile-economy.py) envía un `X-Request-ID` propio a `GET /v1/profile`, comprueba el eco en la respuesta y busca el mismo ID en los logs Go y Rust. La ruta efectiva es HTTP → Go → Envoy → Rust → PostgreSQL; el harness limpia el proyecto Compose al terminar.

## Resultado local

En este entorno, `gofmt -l .`, `go vet ./...`, `go test ./...` y `go test -race ./...` pasaron. `cargo fmt --check` también pasó antes de un reinicio del entorno temporal.

El [run de CI Integration de la PR #65](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40248143361) confirmó `PASS Go preserves safe X-Request-ID on public profile response`, `PASS Go -> Envoy -> Rust correlation metadata reaches structured RPC log` y `PASS Go HTTP log carries correlation ID without bearer token`. El harness J83 terminó en `RESULT: PASS`, igual que la regresión J85. Go, Rust, Contracts, Infrastructure, Integration y Web pasaron en esa revisión.
