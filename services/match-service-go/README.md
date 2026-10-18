# Go Match Service

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

Las sesiones y `ActivePlayer` viven solo en memoria de este proceso: **reiniciar Go invalida las credenciales**, y no existe expiración temporal ni recuperación entre procesos. No hay cuenta, contraseña, JWT, tabla nueva de DB ni llamada a Rust. El registro conserva hashes de tokens, identifica una conexión por ID generado por Go y permite rebind sin que un cierre tardío desconecte la nueva conexión. `RoomID` es una asociación opcional; `internal/rooms` decide membresía y reglas.

`sessionhttp.Require` pone el `playerId` confirmado en el contexto para handlers. En operaciones mutantes autenticadas solo por cookie exige `Origin` idéntico al origen directo; `AuthenticateUpgrade` aplica esa comprobación también al handshake WebSocket. No se confía en cabeceras forwarded del cliente. Si se añade terminación TLS externa, el proxy deberá preservar esta propiedad de origen. El flag `Secure` se mantiene incluso en desarrollo: el navegador necesita HTTPS o una excepción local para enviar la cookie; clientes de desarrollo pueden usar Bearer.

## Runtime por sala (F50)

`internal/roomruntime` registra handles con un mutex breve y ejecuta **una goroutine por sala**. El handler de cada sala recibe comandos y ticks en serie; es el único escritor de su estado. `Submit` devuelve resultado por un canal de respuesta acotado, rechaza una cola llena con `ErrQueueFull` y no acepta trabajo tras cierre. `ConnectionChange` es un comando interno de conexión/desconexión; no decide membresía ni la ventana de reentrada de B17.

El tick de producción es **50 ms / 20 Hz**, fijado por D28. El reloj es inyectable para pruebas. Si Go retrasa un ticker, el loop procesa un paso lógico de 50 ms por señal entregada: no lanza una ráfaga ilimitada de pasos de recuperación. Los handlers deben terminar pronto y no realizar red, SQL ni RPC en el loop. F49 añade estados/reglas de sala y F53 simulación y publicación de carrera.

## Salas y realtime inicial (F49)

`POST /v1/rooms` acepta solo `mapId` (`maracaibo` u `orinoco`) y `POST /v1/rooms/{roomId}/memberships` entra en un LOBBY con plaza; ambos derivan `playerId` de F48. Una sala admite cuatro humanos, arranca cuenta atrás de tres segundos con 2–4 miembros preparados y ready, congela el roster al entrar en RACING y mantiene el mapa para carreras repetidas. El loop serial es el único escritor. Desconexión durante RACING deja una ventana de reentrada de 15 segundos para la misma identidad. El cierre competitivo ocurre por las reglas F53; `Repeat` interno devuelve los miembros restantes a LOBBY como not_ready.

`/v1/realtime` autentica el upgrade y exige `compunube.realtime.v1`. Procesa `room.ready`, `room.leave` y `race.input`; publica `room.state`, `race.start`, `race.snapshot`, `race.event` y `race.ended`. El perfil no está conectado a Rust: `UnavailableVerifier` rechaza `ready: true` en producción. Las pruebas inyectan un verificador local para demostrar el lifecycle y la carrera, sin afirmar que Go haya consultado Rust. J77/F52 deberán proporcionar preparación verificada para habilitar partidas de producción.

## Control de carga (F51)

`roomruntime` limita salas activas y procesa como máximo el presupuesto configurado de comandos antes de reservar turno al tick. `roomshttp` limita conexiones autenticadas y libera el cupo al cerrarlas. La salida WebSocket usa `outbox`: críticos FIFO, un snapshot pendiente reemplazable y eventos transitorios acotados. Si se llena la cola crítica se cierra solo esa conexión. `race.input` pasa por un token bucket antes de entrar al loop y por validación de carrera/secuencia antes de la mailbox.

`inputmailbox` conserva la intención continua más reciente y hasta cuatro pulsaciones de salto por jugador, con contadores de coalescing/rechazo; F53 la conecta a cada carrera. Los pools `workpool` de profile y settlement son independientes, tienen workers/colas/deadlines acotados y no ejecutan RPC todavía. La saturación local devuelve `ErrSaturated`, distinto de un fallo remoto. Contadores internos de admisión, colas y descartes son hooks testeables; H67 añadirá exposición operacional.

## Simulación autoritativa (F53)

`internal/race` carga manifiestos fijos y versionados de Maracaibo y Orinoco derivados de `apps/web/dist/maps.js`: 54 obstáculos, 103 residuos y 10 salvavidas por mapa, con IDs estables. El RoomLoop asigna slots X por `playerId`, procesa inputs en secuencia, ejecuta a 20 Hz movimiento, salto, boost, daño, recogidas adjudicadas por distancia/ID, pulpo, meta y timers B16/B17. Emite snapshots completos a 10 Hz, eventos transitorios y un `RaceResult` competitivo inmutable con `settlementState=pending`. Reentrada en RACING envía `room.state` y snapshot completo; RESULTS reenvía `race.ended`.

El resultado Go no cambia saldo ni confirma perfil. F54/J77/F55 implementarán settlement y persistencia; G59/G60/G61 conectarán la experiencia de clientes. `Repeat` es un comando interno; E43 no define una intención pública de repetir desde RESULTS, por lo que la sala conserva ese estado hasta que una capa de coordinación invoque la transición. No se añadió un mensaje público fuera de E43.

El `context.Context` raíz cancela los loops. Un handler que determine el cierre puede solicitar `Handle.Cancel()` sin esperarse a sí mismo; el caller externo usa `Handle.Stop()` para esperar. `main` espera `Manager.Close()` antes de salir tanto en apagado normal como en error de HTTP; no queda un loop activo tras el cierre. Los tamaños de cola (`32` por defecto) son baselines internos E39 sujetos a medición, no requisitos del profesor.

`/readyz` inicia en 503, pasa a 200 tras abrir el listener y vuelve a 503 antes de drenar en SIGINT/SIGTERM. `/healthz` sólo refleja el proceso local; una caída de Rust no cambia la readiness de Go. Las comprobaciones de capacidad de perfil y persistencia corresponden a tareas posteriores según E40.

Validación local desde este directorio:

```sh
gofmt -l .
go vet ./...
go test ./...
go test -race ./...
```
