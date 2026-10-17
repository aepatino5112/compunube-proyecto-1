# Compunube Proyecto 1

Proyecto de Computación en la Nube orientado a un videojuego multijugador educativo sobre las 3R y el agua.

## Arquitectura base

- **Frontend / clientes:** web Surf Club con TypeScript como objetivo de migración gradual desde el JavaScript actual y segunda interfaz en Python ([ADR 0002](docs/adr/0002-client-language-strategy.md)); ambos envían intención a Go y representan estado confirmado.
- **Go Match Service:** salas, jugadores activos, simulación autoritativa, red realtime, goroutines/channels y resiliencia.
- **Rust Player/Profile Service:** perfil persistente, inventario, catálogo, economía, crafting, equipamiento y settlement de carreras.
- **gRPC + Protobuf:** comunicación interna Go ↔ Rust.
- **Envoy:** Ambassador/load balancer delante de las réplicas Rust.
- **PostgreSQL:** persistencia con ownership lógico separado por contexto.
- **Prometheus + Grafana:** observabilidad.

Consulta [ARCHITECTURE.md](ARCHITECTURE.md) y [AGENTS.md](AGENTS.md) antes de cambiar límites de servicios.

## Documentación

- [Arquitectura](ARCHITECTURE.md)
- [Roadmap técnico](docs/roadmap.md)
- [Línea base funcional del frontend (B08)](docs/product/frontend-baseline.md)
- [Decisiones de producto multijugador (B09)](docs/product/multiplayer-decisions.md)
- [Flujo completo del jugador online (B10)](docs/product/online-player-flow.md)
- [Core gameplay loop y autoridad online (B13)](docs/product/core-gameplay-loop.md)
- [Audiencia y objetivos educativos (B12)](docs/product/educational-goals.md)
- [Diseño de las tres R y decisión de Reducir (B14)](docs/product/three-r-design.md)
- [Agua como objetivo compartido de carrera (B15)](docs/product/water-objective.md)
- [Reglas autoritativas de carrera y clasificación (B16)](docs/product/authoritative-race-rules.md)
- [Ciclo de sala y participación multijugador (B17)](docs/product/multiplayer-room-lifecycle.md)
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

Abrir http://127.0.0.1:4173/. La demo incluye dos mapas y tres rivales de IA. Los adaptadores de salas y perfil siguen sin conectar al backend. Para instalar dependencias y validar el frontend: `npm ci`, `npm run check` y `npm test` desde `apps/web`.

## Requisitos del stack backend

- Docker Desktop con `docker compose`
- Go 1.24+ para desarrollo directo del Match Service
- Rust 1.99 para mantener consistencia con CI/Docker
- Make (opcional)

## Inicio rápido

```bash
cp .env.example .env
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

El CD hacia las máquinas del laboratorio está planificado pero pendiente; ver [docs/ci-cd.md](docs/ci-cd.md).
