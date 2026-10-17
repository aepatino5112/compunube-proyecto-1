# Database

Una sola instancia PostgreSQL se usa en laboratorio con ownership lógico separado:

- `match`: Go Match Service.
- `player`: Rust Player/Profile Service.

## Reglas

- Go no modifica directamente datos privados de `player`.
- Rust no modifica estado runtime de partidas.
- Economía debe ser transaccional.
- Settlement debe ser idempotente por identificadores estables.

`database/init/` es solo bootstrap de desarrollo. Migraciones versionadas de negocio irán en `database/migrations/`.
