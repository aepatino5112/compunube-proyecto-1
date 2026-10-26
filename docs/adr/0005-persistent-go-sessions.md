# ADR 0005: Sesiones de Go persistentes en `match.sessions` (F48)

- Status: Accepted
- Date: 2026-10-26

## Contexto

F48 guardaba las sesiones solo en la memoria del proceso Go (`identity.Registry`). Reiniciar Go (despliegue, rollback, caída) invalidaba todos los tokens: el cliente creaba una sesión nueva con otro `playerId` y perdía el acceso a su perfil online, aunque sus datos siguieran en `player.*` (lo observó I73). La identidad es de Go, así que su persistencia pertenece al contexto `match`.

## Decisión

- Migración `0003`: tabla `match.sessions(token_hash BYTEA PK, player_id TEXT UNIQUE, created_at)`. Solo se guarda el **SHA-256 del token** (32 bytes, CHECK); el token nunca se persiste. Sin FK entre esquemas; Rust no lee `match.*`.
- `POST /v1/sessions` guarda la sesión además de en memoria. Si PostgreSQL no responde (plazo de 1 s), la sesión funciona en ese proceso y se registra `session_persist_failed`: no sobreviviría a un reinicio.
- Un token desconocido para el proceso se busca una vez en `match.sessions`; si existe, se carga en memoria con el mismo `playerId` y las siguientes peticiones no tocan la base. Si PostgreSQL no responde, la búsqueda falla cerrada como token desconocido (`401 SESSION_REQUIRED`), porque E45 no define otro resultado para la sesión; se registra `session_restore_failed`.
- Sin `DATABASE_URL`, Go se comporta como antes (solo memoria) y lo avisa al arrancar.

## Consecuencias

- Tras reiniciar Go, el mismo token sigue identificando al mismo jugador y su perfil online (I73 lo verifica con el stack real).
- Contratos E43/E45 sin cambios; cookie y Bearer iguales.
- Las sesiones no expiran, igual que antes (la cookie es de sesión del navegador). Definir expiración o revocación queda como decisión futura; `created_at` permite aplicarla.
- Si PostgreSQL está caído **y** Go se reinició, un token anterior recibe 401 hasta que PostgreSQL vuelva; un cliente que cree sesión nueva en ese intervalo obtiene otra identidad.
- Una conexión a la base por token desconocido: la consulta es por clave primaria y los tokens falsos no se cachean.
