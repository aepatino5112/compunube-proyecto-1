# Go Match Service base (F46)

`cmd/server/main.go` carga configuración, prepara logging y señales y ejecuta `internal/server`. El servidor registra `/healthz`, `/readyz`, `/metrics`, las rutas de sesión, crear/entrar sala de E45 y `/v1/realtime` de E43.

| Variable | Default/base local | Uso actual |
| --- | --- | --- |
| `HTTP_ADDR` | `0.0.0.0:8080` | Listener HTTP |
| `PLAYER_PROFILE_GRPC_ADDR` | `envoy:50051` | Destino lógico validado; J77 añadirá el adaptador |
| `DATABASE_URL` | vacío | PostgreSQL `match` validado si se configura; F55 añadirá repositorios |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN` o `ERROR` |
| `SHUTDOWN_TIMEOUT` | `10s` | Límite de drenaje HTTP |
| `ROOM_COMMAND_QUEUE_CAPACITY` | `32` | Capacidad acotada de comandos por loop; baseline interno E39 configurable |

Compose suministra las direcciones y `DATABASE_URL` por entorno. Estos defaults son baselines locales configurables, no requisitos del laboratorio. No se registra la URL de base de datos ni una credencial de sesión. El servicio aún no abre conexiones a Envoy ni PostgreSQL.

## Identidad MVP (F48)

`POST /v1/sessions` no acepta cuerpo ni parámetros; Go genera un `playerId` y token opacos con `crypto/rand`, devuelve ambos con 201 y establece `compunube_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/v1`). `GET /v1/sessions/current` confirma la identidad mediante Bearer o cookie. Si llegan ambas credenciales, **ambas deben ser válidas y corresponder a la misma identidad**. Las inválidas reciben `401 SESSION_REQUIRED` sin eco de la credencial. Las respuestas de sesión llevan `Cache-Control: no-store`.

Las sesiones y `ActivePlayer` viven solo en memoria de este proceso: **reiniciar Go invalida las credenciales**, y no existe expiración temporal ni recuperación entre procesos. No hay cuenta, contraseña, JWT, tabla nueva de DB ni llamada a Rust. El registro conserva hashes de tokens, identifica una conexión por ID generado por Go y permite rebind sin que un cierre tardío desconecte la nueva conexión. `RoomID` es una asociación opcional; `internal/rooms` decide membresía y reglas.

`sessionhttp.Require` pone el `playerId` confirmado en el contexto para handlers. En operaciones mutantes autenticadas solo por cookie exige `Origin` idéntico al origen directo; `AuthenticateUpgrade` aplica esa comprobación también al handshake WebSocket. No se confía en cabeceras forwarded del cliente. Si se añade terminación TLS externa, el proxy deberá preservar esta propiedad de origen. El flag `Secure` se mantiene incluso en desarrollo: el navegador necesita HTTPS o una excepción local para enviar la cookie; clientes de desarrollo pueden usar Bearer.

## Runtime por sala (F50)

`internal/roomruntime` registra handles con un mutex breve y ejecuta **una goroutine por sala**. El handler de cada sala recibe comandos y ticks en serie; es el único escritor de su estado. `Submit` devuelve resultado por un canal de respuesta acotado, rechaza una cola llena con `ErrQueueFull` y no acepta trabajo tras cierre. `ConnectionChange` es un comando interno de conexión/desconexión; no decide membresía ni la ventana de reentrada de B17.

El tick de producción es **50 ms / 20 Hz**, fijado por D28. El reloj es inyectable para pruebas. Si Go retrasa un ticker, el loop procesa un paso lógico de 50 ms por señal entregada: no lanza una ráfaga ilimitada de pasos de recuperación. Los handlers deben terminar pronto y no realizar red, SQL ni RPC en el loop. F49 añade estados/reglas de sala; F53 añadirá simulación; F51, límites y políticas de backpressure completas.

## Salas y realtime inicial (F49)

`POST /v1/rooms` acepta solo `mapId` (`maracaibo` u `orinoco`) y `POST /v1/rooms/{roomId}/memberships` entra en un LOBBY con plaza; ambos derivan `playerId` de F48. Una sala admite cuatro humanos, arranca cuenta atrás de tres segundos con 2–4 miembros preparados y ready, congela el roster al entrar en RACING y mantiene el mapa para carreras repetidas. El loop serial es el único escritor. Desconexión durante RACING deja una ventana de reentrada de 15 segundos para la misma identidad. `Finish` y `Repeat` son comandos internos para que F53 cierre una carrera y vuelva a LOBBY con miembros not_ready; no crean un resultado ficticio.

`/v1/realtime` autentica el upgrade y exige `compunube.realtime.v1`. En F49 procesa `room.ready` y `room.leave` y publica `room.state`; `race.input`, manifiestos, snapshots y resultados son alcance F53. El perfil no está conectado a Rust: `UnavailableVerifier` rechaza `ready: true` en producción. Las pruebas inyectan un verificador local para demostrar el lifecycle, sin afirmar que Go haya consultado Rust. J77/F52 deberán proporcionar preparación verificada para habilitar partidas de producción.

El `context.Context` raíz cancela los loops. Un handler que determine el cierre puede solicitar `Handle.Cancel()` sin esperarse a sí mismo; el caller externo usa `Handle.Stop()` para esperar. `main` espera `Manager.Close()` antes de salir tanto en apagado normal como en error de HTTP; no queda un loop activo tras el cierre. Los tamaños de cola (`32` por defecto) son baselines internos E39 sujetos a medición, no requisitos del profesor.

`/readyz` inicia en 503, pasa a 200 tras abrir el listener y vuelve a 503 antes de drenar en SIGINT/SIGTERM. `/healthz` sólo refleja el proceso local; una caída de Rust no cambia la readiness de Go. Las comprobaciones de capacidad de perfil y persistencia corresponden a tareas posteriores según E40.

Validación local desde este directorio:

```sh
gofmt -l .
go vet ./...
go test ./...
go test -race ./...
```
