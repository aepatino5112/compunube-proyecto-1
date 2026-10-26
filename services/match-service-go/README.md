# Go Match Service

## Correlación de logs (H67-Final)

La frontera HTTP acepta `X-Request-ID` si tiene entre 1 y 64 caracteres ASCII `A-Z`, `a-z`, `0-9`, `_` o `-`. Si falta, está repetido o es inválido, Go genera un ID opaco aleatorio de 128 bits. La respuesta devuelve el ID efectivo en `X-Request-ID` sin cambiar el body de E45. Los logs JSON `http request started` y `http request completed` incluyen `correlation_id`, método, y al terminar status y latencia; no registran URL, query, headers, payload, token ni IDs de negocio. El handshake WebSocket usa el mismo ID de la petición, sin crear uno por tick.

El adaptador gRPC envía `x-correlation-id` como metadata en los ocho RPC Player/Profile, usando el ID del contexto HTTP; un trabajo autónomo, como settlement, recibe un ID nuevo por RPC. Rust registra el mismo valor validado en `rpc completed`. Este ID solo enlaza logs: no reemplaza `requestId` de idempotencia ni se usa como label Prometheus. Metadata evita cambios en protobuf.

## Métricas operativas (J86)

`GET /metrics` expone texto Prometheus en el listener HTTP de Go. Conserva `match_service_up`. H68 puede configurar un target con `metrics_path: /metrics` y la dirección interna de Go en Compose. El scrape lee solo memoria local: no llama a PostgreSQL ni a Rust, no envía comandos al RoomLoop y no altera el Circuit Breaker. Los contadores se reinician al reiniciar el proceso.

| Familia | Tipo | Labels fijos | Significado |
| --- | --- | --- | --- |
| `compunube_match_rooms_active`, `compunube_match_connections_active` | gauge | ninguno | Salas y WebSockets activos |
| `compunube_match_admission_total` | counter | `kind=room,connection` | Admisiones |
| `compunube_match_admission_rejected_total` | counter | `kind=room,connection`, `reason=limit` | Rechazos por capacidad |
| `compunube_match_inputs_dropped_total` | counter | `reason=rate_limited,mailbox_full,jump_full,sequence` | Entradas descartadas |
| `compunube_match_inputs_coalesced_total` | counter | ninguno | Entradas continuas reemplazadas antes de un tick |
| `compunube_match_room_queue_depth`, `compunube_match_record_queue_depth` | gauge | ninguno | Comandos de salas y registros pendientes |
| `compunube_match_room_queue_rejected_total` | counter | ninguno | Cola de comandos llena |
| `compunube_match_workpool_in_flight`, `compunube_match_workpool_queue_depth` | gauge | `pool=profile,settlement` | Trabajos activos y en cola |
| `compunube_match_workpool_rejected_total` | counter | `pool=profile,settlement` | Saturación de pool |
| `compunube_player_profile_circuit_state` | gauge | `state=closed,open,half_open` | Estado one-hot del circuito |
| `compunube_player_profile_fast_rejects_total`, `compunube_player_profile_read_retries_total` | counter | ninguno | Rechazos rápidos y retries de lecturas |
| `compunube_settlement_attempts_total` | counter | `outcome=confirmed,retry,failed,canceled,pending` | Resultado de cada fila reclamada; `pending` indica que no se pudo confirmar el resultado durable |

Ninguna serie usa IDs, tokens, mensajes de error o URLs como label. Las métricas de cola son fotografías y pueden variar entre scrapes.

`cmd/server/main.go` carga configuración, prepara logging y señales y ejecuta `internal/server`. El servidor registra `/healthz`, `/readyz`, `/metrics`, las rutas de sesión, crear/entrar sala de E45 y `/v1/realtime` de E43.

| Variable | Default/base local | Uso actual |
| --- | --- | --- |
| `HTTP_ADDR` | `0.0.0.0:8080` | Listener HTTP |
| `PLAYER_PROFILE_GRPC_ADDR` | `envoy:50051` | Destino lógico validado; J77 añadirá el adaptador |
| `DATABASE_URL` | vacío | PostgreSQL `match` validado si se configura; F55 añadirá repositorios |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN` o `ERROR` |
| `SHUTDOWN_TIMEOUT` | `10s` | Límite de drenaje HTTP |
| `ROOM_COMMAND_QUEUE_CAPACITY` | `32` | Capacidad acotada de comandos por loop; baseline interno E39 configurable |
| `MAX_ACTIVE_ROOMS` / `MAX_CONNECTIONS` | `5` / `20` | Rechazo de admisión global, sin desalojar admitidos |
| `ROOM_MAX_COMMANDS_PER_TICK` | `16` | Presupuesto de control entre ticks |
| `PUBLIC_ORIGINS` | vacío | Orígenes `https://host[:puerto]` de un proxy TLS (cliente web en el laboratorio) aceptados en `Origin` además del directo; [guía HTTPS](../../docs/deployment/https-lab.md) |
| `ROOM_INPUT_SLOTS` / `ROOM_JUMP_EDGES_PER_PLAYER` | `4` / `4` | Mailbox acotada de carrera |
| `CONNECTION_INPUT_RATE` / `CONNECTION_INPUT_BURST` | `20` / `4` | Token bucket por WebSocket, antes del loop |
| `CONNECTION_SNAPSHOT_SLOTS` | `1` | Invariante latest-only; valores distintos se rechazan |
| `CONNECTION_CRITICAL_QUEUE` / `CONNECTION_EVENT_QUEUE` | `16` / `16` | Salida acotada; crítico lleno cierra solo ese socket |
| `PROFILE_CONCURRENCY` / `PROFILE_QUEUE_CAPACITY` | `8` / `32` | Pool local separado para trabajos futuros de perfil |
| `SETTLEMENT_CONCURRENCY` / `SETTLEMENT_QUEUE_CAPACITY` | `4` / `64` | Pool local separado para entrega futura |
| `PROFILE_JOB_TIMEOUT` / `SETTLEMENT_JOB_TIMEOUT` | `750ms` / `2s` | Deadline total de cada job desde la admisión |

Compose suministra las direcciones y `DATABASE_URL` por entorno. Estos defaults son baselines locales configurables, no requisitos del laboratorio. No se registra la URL de base de datos ni una credencial de sesión. El servicio aún no abre conexiones a Envoy ni PostgreSQL.

## Identidad MVP (F48)

`POST /v1/sessions` no acepta cuerpo ni parámetros; Go genera un `playerId` y token opacos con `crypto/rand`, devuelve ambos con 201 y establece `compunube_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/v1`). `GET /v1/sessions/current` confirma la identidad mediante Bearer o cookie. Si llegan ambas credenciales, **ambas deben ser válidas y corresponder a la misma identidad**. Las inválidas reciben `401 SESSION_REQUIRED` sin eco de la credencial. Las respuestas de sesión llevan `Cache-Control: no-store`.

Con `DATABASE_URL`, cada sesión se guarda en `match.sessions` como **hash SHA-256 del token** y `playerId` ([ADR 0005](../../docs/adr/0005-persistent-go-sessions.md)): tras reiniciar Go, un token desconocido para el proceso se resuelve una vez desde PostgreSQL y el jugador conserva su identidad. Si la base no responde al crear, la sesión vale solo en este proceso (log `session_persist_failed`); al buscar, falla cerrada como `401` (log `session_restore_failed`). Sin `DATABASE_URL` las sesiones viven solo en memoria. No hay expiración temporal, cuenta, contraseña, JWT ni llamada a Rust; `ActivePlayer` (conexión y sala) sigue en memoria. El registro conserva hashes de tokens, identifica una conexión por ID generado por Go y permite rebind sin que un cierre tardío desconecte la nueva conexión. `RoomID` es una asociación opcional; `internal/rooms` decide membresía y reglas.

`sessionhttp.Require` pone el `playerId` confirmado en el contexto para handlers. En operaciones mutantes autenticadas solo por cookie exige `Origin` idéntico al origen directo; `AuthenticateUpgrade` aplica esa comprobación también al handshake WebSocket. No se confía en cabeceras forwarded del cliente. Con terminación TLS en un proxy (el `server.mjs` del cliente web en el laboratorio), Go ve la petición sin TLS; `PUBLIC_ORIGINS` (lista de orígenes `https://host[:puerto]` exactos) declara qué origen público se acepta además del directo ([guía](../../docs/deployment/https-lab.md)). El flag `Secure` se mantiene incluso en desarrollo: el navegador necesita HTTPS o una excepción local para enviar la cookie; clientes de desarrollo pueden usar Bearer.

## Runtime por sala (F50)

`internal/roomruntime` registra handles con un mutex breve y ejecuta **una goroutine por sala**. El handler de cada sala recibe comandos y ticks en serie; es el único escritor de su estado. `Submit` devuelve resultado por un canal de respuesta acotado, rechaza una cola llena con `ErrQueueFull` y no acepta trabajo tras cierre. `ConnectionChange` es un comando interno de conexión/desconexión; no decide membresía ni la ventana de reentrada de B17.

El tick de producción es **50 ms / 20 Hz**, fijado por D28. El reloj es inyectable para pruebas. Si Go retrasa un ticker, el loop procesa un paso lógico de 50 ms por señal entregada: no lanza una ráfaga ilimitada de pasos de recuperación. Los handlers deben terminar pronto y no realizar red, SQL ni RPC en el loop. F49 añade estados/reglas de sala y F53 simulación y publicación de carrera.

## Salas y realtime inicial (F49)

`POST /v1/rooms` acepta solo `mapId` (`maracaibo` u `orinoco`) y `POST /v1/rooms/{roomId}/memberships` entra en un LOBBY con plaza; ambos derivan `playerId` de F48. Una sala admite cuatro humanos, arranca cuenta atrás de tres segundos con 2–4 miembros preparados y ready, congela el roster al entrar en RACING y mantiene el mapa para carreras repetidas. El loop serial es el único escritor. Desconexión durante RACING deja una ventana de reentrada de 15 segundos para la misma identidad. El cierre competitivo ocurre por las reglas F53; `Repeat` interno devuelve los miembros restantes a LOBBY como not_ready.

`/v1/realtime` autentica el upgrade y exige `compunube.realtime.v1`. Procesa `room.ready`, `room.leave` y `race.input`; publica `room.state`, `race.start`, `race.snapshot`, `race.event` y `race.ended`. J77 añade el port Player/Profile y un verificador que consulta `GetProfile` a través del pool F51; solo confirma `ready: true` si coinciden identidad, revisión, equipo poseído y apariencia no vacía. El proto v1 no tiene `displayName`, así que la sala muestra temporalmente el `playerId` opaco. La conexión de producción apunta a `PLAYER_PROFILE_GRPC_ADDR` (Envoy); sin servidor Rust disponible, responde `PROFILE_UNAVAILABLE` y no habilita partidas. Las pruebas usan fake y gRPC local, no validan Rust real.

## Control de carga (F51)

`roomruntime` limita salas activas y procesa como máximo el presupuesto configurado de comandos antes de reservar turno al tick. `roomshttp` limita conexiones autenticadas y libera el cupo al cerrarlas. La salida WebSocket usa `outbox`: críticos FIFO, un snapshot pendiente reemplazable y eventos transitorios acotados. Si se llena la cola crítica se cierra solo esa conexión. `race.input` pasa por un token bucket antes de entrar al loop y por validación de carrera/secuencia antes de la mailbox.

`inputmailbox` conserva la intención continua más reciente y hasta cuatro pulsaciones de salto por jugador, con contadores de coalescing/rechazo; F53 la conecta a cada carrera. Los pools `workpool` de profile y settlement son independientes, tienen workers/colas/deadlines acotados y ejecutan las llamadas al port Player/Profile fuera del RoomLoop. La saturación local devuelve `ErrSaturated`, distinto de un fallo remoto. Contadores internos de admisión, colas y descartes son hooks testeables; H67 añadirá exposición operacional.

## Simulación autoritativa (F53)

`internal/race` carga manifiestos fijos y versionados de Maracaibo y Orinoco derivados de `apps/web/dist/maps.js`: 54 obstáculos, 103 residuos y 10 salvavidas por mapa, con IDs estables. El RoomLoop asigna slots X por `playerId`, procesa inputs en secuencia, ejecuta a 20 Hz movimiento, salto, boost, daño, recogidas adjudicadas por distancia/ID, pulpo, meta y timers B16/B17. Emite snapshots completos a 10 Hz, eventos transitorios y un `RaceResult` competitivo inmutable con `settlementState=pending`. Reentrada en RACING envía `room.state` y snapshot completo; RESULTS reenvía `race.ended`.

El resultado Go no cambia saldo ni confirma perfil. F55 persiste `match.rooms`, `match.races`, `match.race_participants` y `match.settlement_delivery` en PostgreSQL mediante `internal/matchstore`. Un recorder asíncrono recibe inicio/cierre de sala, inicio de carrera y resultado final; el RoomLoop solo entrega una copia en memoria, sin SQL dentro del tick. El resultado y sus deliveries se escriben en una transacción y los reintentos comprueban que los campos competitivos existentes sean idénticos. `Due` permite recuperar entregas `pending` vencidas tras reinicio; `Failed` las expone para diagnóstico, sin reintento automático. No se guardan inputs ni snapshots. Una caída de DB deja registros pendientes solo en la memoria del proceso hasta poder reintentarlos; no se afirma durabilidad antes del commit y una caída de Go durante esa ventana puede perderlos. G59/G60/G61 conectarán la experiencia de clientes. `Repeat` es un comando interno; E43 no define una intención pública de repetir desde RESULTS, por lo que la sala conserva ese estado hasta que una capa de coordinación invoque la transición. No se añadió un mensaje público fuera de E43.

## Port Player/Profile (J77, lado Go)

`internal/playerprofile.Port` expone tipos Go para los ocho RPC E43. `Adapter` usa gRPC hacia el destino lógico Envoy y se cierra al apagar el servidor. Conserva el contexto/deadline recibido del pool; no reintenta mutaciones ni settlement. `Fault.Kind` clasifica rechazo de negocio, indisponibilidad, saturación, deadline, cancelación, fallo sistémico y configuración fatal sin propagar mensajes remotos o secretos. `Fake` permite probar rooms, HTTP futuro y settlement sin red. El port sirve como seam para la política E38/J78; aún no hay Circuit Breaker ni validación contra Rust real.

## Coordinación durable de settlement (F54, lado Go)

`internal/settlement` despierta al confirmarse un RaceResult en match DB y también consulta periódicamente las filas `pending` vencidas para recuperarse tras reinicios. Cada worker toma una fila con `FOR UPDATE SKIP LOCKED`, incrementa `attempt_count` y deja un lease en `next_attempt_at`; el fallo o muerte del worker permite reclamarla después. El RPC `SettleRace` usa exactamente `raceId`, `playerId`, `outcome` y `credited` del resultado persistido, con la misma clave en cada intento y el deadline del `settlementPool`. Éxito o replay remoto confirma la fila en DB. Indisponibilidad, saturación y deadline conservan `pending` con backoff exponencial y jitter acotado; rechazo determinista o error fatal pasa a `failed` para diagnóstico. No se reintenta de inmediato una operación dentro del mismo RPC. Solo cuando todas las filas de la carrera están `confirmed`, el RoomLoop cambia `settlementState` a `confirmed` y reenvía `race.ended`; los campos competitivos no cambian. Si la cola de comandos está llena, la publicación se vuelve a intentar mientras la sala viva. Estas rutas están probadas con fake y PostgreSQL migrado; F52/Rust real e idempotencia remota extremo a extremo siguen pendientes.

Los stubs locales bajo `internal/playerprofile/pb` se generan desde el proto congelado, sin edición manual. Con `protoc`, `protoc-gen-go@v1.36.10` y `protoc-gen-go-grpc@v1.5.1` en `PATH`, ejecutar desde la raíz del repositorio:

```sh
sh services/match-service-go/internal/playerprofile/pb/generate.sh
```

El `context.Context` raíz cancela los loops. Un handler que determine el cierre puede solicitar `Handle.Cancel()` sin esperarse a sí mismo; el caller externo usa `Handle.Stop()` para esperar. `main` espera `Manager.Close()` antes de salir tanto en apagado normal como en error de HTTP; no queda un loop activo tras el cierre. Los tamaños de cola (`32` por defecto) son baselines internos E39 sujetos a medición, no requisitos del profesor.

`/readyz` inicia en 503, pasa a 200 tras abrir el listener y vuelve a 503 antes de drenar en SIGINT/SIGTERM. `/healthz` sólo refleja el proceso local; una caída de Rust no cambia la readiness de Go. Las comprobaciones de capacidad de perfil y persistencia corresponden a tareas posteriores según E40.

Validación local desde este directorio:

```sh
gofmt -l .
go vet ./...
go test ./...
go test -race ./...
```

## Resiliencia Player/Profile (J79)

El adaptador gRPC apunta a `PLAYER_PROFILE_GRPC_ADDR` y se envuelve en un único circuito lógico compartido por preparación de perfil y settlement. Las lecturas `GetProfile`/`GetCatalog` admiten un retry adicional con el mismo context y jitter; las mutaciones y `SettleRace` no se reintentan automáticamente. `open` rechaza sin RPC y `half-open` admite una sola sonda de lectura. `ResilientPort.Stats()` expone estado, fallos consecutivos, reapertura y contadores internos de rechazos rápidos y retries.

| Variable | Default | Significado |
| --- | --- | --- |
| `PLAYER_PROFILE_CB_FAILURE_THRESHOLD` | `5` | Fallos lógicos consecutivos antes de abrir |
| `PLAYER_PROFILE_CB_OPEN_DURATION` | `10s` | Ventana abierta |
| `PLAYER_PROFILE_CB_HALF_OPEN_PROBES` | `1` | Una sonda de lectura simultánea; único valor admitido |
| `PLAYER_PROFILE_READ_MAX_RETRIES` | `1` | Reintentos de lectura; `0` o `1` |
| `PLAYER_PROFILE_RETRY_BASE` | `50ms` | Base del jitter |
| `PLAYER_PROFILE_RETRY_CAP` | `200ms` | Tope del jitter |

## API pública de perfil y economía (J80)

Go expone las rutas E45 `GET /v1/profile`, `GET /v1/catalog` y `POST /v1/profile/{purchases,crafts,exchanges,equipment}` y `PUT /v1/profile/appearance`. Todas requieren una sesión F48; `playerId` se obtiene solo del contexto de sesión. Las mutaciones por cookie exigen Origin del mismo origen. Los handlers usan `profilePool` y el port resiliente J79; nunca consultan gRPC desde el RoomLoop ni escriben `player.*`. JSON desconocido o malformado se rechaza con `INVALID_REQUEST`; fallos de dependencia dan `PROFILE_UNAVAILABLE`, y un timeout de mutación iniciada da `MUTATION_OUTCOME_UNKNOWN` con el `requestId` original para repetir la misma intención. Las pruebas de este paquete usan un port fake; la integración real queda pendiente de F47/F52.

## Recuperación autónoma de settlement (J81)

Cuando una entrega durable falla transitoriamente, el coordinador consulta el estado del circuito J79 mediante un `RecoveryProber` inyectado. En `closed` no añade RPC; en `open` rechaza sin tráfico; en `half-open` consulta `GetProfile(playerId)` con `profilePool` y su deadline, fuera del RoomLoop. `SettleRace` permanece en `settlementPool` y nunca sirve como sonda. El resultado de la lectura solo puede cerrar o reabrir el circuito: la entrega continúa `pending` con su backoff y `next_attempt_at`, y únicamente un intento posterior de `SettleRace` puede confirmarla. Así la recuperación no depende de tráfico de usuario.
