# AGENTS.md

Reglas para cualquier agente de IA que modifique este repositorio.

## Antes de editar

1. Leer `README.md`.
2. Leer `ARCHITECTURE.md`.
3. Leer `docs/roadmap.md` para entender la secuencia técnica.
4. Revisar ADRs en `docs/adr/`.
5. Si se modifica CI/CD, Compose, deployment o workflows, leer `docs/ci-cd.md`.
6. Mantener los límites de ownership.
7. No agregar tecnologías o patrones sin un problema concreto que los justifique.

## Planificación

Trello es la fuente operativa de tareas, responsables, prioridades y estado Kanban.

`docs/roadmap.md` es una vista de hitos técnicos, no un segundo backlog. No duplicar tarjetas de Trello como listas de tareas del repositorio.

## Ownership

### Ángel Patiño

- `services/match-service-go/`
- networking/realtime;
- PostgreSQL;
- `infra/`;
- Docker/Compose;
- CI/CD;
- observabilidad.

### Ricardo Beltrán

- `services/player-profile-service-rust/`
- perfil/economía/inventario;
- settlement;
- persistencia Rust del contexto `player`.

### Ralph Antar y Santiago Rivera

- `apps/web/`
- `apps/client-secondary/`
- frontend/UX;
- Game Design;
- assets e identidad visual;
- adaptación del prototipo al modo online.

## Reglas arquitectónicas

### Go

Go es Match Service y autoridad runtime. Debe contener rooms, active players, match lifecycle, authoritative race state, goroutines/channels, realtime, reconnection y race results.

No mover estas responsabilidades a Rust o frontend sin ADR.

### Rust

Rust es Player/Profile Service. Debe contener profile, inventory, catalog, economy, crafting, equipment, exchange y settlement.

Debe poder ejecutarse en múltiples réplicas y no guardar estado crítico exclusivo en memoria.

### Clientes

Nunca aceptar del cliente como verdad posición, vidas, pickups, ranking, recompensa o saldo.

## gRPC / Protobuf

- Contratos Go ↔ Rust viven en `proto/`.
- Evitar DTOs duplicados incompatibles.
- Cambios incompatibles requieren versionado/migración.
- Toda llamada gRPC debe considerar deadline.
- Retry solo si la operación es segura o idempotente.
- Cambios en contratos deben pasar `CI Contracts` y CI de ambos servicios.

## Persistencia

- Go: contexto `match`.
- Rust: contexto `player`.
- Go no escribe directamente datos privados de `player`.
- Operaciones económicas y settlement deben ser transaccionales e idempotentes.

## Resiliencia

- Go: circuit breaker, timeout, fallback, retry limitado.
- Envoy: health check, load balancing, failover.
- No configurar retries agresivos simultáneamente en Go y Envoy.

Si Rust cae, Go mantiene salas/partidas y las funciones Player/Profile entran en modo degradado.

## Docker

El archivo raíz se llama **`compose.yml`**.

No crear `docker-compose.yml`.

## Calidad

### Go

```bash
gofmt -w .
go vet ./...
go test -race ./...
```

### Rust

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

`Cargo.lock` se versiona.

### Infra

```bash
docker compose config
```

## CI/CD

La documentación humana y operativa vive en `docs/ci-cd.md`.

No asumir que existe CD automático al laboratorio hasta que ese documento indique que está implementado.

## Git

- No trabajar directamente sobre `main`.
- Ramas cortas: `feature/*`, `fix/*`, `docs/*`, `chore/*`.
- PRs pequeños.
- `main` está protegida mediante ruleset.
- Actualizar docs cuando cambie arquitectura, contrato o despliegue.

## No hacer

- introducir Kafka, Kubernetes, Service Mesh o Saga sin requisito y aprobación;
- mover lógica autoritativa al navegador;
- acoplar Go a una IP fija de Rust;
- permitir autoacreditación de premios;
- commitear secretos;
- cambiar ownership de datos sin ADR.
