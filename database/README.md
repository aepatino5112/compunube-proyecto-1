# Database

Una sola instancia PostgreSQL se usa en laboratorio con ownership lógico separado:

- `match`: Go Match Service.
- `player`: Rust Player/Profile Service.

El modelo físico objetivo, constraints, índices, transacciones y roles se documentan en [E41](../docs/architecture/postgresql-schema.md).

## Reglas

- Go no modifica directamente datos privados de `player`.
- Rust no modifica estado runtime de partidas.
- Economía debe ser transaccional.
- Settlement debe ser idempotente por `(raceId, playerId)`.
- Operaciones económicas mutables deben deduplicarse por `(playerId, requestId)`.
- No se persiste el tick de carrera ni se crean claves foráneas entre `match` y `player`.

## Estado de implementación

`database/init/` es solo bootstrap de desarrollo y actualmente crea ambos schemas. El `compose.yml` todavía usa una misma credencial PostgreSQL para Go y Rust, por lo que el ownership está documentado pero aún no se fuerza mediante permisos separados.

Las migraciones versionadas de negocio, grants, seeds, rollback y recuperación corresponden a E42 y se ubicarán en `database/migrations/`.
