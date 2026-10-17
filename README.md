# Compunube Proyecto 1

Proyecto de Computación en la Nube orientado a un videojuego multijugador educativo sobre las 3R y el agua.

## Arquitectura base

- **Frontend / clientes:** envían intención y representan el estado confirmado por el servidor.
- **Go Match Service:** salas, jugadores activos, simulación autoritativa, red realtime, goroutines/channels y resiliencia.
- **Rust Player/Profile Service:** perfil persistente, inventario, catálogo, economía, crafting, equipamiento y settlement de carreras.
- **gRPC + Protobuf:** comunicación interna Go ↔ Rust.
- **Envoy:** Ambassador/load balancer delante de las réplicas Rust.
- **PostgreSQL:** persistencia con ownership lógico separado por contexto.
- **Prometheus + Grafana:** observabilidad.

Consulta [ARCHITECTURE.md](ARCHITECTURE.md) y [AGENTS.md](AGENTS.md) antes de cambiar límites de servicios.

## Documentación

- [Arquitectura](ARCHITECTURE.md)
- [CI/CD](docs/ci-cd.md)
- [Contribución y flujo Git](CONTRIBUTING.md)
- [Ownership](docs/OWNERSHIP.md)
- [ADRs](docs/adr/)
- [Reglas para agentes de IA](AGENTS.md)

## Requisitos locales

- Docker Desktop con `docker compose`
- Go 1.24+ para desarrollo directo del Match Service
- Rust stable para desarrollo directo del Player/Profile Service
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

El proyecto usa **Fast Deployment + Kanban**: ramas cortas, integración frecuente y cambios pequeños que mantengan `main` cerca de un estado desplegable.

El estado actual tiene CI automatizado. El CD hacia las máquinas del laboratorio está planificado pero no se implementará hasta cerrar el mecanismo de acceso/despliegue; ver [docs/ci-cd.md](docs/ci-cd.md).

Este bootstrap instala estructura técnica y skeletons. No implementa todavía la lógica completa del juego.
