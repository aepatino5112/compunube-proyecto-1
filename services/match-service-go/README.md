# Go Match Service base (F46)

`cmd/server/main.go` carga configuración, prepara logging y señales y ejecuta `internal/server`. El servidor registra `/healthz`, `/readyz` y la métrica mínima `/metrics`. Un `RouteRegistrar` permite montar posteriormente HTTP E45 y WebSocket E43 sin registrar rutas de negocio ficticias ahora.

| Variable | Default/base local | Uso actual |
| --- | --- | --- |
| `HTTP_ADDR` | `0.0.0.0:8080` | Listener HTTP |
| `PLAYER_PROFILE_GRPC_ADDR` | `envoy:50051` | Destino lógico validado; J77 añadirá el adaptador |
| `DATABASE_URL` | vacío | PostgreSQL `match` validado si se configura; F55 añadirá repositorios |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN` o `ERROR` |
| `SHUTDOWN_TIMEOUT` | `10s` | Límite de drenaje HTTP |

Compose suministra las direcciones y `DATABASE_URL` por entorno. Estos defaults son baselines locales configurables, no requisitos del laboratorio. No se registra la URL de base de datos ni una credencial de sesión. El servicio aún no abre conexiones a Envoy ni PostgreSQL.

`/readyz` inicia en 503, pasa a 200 tras abrir el listener y vuelve a 503 antes de drenar en SIGINT/SIGTERM. `/healthz` sólo refleja el proceso local; una caída de Rust no cambia la readiness de Go. Las comprobaciones de capacidad de perfil y persistencia corresponden a tareas posteriores según E40.

Validación local desde este directorio:

```sh
gofmt -l .
go vet ./...
go test ./...
go test -race ./...
```
