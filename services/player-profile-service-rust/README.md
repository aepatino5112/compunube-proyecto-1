# Rust Player/Profile Service

El diseño, la persistencia, la salud y las métricas de cada réplica están documentados en [Player/Profile Service](../../docs/architecture/rust-player-profile-service.md).

## Operación

Arranque, variables, puertos, roles de PostgreSQL, salud, métricas, pruebas, diagnóstico, recuperación y restauración (destructiva): [Runbook operativo del servicio Rust](../../docs/runbooks/rust-player-profile-service.md).

## Logs correlacionados (H67-Final)

Cada RPC del contrato `compunube.player.v1.PlayerProfileService` registra una línea JSON `rpc completed` con `service`, `instance_id`, `rpc`, `outcome`, `code`, `error_class`, `latency_ms` y `correlation_id`. Go transmite este último por metadata gRPC `x-correlation-id`, derivada del header HTTP público `X-Request-ID`.

Rust acepta solo IDs de 1 a 64 caracteres ASCII alfanuméricos, `-` y `_`. Si faltan o son inválidos, registra `correlation_id=""` sin reflejar la entrada. No registra tokens, credenciales, cuerpos ni IDs de negocio; tampoco usa el ID como clave de idempotencia o label Prometheus. La correlación no cambia protobuf.
