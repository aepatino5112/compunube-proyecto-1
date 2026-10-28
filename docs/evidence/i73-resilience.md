# I73 · Resiliencia y failover con clientes reales

Harness: [`scripts/validation/i73-resilience.py`](../../scripts/validation/i73-resilience.py), proyecto Compose aislado `compunube-i73` (solo datos efímeros), ejecutado en CI Integration.

**Ejecución:** [run 40270377884](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40270377884) (PR #78) → `RESULT: PASS`, 19 comprobaciones, 137,5 s, teardown completo.

## Carrera A (dos clientes Python)

| Paso | Observado |
| --- | --- |
| Corte abrupto del socket del invitado (`shutdown`) | Reconectó y volvió a `racing` en 0,5 s; recibe snapshots nuevos; su siguiente `seq` supera `lastProcessedInputSeq` |
| `docker kill` rust-1 | El perfil público respondió vía rust-2 en 1,3 s; la carrera siguió |
| `docker kill` rust-2 | `503 PROFILE_UNAVAILABLE` en 0,8 s; ambos clientes siguieron recibiendo snapshots |
| Fin de carrera con Rust caído | `race.ended` con `settlementState: pending`; `match.settlement_delivery` = 2 `pending` |
| `docker compose restart match-service-go` | Las filas siguieron `pending`. En la ejecución original los tokens previos dejaban de ser válidos (sesiones en memoria); desde #94 siguen válidos (ver abajo) |
| Arranque de rust-1 y rust-2 | Rust sano en 4,5 s; entregas `confirmed` 4,3 s después |
| Crédito | `player.settlements` 2 filas, 58/27 = crédito de Go; saldos (`player.profiles`) acreditados una sola vez |

## Carrera B: caída de PostgreSQL

| Paso | Observado |
| --- | --- |
| `docker compose stop postgres` a los 3 s de carrera | La carrera siguió (no hay escritura por tick) y terminó para ambos |
| `docker compose start postgres` | Resultado persistido y entregas `confirmed` en 0,7 s; el cliente conectado recibió `race.ended` confirmado |
| Crédito | `player.settlements` 2 filas, 42/21 = crédito de Go; saldos acreditados una vez (el invitado no terminó: 0) |

## Hallazgos y límites

- **Sesiones (F48), resuelto en #94 ([ADR 0005](../adr/0005-persistent-go-sessions.md)):** [run 40395099083](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40395099083) → tras `docker compose restart match-service-go` las sesiones previas siguen válidas con el mismo `playerId`; `match.sessions` guarda un hash de 32 bytes por jugador (nunca el token); al volver Rust, anfitrión e invitado leen por Go su perfil acreditado con la sesión anterior al reinicio.
- **Resultado en memoria durante la caída de PostgreSQL:** Go reintenta cada segundo; un reinicio de Go durante esa ventana perdería el resultado. No se forzó.
- El cliente web cubre la reentrada en su propia integración (G61); esta prueba usa clientes Python.
- Entorno: runner de GitHub Actions; no es el laboratorio.

**Desde la PR de carreras bajo demanda:** esta validación corre en el workflow **E2E Race** (Actions → E2E Race → Run workflow), no en CI Integration: cada carrera de 1800 m tarda minutos en un runner alojado.
