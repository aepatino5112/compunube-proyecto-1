# Go Match Service base (F46)

`cmd/server/main.go` carga configuración, prepara logging y señales y ejecuta `internal/server`. El servidor registra `/healthz`, `/readyz`, la métrica mínima `/metrics` y las dos rutas de sesión E45. Un `RouteRegistrar` permite montar posteriormente las demás rutas HTTP E45 y WebSocket E43 sin registrar rutas de negocio ficticias ahora.

| Variable | Default/base local | Uso actual |
| --- | --- | --- |
| `HTTP_ADDR` | `0.0.0.0:8080` | Listener HTTP |
| `PLAYER_PROFILE_GRPC_ADDR` | `envoy:50051` | Destino lógico validado; J77 añadirá el adaptador |
| `DATABASE_URL` | vacío | PostgreSQL `match` validado si se configura; F55 añadirá repositorios |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN` o `ERROR` |
| `SHUTDOWN_TIMEOUT` | `10s` | Límite de drenaje HTTP |

Compose suministra las direcciones y `DATABASE_URL` por entorno. Estos defaults son baselines locales configurables, no requisitos del laboratorio. No se registra la URL de base de datos ni una credencial de sesión. El servicio aún no abre conexiones a Envoy ni PostgreSQL.

## Identidad MVP (F48)

`POST /v1/sessions` no acepta cuerpo ni parámetros; Go genera un `playerId` y token opacos con `crypto/rand`, devuelve ambos con 201 y establece `compunube_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/v1`). `GET /v1/sessions/current` confirma la identidad mediante Bearer o cookie. Si llegan ambas credenciales, **ambas deben ser válidas y corresponder a la misma identidad**. Las inválidas reciben `401 SESSION_REQUIRED` sin eco de la credencial. Las respuestas de sesión llevan `Cache-Control: no-store`.

Las sesiones y `ActivePlayer` viven solo en memoria de este proceso: **reiniciar Go invalida las credenciales**, y no existe expiración temporal ni recuperación entre procesos. No hay cuenta, contraseña, JWT, tabla nueva de DB ni llamada a Rust. El registro conserva hashes de tokens, identifica una conexión por ID generado por Go y permite rebind sin que un cierre tardío desconecte la nueva conexión. `RoomID` es solo una asociación opcional; F49 decidirá membresía y reglas.

`sessionhttp.Require` pone el `playerId` confirmado en el contexto para futuros handlers. En operaciones mutantes autenticadas solo por cookie exige `Origin` idéntico al origen directo; `AuthenticateUpgrade` aplica esa comprobación también al futuro handshake WebSocket. No se confía en cabeceras forwarded del cliente. Si se añade terminación TLS externa, el proxy deberá preservar esta propiedad de origen. El flag `Secure` se mantiene incluso en desarrollo: el navegador necesita HTTPS o una excepción local para enviar la cookie; clientes de desarrollo pueden usar Bearer.

`/readyz` inicia en 503, pasa a 200 tras abrir el listener y vuelve a 503 antes de drenar en SIGINT/SIGTERM. `/healthz` sólo refleja el proceso local; una caída de Rust no cambia la readiness de Go. Las comprobaciones de capacidad de perfil y persistencia corresponden a tareas posteriores según E40.

Validación local desde este directorio:

```sh
gofmt -l .
go vet ./...
go test ./...
go test -race ./...
```
