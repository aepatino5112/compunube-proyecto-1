# PostgreSQL — E42

La instancia comparte hardware, pero `match` pertenece a Go y `player` a Rust. [E41](../docs/architecture/postgresql-schema.md) define las 13 tablas de negocio; `public.schema_migrations` es solo historial administrativo de despliegue. No hay FK entre schemas ni escritura por tick.

## Migrar y sembrar

`database/init/00-bootstrap.sql` conserva el bootstrap de schemas de Compose en volúmenes nuevos. La migración inicial es `migrations/0001_schema.up.sql`, aplicada de forma atómica por `0001_apply.sql`: toma un advisory lock de transacción, consulta la versión y registra `0001` en la misma transacción. Una segunda ejecución no vuelve a crear objetos. `scripts/migrate.sh` recorre los archivos `*_apply.sql` en orden; futuras versiones añaden un par `NNNN_apply.sql`/`NNNN_*.up.sql` y mantienen las migraciones ya aplicadas inmutables.

Se necesita una cuenta de despliegue con DDL/creación de roles (el `POSTGRES_USER` inicial de Compose sirve en desarrollo). Los roles `compunube_migrator`, `compunube_match_app` y `compunube_player_app` son **NOLOGIN**: las tablas pertenecen al migrator. J84 añade tres LOGIN separados: `compunube_match_runtime` hereda solo `compunube_match_app`, `compunube_player_runtime` hereda solo `compunube_player_app`, y `compunube_monitor_runtime` hereda `pg_monitor` para postgres-exporter. Rust readiness requiere leer la versión aplicada, por lo que `compunube_player_app` recibe únicamente SELECT en `public.schema_migrations`; no puede escribir esa tabla. El proceso administrativo `db-migrate` aplica las migraciones y provisiona/rota los LOGIN de modo idempotente antes de arrancar las aplicaciones. Go, Rust y exporter no reciben la cuenta administrativa.

Las contraseñas se entregan solo por entorno: `POSTGRES_PASSWORD`, `MATCH_DB_PASSWORD`, `PLAYER_DB_PASSWORD`, `MONITOR_DB_PASSWORD`. `compose.yml` las exige; `.env.example` deja los campos vacíos. Genere valores distintos, URL-safe (por ejemplo, `openssl rand -hex 24`), en un `.env` local ignorado por Git o mediante el gestor de secretos del despliegue. Para rotarlas, cambie los valores en el entorno y vuelva a ejecutar `docker compose up -d --force-recreate db-migrate`, seguido de la recreación de Go, ambas Rust y postgres-exporter. El bootstrap actualiza los passwords; la renovación no toca migraciones históricas ni datos. En producción el principal de migración debe ser una identidad administrativa separada, con el mismo alcance DDL/creación de roles, nunca la identidad runtime.

Con clientes PostgreSQL 17 instalados y `DATABASE_URL` de despliegue en el entorno:

```bash
sh database/scripts/migrate.sh
sh database/scripts/seed.sh
```

En Compose, sin instalar clientes en el host:

```bash
docker compose up -d db-migrate --wait
docker compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; export DATABASE_URL="postgresql://$POSTGRES_USER@127.0.0.1:5432/$POSTGRES_DB"; sh /opt/compunube-database/scripts/seed.sh'
```

El seed añade las **18 referencias de objeto** verificadas en [`apps/web/dist/economy.js`](../apps/web/dist/economy.js) (no crea perfiles, balances ni inventarios). Repetirlo no duplica filas. Los 4 personajes y el catálogo online no dependen del seed: los registra la migración `0002`.

### Migración 0002 (F52): catálogo `online-v1` y rechazos

`0002_apply.sql` (+ `0002_online_catalog.up.sql`) sigue la convención de `0001`: advisory lock, registro de la versión `0002` y reaplicación sin efecto. Añade, todo idempotente (`ON CONFLICT DO NOTHING` / `IF NOT EXISTS`):

- `player.economic_operations.rejection_code` con CHECK de los 9 códigos de `MutationRejectionCode` y CHECK `status = 'rejected'` ⇔ código presente, para que un retry de una petición rechazada devuelva el mismo código (E1).
- Las 22 referencias de objeto (las 18 del seed más `nico`, `luna`, `amara`, `samuel`), de modo que el catálogo no dependa de haber ejecutado el seed (E3).
- La versión de catálogo `online-v1`, publicada y activa (salvo que ya hubiera otra activa), con una entrada por cada uno de los 22 objetos: nombre, descripción, precio y receta **copiados de `economy.js`** y color/rareza/apariencia del personaje como `metadata` JSONB de strings. `price_coins` es `NULL` en las redes con receta (no se venden). Las tasas de canje (plástico 4, metal 6) y las opciones de piel/color de cabello no tienen tabla: son constantes del dominio Rust ligadas a `online-v1`.

El servicio Rust exige que `0002` esté aplicada para pasar a `SERVING`.

### Migración 0003 (F48): sesiones de Go

`0003_apply.sql` (+ `0003_match_sessions.up.sql`), misma convención. Crea `match.sessions(token_hash BYTEA PK CHECK 32 bytes, player_id TEXT UNIQUE, created_at)` con permisos DML para `compunube_match_app`. Guarda solo el hash del token, nunca el token; permite que Go conserve las sesiones al reiniciarse ([ADR 0005](../docs/adr/0005-persistent-go-sessions.md)). Sin FK entre esquemas.

## Backup, restore y rollback

Los scripts reciben `DATABASE_URL` por entorno y no escriben credenciales en Git ni en logs. `backup.sh OUTPUT.dump` usa `pg_dump -Fc` y crea el archivo con permisos privados. `restore.sh BACKUP.dump` exige `RESTORE_CONFIRM=YES`, usa `pg_restore --clean --if-exists --exit-on-error` y **reemplaza objetos/datos de la base destino**. Verifique que el destino es el correcto y haga una copia previa. En un cluster nuevo, cree antes los roles de migración y runtime con el procedimiento de despliegue; `pg_dump` de una base no incluye roles globales. La prueba automatizada restaura en una base temporal del mismo cluster, donde ya existen esos roles.

```bash
sh database/scripts/backup.sh /ruta/segura/compunube.dump
RESTORE_CONFIRM=YES sh database/scripts/restore.sh /ruta/segura/compunube.dump
```

La migración inicial crea toda la estructura; su `down` destruiría datos y no es un rollback seguro. **No se ejecuta un down automático**. Para revertir un despliegue destructivo, detener escrituras, restaurar backup compatible y volver a la revisión de aplicación correspondiente. Un cambio futuro no destructivo puede tener su propia migración inversa documentada. No ejecutar restore sobre la base de producción para probar un backup: usar una base/cluster aislado y verificar filas, versiones y permisos.

## Verificación

`scripts/smoke.sh` corre dentro del contenedor PostgreSQL de Compose: crea esquema limpio, reaplica migración, comprueba 13 tablas, 22 referencias, el catálogo `online-v1` (22 entradas) y la columna `rejection_code`, prueba balance negativo y DML cruzado con `SET ROLE`, agrega una fila fixture solo en la base efímera, hace backup, restaura en otra base efímera y compara el dato. `scripts/smoke-runtime.sh` usa los LOGIN reales y prueba SELECT/INSERT/UPDATE/DELETE positivos en el schema propio y rechazados en el ajeno. CI Integration ejecuta ambos y limpia el volumen al terminar. Para reproducirlo localmente use un proyecto Compose aislado; **el smoke E42 inserta un fixture** y no debe ejecutarse contra datos persistentes reales.

```bash
docker compose -p compunube-e42-test up -d --wait
docker compose -p compunube-e42-test exec -T postgres sh /opt/compunube-database/scripts/smoke.sh
docker compose -p compunube-e42-test run --rm --no-deps db-migrate sh /opt/compunube-database/scripts/smoke-runtime.sh
docker compose -p compunube-e42-test down -v
```
