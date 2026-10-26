# Compunube Proyecto 1

Proyecto de Computación en la Nube orientado a un videojuego multijugador educativo sobre las 3R y el agua.

## Arquitectura base

- **Clientes:** web Surf Club (Three.js; la integración online está en módulos TypeScript compilados en CI, `apps/web/src/net`) y segunda interfaz **Python** de terminal (`apps/client-secondary`), según [ADR 0002](docs/adr/0002-client-language-strategy.md). Ambos envían solo intenciones a Go por HTTP E45 y WebSocket E43 y presentan el estado confirmado.
- **Go Match Service:** salas, jugadores activos, simulación autoritativa, red realtime, goroutines/channels y resiliencia.
- **Rust Player/Profile Service:** perfil persistente, inventario, catálogo, economía, crafting, equipamiento y settlement de carreras.
- **gRPC + Protobuf:** comunicación interna Go ↔ Rust.
- **Envoy:** Ambassador/load balancer delante de las réplicas Rust.
- **PostgreSQL:** persistencia con ownership lógico separado por contexto.
- **Prometheus + Grafana:** observabilidad.

Consulta [ARCHITECTURE.md](ARCHITECTURE.md) y [AGENTS.md](AGENTS.md) antes de cambiar límites de servicios.

## Documentación

- [Arquitectura](ARCHITECTURE.md)
- [Modelo de dominio runtime y perfil (C25)](docs/architecture/domain-model.md)
- [Evaluación de estilos arquitectónicos CEN-03 (D26)](docs/architecture/architecture-evaluation.md)
- [Rust Player/Profile Service replicable (D29)](docs/architecture/rust-player-profile-service.md)
- [Esquema PostgreSQL y ownership (E41)](docs/architecture/postgresql-schema.md)
- [Migraciones y recuperación PostgreSQL (E42)](database/README.md)
- [Contrato realtime WebSocket v1 (E43)](contracts/realtime/events.md)
- [API HTTP pública y OpenAPI v1 (E45)](contracts/http/README.md)
- [Base del Go Match Service (F46)](services/match-service-go/README.md)
- [Contrato gRPC Player/Profile v1 (E43)](proto/README.md)
- [Catálogo de patrones cloud-native (E36)](docs/architecture/cloud-native-pattern-catalog.md)
- [Selección de patrones cloud-native (E37)](docs/architecture/cloud-native-pattern-selection.md)
- [Resiliencia y modo degradado (E38)](docs/architecture/resilience-failover-degraded-mode.md)
- [Bulkhead y backpressure de Go (E39)](docs/architecture/go-bulkhead-backpressure.md)
- [Health y readiness por instancia (E40)](docs/architecture/health-readiness-design.md)
- [Roadmap técnico](docs/roadmap.md)
- [Línea base funcional del frontend (B08)](docs/product/frontend-baseline.md)
- [Decisiones de producto multijugador (B09)](docs/product/multiplayer-decisions.md)
- [Flujo completo del jugador online (B10)](docs/product/online-player-flow.md)
- [Narrativa y contexto educativo (B11)](docs/product/narrative-context.md)
- [Core gameplay loop y autoridad online (B13)](docs/product/core-gameplay-loop.md)
- [Audiencia y objetivos educativos (B12)](docs/product/educational-goals.md)
- [Diseño de las tres R y decisión de Reducir (B14)](docs/product/three-r-design.md)
- [Agua como objetivo compartido de carrera (B15)](docs/product/water-objective.md)
- [Reglas autoritativas de carrera y clasificación (B16)](docs/product/authoritative-race-rules.md)
- [Ciclo de sala y participación multijugador (B17)](docs/product/multiplayer-room-lifecycle.md)
- [Game Design Document v1.0 (B18)](docs/product/game-design-document-v1.md)
- [Actores y casos de uso online (C19)](docs/requirements/online-use-cases.md)
- [UML de casos de uso online (C20)](docs/uml/README.md)
- [UML de estados de sala y participante (D35)](docs/uml/README.md)
- [UML de componentes (D32), despliegue (D33) y secuencias críticas (D34)](docs/uml/README.md)
- [Topología física (D31)](docs/deployment/d31-topology.md) y [auditoría del laboratorio (A05)](docs/deployment/a05-lab-audit.md)
- [Despliegue, actualización y rollback (H66)](docs/deployment/h66-deploy-procedure.md)
- [Matriz de trazabilidad y plan de pruebas (I70/C24)](docs/testing/traceability-matrix.md)
- [Evidencias de validación](docs/evidence/)
- [Cliente Python (G58)](apps/client-secondary/README.md)
- [Diagnóstico de problemas frecuentes](docs/operations/troubleshooting.md)
- [Runbook operativo del Rust Player/Profile Service](docs/runbooks/rust-player-profile-service.md)
- [Requisitos funcionales del MVP online (C21)](docs/requirements/functional-requirements.md)
- [Fast Deployment + Kanban](docs/project-management/fast-deployment-kanban.md)
- [CI/CD](docs/ci-cd.md)
- [Contribución y flujo Git](CONTRIBUTING.md)
- [Ownership](docs/OWNERSHIP.md)
- [ADRs](docs/adr/)
- [Reglas para agentes de IA](AGENTS.md)

Trello es la fuente operativa del backlog y del estado Kanban. El roadmap del repositorio solo resume la secuencia técnica del proyecto.

## Frontend jugable

El prototipo 3D, sus fuentes Blender y las guías de conexión están en [apps/web/](apps/web/README.md). Para ejecutar sólo el frontend:

```bash
cd apps/web
npm start
```

Abrir http://127.0.0.1:4173/. La demo local incluye dos mapas y tres rivales de IA. Para jugar online contra el stack, arrancar con `COMPUNUBE_GO_URL=http://127.0.0.1:8080 npm start`: `server.mjs` reenvía `/v1` y el WebSocket a Go en el mismo origen y «Con amigos» y «Mi progreso» usan Go → Envoy → Rust → PostgreSQL ([detalles](apps/web/README.md)). Para instalar dependencias y validar el frontend: `npm ci`, `npm run check` y `npm test` desde `apps/web`.

## Cliente Python

```bash
cd apps/client-secondary
python -m pip install -r requirements.txt
python -m compunube_client --server http://127.0.0.1:8080 play --create maracaibo
```

Ver [apps/client-secondary/README.md](apps/client-secondary/README.md) para perfil, economía, unirse a una sala y controles manuales.

## Requisitos del stack backend

- Docker Desktop con `docker compose`
- Go 1.24+ para desarrollo directo del Match Service
- Rust 1.99 para mantener consistencia con CI/Docker
- Make (opcional)

## Inicio rápido

```bash
cp .env.example .env
# Completar en .env cinco secretos distintos, URL-safe:
# POSTGRES_PASSWORD, MATCH_DB_PASSWORD, PLAYER_DB_PASSWORD, MONITOR_DB_PASSWORD,
# GRAFANA_ADMIN_PASSWORD (Grafana ya no arranca con admin/admin por defecto)
# Ejemplo para generar cada valor: openssl rand -hex 24
docker compose up -d --build
docker compose ps
```

## Servicios iniciales

| Servicio | Puerto |
| --- | ---: |
| Go Match Service | 8080 |
| Envoy / gRPC | 50051 |
| Envoy admin | 9901 |
| PostgreSQL | 5432 |
| Prometheus | 9090 |
| Grafana | 3000 |

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
curl http://localhost:8080/metrics
```

## Comandos

```bash
make up
make down
make logs
make test
make lint
make compose-config
```

## Flujo de trabajo

No se desarrolla directamente sobre `main`.

```text
feature/* ─┐
fix/*     ─┼──> Pull Request ──> CI ──> main
docs/*    ─┤
chore/*   ─┘
```

El proyecto usa **Fast Deployment + Kanban**: ramas cortas, integración frecuente y cambios pequeños.

El ruleset `Protect main` exige Pull Request y los checks `go`, `rust`, `validate`, `contracts` y `web`. Actualmente no exige aprobaciones obligatorias.

El despliegue se hace con [`scripts/deploy/deploy.sh`](docs/deployment/h66-deploy-procedure.md) (preflight, copia, verificación de versión y rollback), validado en CI Deploy. No hay CD automático al laboratorio y la ejecución en los equipos físicos sigue pendiente de A05; ver [docs/ci-cd.md](docs/ci-cd.md).
