# I75 · Manual de instalación y operación

Instalación desde un checkout limpio. Todo funciona sin Internet una vez descargadas las imágenes base y las dependencias (los recursos del juego, Three.js y los manifiestos van en el repositorio).

## Requisitos

| Componente | Versión usada en CI | Uso |
| --- | --- | --- |
| Docker Engine + Compose v2 | runner `ubuntu-latest` | stack completo |
| Windows 10 | — | WSL2 + Docker Desktop (pendiente de verificar en el laboratorio, A05) |
| Node.js | 24 | cliente web (`apps/web`) |
| Python | 3.12 (≥ 3.11) | cliente secundario (`apps/client-secondary`) |
| Go / Rust | 1.24 / 1.99 | solo para desarrollar los servicios fuera de Docker |

## Variables y puertos

Copiar `.env.example` a `.env` (no se versiona) y completar los **cinco secretos** con `openssl rand -hex 24`:

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | sí | administrador PostgreSQL (bootstrap y migraciones) |
| `MATCH_DB_PASSWORD` | sí | rol runtime de Go (`match.*`) |
| `PLAYER_DB_PASSWORD` | sí | rol runtime de Rust (`player.*`) |
| `MONITOR_DB_PASSWORD` | sí | rol de postgres-exporter |
| `GRAFANA_ADMIN_PASSWORD` | sí | administrador de Grafana |
| `POSTGRES_USER`, `POSTGRES_DB` | no (`compunube`) | identidad de la base |
| `COMPUNUBE_IMAGE_TAG`, `COMPUNUBE_REVISION` | no (`dev`) | revisión desplegada (las fija `deploy.sh`) |

| Puerto (variable) | Servicio | ¿Lo usan los clientes? |
| --- | --- | --- |
| 8080 (`GO_HTTP_PORT`) | Go: HTTP E45 y WebSocket `/v1/realtime` | **sí** |
| 4173 (`COMPUNUBE_WEB_PORT`) | cliente web (`server.mjs`) | sí, en el equipo del jugador |
| 50051 / 9901 (`ENVOY_GRPC_PORT` / `ENVOY_ADMIN_PORT`) | Envoy gRPC / admin | no (interno, diagnóstico) |
| 5432 (`POSTGRES_PORT`) | PostgreSQL | no |
| 9090 / 3000 (`PROMETHEUS_PORT` / `GRAFANA_PORT`) | Prometheus / Grafana | no (operación y demo) |

## Arranque y pruebas de humo

```bash
scripts/deploy/deploy.sh        # preflight, copia previa, build, up --wait, smoke y versión
```

o manualmente:

```bash
docker compose up -d --build --wait
curl -fsS localhost:8080/healthz && curl -fsS localhost:8080/readyz
curl -fsS localhost:9901/clusters | grep -c 'health_flags::healthy$'   # 2
curl -fsS -X POST localhost:8080/v1/sessions                          # sesión pública
```

Clientes:

```bash
(cd apps/web && COMPUNUBE_GO_URL=http://127.0.0.1:8080 npm start)      # http://127.0.0.1:4173
(cd apps/client-secondary && python -m pip install -r requirements.txt \
  && python -m compunube_client play --create maracaibo)
```

Observabilidad: Grafana en `http://127.0.0.1:3000` (usuario `GRAFANA_ADMIN_USER`, contraseña del `.env`), dashboard **Compunube Operations**.

## Actualización y rollback

Ver [H66](../deployment/h66-deploy-procedure.md): `git pull` + `scripts/deploy/deploy.sh`; `scripts/deploy/rollback.sh` vuelve a la revisión anterior verificada.

## Copia de seguridad y restauración

```bash
# copia (también la hace deploy.sh antes de cada actualización)
docker compose exec -T postgres sh -c 'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backup.dump
# restauración DESTRUCTIVA, con Go y Rust detenidos
docker compose stop match-service-go player-profile-rust-1 player-profile-rust-2
docker compose exec -T postgres sh -c 'pg_restore --exit-on-error --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup.dump
docker compose up -d --wait
```

`database/scripts/smoke.sh` (paso E42 de CI Integration) prueba copia y restauración en una base aparte en cada ejecución. Ver también [database/README.md](../../database/README.md).

## Runbooks y diagnóstico

- [Diagnóstico de problemas frecuentes](../operations/troubleshooting.md).
- Servicio Rust: [runbook operativo](../runbooks/rust-player-profile-service.md) (I74-R1, Ricardo Beltrán).
- Resiliencia y degradación: [E38](../architecture/resilience-failover-degraded-mode.md), [H69](../evidence/h69-grafana.md).

## Detener

```bash
docker compose down        # conserva datos
docker compose down -v     # borra volúmenes (datos de PostgreSQL, Prometheus y Grafana)
```
