# Cliente secundario (Python)

Segunda interfaz requerida por la asignatura ([ADR 0002](../../docs/adr/0002-client-language-strategy.md), tarjeta G58). Es un cliente de terminal que usa **solo** la frontera pública de Go:

- HTTP E45 ([OpenAPI](../../contracts/http/openapi.yaml)): sesión, perfil, catálogo, mutaciones económicas y crear/entrar sala.
- WebSocket E43 ([contrato](../../contracts/realtime/events.md)): `/v1/realtime`, subprotocolo `compunube.realtime.v1`, mensajes `room.ready`, `room.leave`, `race.input` hacia Go y `room.state`, `race.start`, `race.snapshot`, `race.event`, `race.ended`, `error` desde Go.

No accede a Rust, Envoy ni PostgreSQL, y no ejecuta simulación, recogidas, ranking, premios ni saldo: presenta lo que Go confirma.

## Requisitos e instalación

Python 3.11 o superior (CI usa 3.12 en Linux y Windows). Desde `apps/client-secondary/`:

```sh
python -m venv .venv
. .venv/bin/activate            # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

La única dependencia de ejecución es `websockets==15.0.1` (fijada en `requirements.txt`); `requirements-dev.txt` añade `pytest==8.3.5`.

## Uso

El servidor por defecto es `http://127.0.0.1:8080` (puerto HTTP de Go en `compose.yml`); se cambia con `--server` o la variable `COMPUNUBE_SERVER`. Cada ejecución crea una sesión nueva salvo que se indique `--token-file`, que guarda el token de Go en un archivo privado (permisos `0600`) para reutilizar la misma identidad. El token es un secreto: no lo compartas ni lo subas al repositorio.

```sh
python -m compunube_client session                   # crea/recupera la identidad (playerId emitido por Go)
python -m compunube_client --token-file ~/.compunube-token profile
python -m compunube_client --token-file ~/.compunube-token catalog
python -m compunube_client --token-file ~/.compunube-token exchange plastic 3
python -m compunube_client --token-file ~/.compunube-token buy manglar
python -m compunube_client --token-file ~/.compunube-token equip manglar
python -m compunube_client --token-file ~/.compunube-token appearance dark black
```

Carrera:

```sh
python -m compunube_client play --create maracaibo          # imprime el código de sala
python -m compunube_client play --join <código> --manual     # otro jugador, controles por teclado
```

`play` crea o entra a la sala, abre el WebSocket, envía `room.ready` con la revisión de perfil confirmada y la elección de Reducir (`--reduce reusable|disposable`), juega y muestra el resultado de Go, el estado de settlement (`pending`/`confirmed`) y el perfil actualizado. Una carrera necesita entre dos y cuatro miembros listos; el cliente web y el cliente Python pueden compartir sala.

- Sin `--manual`, un **piloto automático** de demostración elige intenciones (girar, saltar, impulso, lado de la red) a partir del último snapshot. Go sigue decidiendo movimiento, choques, recogidas y resultados.
- Con `--manual`, se escribe una línea con teclas y se pulsa Enter: `a` izquierda, `d` derecha, `s` recto, `j` saltar, `b` impulso sí/no, `z`/`x` red izquierda/derecha, `q` salir. Funciona en terminales Linux y Windows sin dependencias adicionales.

## Garantías del cliente

- **Sesión:** Go emite `playerId` y token; el token viaja solo en `Authorization: Bearer`, nunca en la URL ni en mensajes realtime.
- **Idempotencia:** cada mutación lleva `requestId` y `catalogVersion`. Si el resultado es incierto (`504 MUTATION_OUTCOME_UNKNOWN` o fallo de transporte), el cliente reintenta la **misma** operación con el mismo `requestId`. Si se agotan los reintentos, imprime el `requestId` para repetir la orden con `--request-id` en lugar de crear una operación nueva. Solo los rechazos `4xx` de E45 son definitivos y no se reintentan; un `503 PROFILE_UNAVAILABLE` en una mutación puede llegar después de que Rust la aplicara, así que también se reintenta con el mismo `requestId`.
- **Secuencias:** `seq` y `jumpSeq` son monotónicas por carrera. Tras una reconexión dentro de la ventana de 15 s, el cliente espera el snapshot completo y continúa por encima de `lastProcessedInputSeq`/`lastProcessedJumpSeq`.
- **Estado autoritativo:** cada `race.snapshot` completo reemplaza el anterior; ticks atrasados o de otra carrera se ignoran; los eventos se deduplican por `eventId` y solo informan. Un `race.ended` repetido solo actualiza `settlementState`.

## Pruebas

```sh
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Las pruebas unitarias usan servidores HTTP/WebSocket locales para comprobar el comportamiento del cliente (mismo `requestId` en reintentos, rechazos sin reintento, subprotocolo, cabecera de sesión, reentrada y resincronización de secuencias, piloto automático). No sustituyen la integración real: [`scripts/validation/g58-python-client.py`](../../scripts/validation/g58-python-client.py) levanta un proyecto Compose aislado (PostgreSQL, migraciones, dos Rust, Envoy y Go) y hace que dos clientes Python jueguen una carrera completa contra Go, verifican resultado, propiedad única de recogidas, settlement confirmado, perfil acreditado una sola vez y el replay del CLI con el mismo `requestId`. CI Client Secondary ejecuta las pruebas unitarias en Ubuntu y Windows; CI Integration ejecuta el harness real.
