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

Pruebas unitarias del cliente (`pytest`, 20 en #70; 33 desde #92) en CI Client Secondary: Ubuntu y Windows (Python 3.12).

## Ventana gráfica (Tkinter) — PR #92

`python -m compunube_client gui`. [`scripts/validation/g58-python-gui.py`](../../scripts/validation/g58-python-gui.py) maneja la **ventana real** bajo Xvfb contra el stack de CI Integration (Go → Envoy → Rust → PostgreSQL), con un segundo cliente Python que entra con el código de sala mostrado.

**Ejecución:** [run 40379198875](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40379198875) → `RESULT: PASS`, 21 comprobaciones, 53,1 s:

- sesión emitida por Go, 22 objetos del catálogo y perfil confirmado en la ventana;
- botón *Equipar* confirmado por Go (`requestId`), revisión de perfil +1;
- *Listo*/*Salir* deshabilitados sin sala; *Crear sala* muestra el código; el panel lista ambos miembros desde `room.state`; *Listo* exige la elección de Reducir;
- el lienzo dibujó ambos surfistas y residuos sin recoger desde los snapshots; HUD con tiempo, distancia, puesto y vidas;
- resultado en la ventana: `#1 Tú: llegó · 43.6 s · 43 plástico + 18 chatarra (acreditado)`, `#2 …: llegó · 49.0 s · 16 plástico + 7 chatarra (acreditado)`; mismo `raceId` que el otro cliente;
- el panel de perfil muestra exactamente el crédito (43 plástico, 18 chatarra) una vez; tras *Salir* se puede crear otra sala.

CI Client Secondary: 33 pruebas, 0 omitidas, en Ubuntu (Xvfb) y Windows, con la prueba de ventana obligatoria (`CLIENT_GUI_REQUIRED=1`). Los checks `client-secondary (ubuntu-latest)` y `client-secondary (windows-latest)` son obligatorios en `main`.

Limitación: Docker no está disponible en el WSL usado para desarrollar; la carrera real solo se ejecutó en CI.

**Desde #112:** esta validación corre bajo demanda en el workflow **E2E Race** (Actions → E2E Race → Run workflow), no en CI Integration: cada carrera de 1800 m tarda minutos en un runner alojado. Aplica solo a la ventana gráfica; el cliente de terminal (`g58-python-client.py`) sigue en CI Integration.
