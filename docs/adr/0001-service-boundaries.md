# ADR 0001: Service boundaries between Go and Rust

- Status: Accepted
- Date: 2026-10-17

## Context

El proyecto requiere Go, Rust, gRPC, PostgreSQL, concurrencia con goroutines y tolerancia a fallos. La caída de Rust no debe derribar el resto del backend.

## Decision

### Go Match Service

Go será dueño de sesiones, conexiones, salas, estado runtime, simulación autoritativa, goroutines/channels, realtime, reconexión y resultado de carrera.

### Rust Player/Profile Service

Rust será dueño de perfil, inventario, catálogo, economía, crafting, equipamiento/apariencia y settlement idempotente.

Go se comunica con Rust mediante gRPC/Protobuf y una abstracción interna. Envoy funciona como Ambassador/load balancer entre Go y múltiples réplicas Rust.

## Consequences

### Positive

- la caída de Rust no destruye partidas activas;
- Rust puede replicarse;
- Go demuestra concurrencia real;
- ownership de datos es claro;
- load balancing/failover es demostrable.

### Trade-offs

- aumenta complejidad operacional;
- perfil puede quedar temporalmente indisponible;
- settlement necesita idempotencia;
- deben evitarse retries duplicados entre Go y Envoy.
