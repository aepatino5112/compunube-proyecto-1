# I72 · E2E, concurrencia y carga

Harness: [`scripts/validation/i72-e2e-concurrency.py`](../../scripts/validation/i72-e2e-concurrency.py), proyecto Compose aislado `compunube-i72` en el runner `ubuntu-latest` de GitHub Actions (hardware compartido, **no** equivalente al laboratorio).

**Método:** 3 salas × 4 clientes Python reales compitiendo a la vez solo por HTTP E45 y WebSocket E43 (piloto automático, Reducir alternado). En la primera sala un cliente sale a los 10 s. Se mide el intervalo de llegada de snapshots en cada cliente, la latencia de `GET /v1/profile` y `docker stats` cada ≈3 s durante la carrera. No hay objetivo numérico predefinido: las cifras son mediciones de esta ejecución.

**Ejecución:** [run 40270374298](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40270374298) (PR #77) → `RESULT: PASS`, 57 comprobaciones, 142,3 s, teardown completo.

| Comprobación | Resultado |
| --- | --- |
| 12 clientes reciben `race.ended`; un único resultado por sala | PASS |
| Salida voluntaria registrada como `left`, sin puesto ni crédito | PASS |
| Solo `finished` tiene puesto; crédito = recogido; resto 0 | PASS |
| Cada residuo con un único propietario, coherente con los contadores | PASS |
| Settlement `confirmed` a todos los clientes conectados | PASS |
| `match.settlement_delivery` 4/4 `confirmed` por carrera; `match.race_participants` 4 filas | PASS |
| `player.settlements` = 4 filas por carrera y suma igual al crédito de Go (59/25, 56/28, 63/30 plástico/chatarra) | PASS |
| Perfil de cada jugador acreditado exactamente una vez | PASS |

| Medición (12 clientes simultáneos) | Valor |
| --- | --- |
| Intervalo entre snapshots | p50 100,0 ms · p95 101,0 ms · p99 101,4 ms · máx 103,2 ms (contrato: 100 ms) |
| `GET /v1/profile` | n=12 · p50 2,9 ms · p95 42,0 ms · máx 95,5 ms |
| Frames de error realtime | 3 × `RACE_NOT_ACTIVE` (entradas que llegaron tras el cierre de la carrera) |
| CPU máx / media | Go 3,9 % / 1,6 % · PostgreSQL 3,4 % / 1,3 % · cada Rust 2,0 % / ≤0,5 % · Envoy 0,2 % |
| Memoria al final | Go 11,7 MiB · Rust 1,7–1,9 MiB · PostgreSQL 64,4 MiB · Envoy 21,7 MiB |

Limitaciones: hardware del runner, no del laboratorio; clientes Python sin renderizado (la carga de navegadores no se midió); no se probó el límite de salas/conexiones (cubierto por pruebas Go de admisión).

**Desde #112:** esta validación corre bajo demanda en el workflow **E2E Race** (Actions → E2E Race → Run workflow), no en CI Integration: cada carrera de 1800 m tarda minutos en un runner alojado.
