# PostgreSQL — E42

La instancia comparte hardware, pero `match` pertenece a Go y `player` a Rust. [E41](../docs/architecture/postgresql-schema.md) define las 13 tablas de negocio; `public.schema_migrations` es solo historial administrativo de despliegue. No hay FK entre schemas ni escritura por tick.

## Migrar y sembrar

`database/init/00-bootstrap.sql` conserva el bootstrap de schemas de Compose en volúmenes nuevos. La migración real es `migrations/0001_schema.up.sql`, aplicada de forma atómica por `0001_apply.sql`: toma un advisory lock de transacción, consulta la versión y registra `0001` en la misma transacción. Una segunda ejecución no vuelve a crear objetos. `scripts/migrate.sh` recorre los archivos `*_apply.sql` en orden; futuras versiones añaden un par `NNNN_apply.sql`/`NNNN_*.up.sql` y mantienen las migraciones ya aplicadas inmutables.

Se necesita una cuenta de despliegue con DDL/creación de roles (el `POSTGRES_USER` inicial de Compose sirve en desarrollo). Los roles `compunube_migrator`, `compunube_match_app` y `compunube_player_app` son **NOLOGIN**: las tablas pertenecen al migrator, mientras cada rol runtime obtiene USAGE/DML solo en su schema. H62 creará/configurará credenciales LOGIN separadas para los procesos; Compose todavía entrega la credencial compartida de bootstrap. Esto permite probar grants ahora sin afirmar que el aislamiento runtime ya está activado en Compose.

Con clientes PostgreSQL 17 instalados y `DATABASE_URL` de despliegue en el entorno:

```bash
sh database/scripts/migrate.sh
sh database/scripts/seed.sh
```

En Compose, sin instalar clientes en el host:

```bash
docker compose up -d postgres --wait
docker compose exec -T postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; export DATABASE_URL="postgresql://$POSTGRES_USER@127.0.0.1:5432/$POSTGRES_DB"; sh /opt/compunube-database/scripts/migrate.sh; sh /opt/compunube-database/scripts/seed.sh'
```

El seed solo añade **18 IDs/tipos de objeto** verificados en [`apps/web/dist/economy.js`](../apps/web/dist/economy.js). No crea versión activa de catálogo, entradas con precio/receta, perfiles, balances ni inventarios: el catálogo local todavía no es una publicación económica online aprobada. Rust/F52 decidirá cómo publicar un catálogo con versión y reglas confirmadas. Repetir el seed no duplica filas.

## Backup, restore y rollback

Los scripts reciben `DATABASE_URL` por entorno y no escriben credenciales en Git ni en logs. `backup.sh OUTPUT.dump` usa `pg_dump -Fc` y crea el archivo con permisos privados. `restore.sh BACKUP.dump` exige `RESTORE_CONFIRM=YES`, usa `pg_restore --clean --if-exists --exit-on-error` y **reemplaza objetos/datos de la base destino**. Verifique que el destino es el correcto y haga una copia previa. En un cluster nuevo, cree antes los roles de migración y runtime con el procedimiento de despliegue; `pg_dump` de una base no incluye roles globales. La prueba automatizada restaura en una base temporal del mismo cluster, donde ya existen esos roles.

```bash
sh database/scripts/backup.sh /ruta/segura/compunube.dump
RESTORE_CONFIRM=YES sh database/scripts/restore.sh /ruta/segura/compunube.dump
```

La migración inicial crea toda la estructura; su `down` destruiría datos y no es un rollback seguro. **No se ejecuta un down automático**. Para revertir un despliegue destructivo, detener escrituras, restaurar backup compatible y volver a la revisión de aplicación correspondiente. Un cambio futuro no destructivo puede tener su propia migración inversa documentada. No ejecutar restore sobre la base de producción para probar un backup: usar una base/cluster aislado y verificar filas, versiones y permisos.

## Verificación

`scripts/smoke.sh` corre dentro del contenedor PostgreSQL de Compose: crea esquema limpio, reaplica migración, comprueba 13 tablas y 18 referencias, prueba balance negativo y DML cruzado con `SET ROLE`, agrega una fila fixture solo en la base efímera, hace backup, restaura en otra base efímera y compara el dato. CI Integration lo ejecuta y limpia el volumen al terminar. Para reproducirlo localmente use un proyecto Compose aislado; **el smoke inserta un fixture** y no debe ejecutarse contra datos persistentes reales.

```bash
docker compose -p compunube-e42-test up -d postgres --wait
docker compose -p compunube-e42-test exec -T postgres sh /opt/compunube-database/scripts/smoke.sh
docker compose -p compunube-e42-test down -v
```
