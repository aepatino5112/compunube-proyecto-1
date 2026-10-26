# G58 · Cliente Python contra Go real

Harness: [`scripts/validation/g58-python-client.py`](../../scripts/validation/g58-python-client.py), proyecto Compose aislado `compunube-g58` (PostgreSQL, migraciones, rust-1/rust-2, Envoy, Go), ejecutado por CI Integration.

**Ejecución:** [run 40265326508](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40265326508) del PR #70 → `RESULT: PASS`, 23 comprobaciones, 72,4 s, teardown completo. PR integrado en `main` con merge `7ba2c7a`.

Observado:

- Dos sesiones distintas emitidas por Go; catálogo de 22 artículos servido por Go → Envoy → Rust.
- El WebSocket rechaza handshake sin sesión, con token falsificado y con subprotocolo `compunube.realtime.v1` ausente.
- Dos clientes Python (piloto automático) jugaron una carrera completa: ambos `finished`, con puesto y crédito igual a lo recogido; el snapshot final lista los 103 residuos una vez y la propiedad coincide con los contadores de cada jugador.
- Go republicó `race.ended` con `settlementState: confirmed`; el perfil Rust muestra exactamente el crédito, una vez.
- CLI: canje confirmado; repetir con el mismo `--request-id` devolvió replay y las monedas se acreditaron una sola vez; `buy sol` sin saldo muestra `INSUFFICIENT_COINS`.
- Latencias medidas en esa ejecución: `POST /v1/sessions` ≤ 0,8 ms, `GET /v1/profile` ≤ 71,1 ms, `GET /v1/catalog` 2,9 ms, crear/entrar sala ≤ 0,6 ms.

Pruebas unitarias del cliente (`pytest`, 20) en CI Client Secondary: Ubuntu y Windows (Python 3.12).

Limitación: Docker no está disponible en el WSL usado para desarrollar; la carrera real solo se ejecutó en CI.
