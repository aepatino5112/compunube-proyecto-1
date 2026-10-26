# H66 · Procedimiento de despliegue y actualización

Procedimiento repetible para desplegar, actualizar y revertir el stack con Docker Compose usando [`scripts/deploy/deploy.sh`](../../scripts/deploy/deploy.sh) y [`scripts/deploy/rollback.sh`](../../scripts/deploy/rollback.sh). **Estado:** validado en CI (workflow **CI Deploy** sobre un runner Ubuntu limpio). **No** se ha ejecutado todavía en los equipos del laboratorio: la topología física depende de la auditoría A05 y de D31.

## Qué garantiza

| Requisito | Cómo se cumple |
| --- | --- |
| Configuración externa | Puertos, credenciales y revisión salen del archivo de entorno (`COMPUNUBE_ENV_FILE`, por defecto `.env`). Compose no contiene IPs de laboratorio. |
| Secretos fuera de Git | `.env` está ignorado. `deploy.sh` se niega a continuar si el archivo falta, si `.env` no está ignorado, si falta uno de los cinco secretos (`POSTGRES_PASSWORD`, `MATCH_DB_PASSWORD`, `PLAYER_DB_PASSWORD`, `MONITOR_DB_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`) o si Grafana usa `admin`. Los valores nunca se imprimen. |
| Imágenes identificables | Go y Rust se construyen como `compunube-match-service:<rev>` y `compunube-player-profile-service:<rev>` con la etiqueta OCI `org.opencontainers.image.revision=<rev>`. Por defecto `<rev>` es el commit (`-dirty` si hay cambios sin confirmar). |
| Orden y health checks | `docker compose up --wait`: PostgreSQL sano → `db-migrate` (migraciones + roles runtime) → `rust-1`/`rust-2` con health gRPC → Envoy → Go. |
| Verificación tras desplegar | `/healthz` y `/readyz` de Go, dos hosts Rust sanos en Envoy, `POST /v1/sessions` y la revisión de las tres imágenes en ejecución igual a la desplegada. |
| Copia previa | Si PostgreSQL ya está en marcha, se guarda `pg_dump` en `.deploy/backups/<fecha>-before-<rev>.dump` (permisos `0600`, carpeta `0700`). |
| Historial | `.deploy/history` registra fecha, revisión y copia de cada despliegue y reversión. |
| Reversión | `rollback.sh [rev]` vuelve a la revisión anterior **sin reconstruir**, verificando la versión. La restauración de base de datos es opcional y explícita. |

## Uso

```bash
cp .env.example .env               # una vez; completar los cinco secretos (openssl rand -hex 24)
scripts/deploy/deploy.sh           # desplegar/actualizar la revisión actual del checkout
scripts/deploy/rollback.sh         # volver a la revisión desplegada anteriormente
scripts/deploy/rollback.sh <rev>   # volver a una revisión concreta cuya imagen siga en el equipo
```

Actualizar = `git pull` (o cambiar al tag de release) y volver a ejecutar `deploy.sh`. Las migraciones son de avance: si la revisión nueva cambió el esquema y hay que volver atrás, se restaura la copia registrada para ese despliegue (operación **destructiva**, detiene Go y Rust durante la restauración):

```bash
RESTORE_BACKUP=.deploy/backups/<archivo>.dump RESTORE_CONFIRM=YES scripts/deploy/rollback.sh <rev>
```

## Evidencia en CI

CI Deploy: rechaza un archivo de entorno con un secreto vacío; despliega `ci-a`; despliega `ci-b` y comprueba que se creó la copia de PostgreSQL; revierte a `ci-a` sin reconstruir y verifica la etiqueta de revisión de Go y ambas Rust; limpia contenedores y volúmenes.

## Pendiente del laboratorio (bloqueo humano)

1. **A05**: confirmar equipos, hostname/IP, Windows 10, WSL2 y Docker, recursos, firewall y puertos. Ninguna dirección se fija aquí hasta tenerla.
2. **D31/D33**: decidir qué servicio corre en qué equipo. Este procedimiento despliega el stack completo en **un** host Docker; repartir Go, Rust ×2, Envoy y PostgreSQL entre varios equipos requiere ajustar Compose (o un archivo por host) con los datos de A05.
3. **Navegadores en otros equipos**: Go emite la cookie de sesión con `Secure`. Los navegadores la aceptan en `http://localhost`/`127.0.0.1`, pero **no** sobre `http://<IP del laboratorio>`. Para que el cliente web funcione desde otros equipos se sirve por HTTPS (`server.mjs` con `COMPUNUBE_TLS_CERT`/`COMPUNUBE_TLS_KEY`) y Go recibe el origen público en `PUBLIC_ORIGINS`: pasos en la [guía HTTPS](https-lab.md). El cliente Python no está afectado porque usa `Authorization: Bearer`. Falta ejecutarlo con la IP real del laboratorio (A05).
4. **Puertos expuestos**: Compose publica PostgreSQL, Envoy (gRPC y admin), Prometheus y Grafana en todas las interfaces del host. En el laboratorio conviene limitarlos al host o a la red docente con el firewall de Windows; los clientes solo necesitan el puerto público de Go (y el del cliente web).
5. Ejecutar `deploy.sh` y `rollback.sh` en el host del laboratorio y anotar la evidencia en H66/I76. No se ha hecho.
