# A07 — Auditoría del entorno de desarrollo

**Fecha:** 2026-10-17 · **Responsable:** Ángel Patiño · **Estado:** completada para el entorno de desarrollo reproducible.

Esta auditoría valida el entorno de desarrollo e integración del proyecto mediante CI, Docker Compose y smoke tests reproducibles. **A05 queda desacoplada de A07**: la auditoría de las PC Windows 10, LAN, firewall, IPs y despliegue físico pertenece al entorno de laboratorio y se ejecutará cuando exista acceso, sin bloquear el desarrollo normal. A06 está cerrada.

## Entorno observado y evidencia

- **Estación de esta auditoría:** Debian 13 en WSL2, kernel `6.18.33.1-microsoft-standard-WSL2`, x86_64. Esto no acredita ninguna de las seis PC Windows 10 del laboratorio.
- **Código:** Go declara `go 1.24` en `go.mod`; el Dockerfile usa `golang:1.24-alpine`. Rust declara `Cargo.lock` y el Dockerfile/CI usan Rust `1.99`. `Cargo.lock` está versionado. El binario Rust actual solo sirve gRPC Health; todavía no implementa Player/Profile funcional. Go actual solo expone endpoints HTTP base y aún no usa PostgreSQL ni el cliente gRPC.
- **Herramientas locales:** `go`, `gofmt`, `cargo`, `rustc` y `protoc` no están instalados en este WSL. No se atribuyen a esta máquina resultados de `vet`, race, Clippy o compilación de proto.
- **Docker:** `docker compose config` pasa. Docker Desktop responde fuera del sandbox de esta sesión. El primer `up --build --wait` falló al publicar Go en 8080 porque otro contenedor local (`audit-api`) ya lo ocupaba. Con `GO_HTTP_PORT=18080`, el segundo arranque pasó: PostgreSQL, Go, Rust #1/#2, Envoy, Prometheus, exporter y Grafana quedaron en marcha; los servicios con healthcheck marcaron `healthy`.
- **Comprobaciones locales tras el segundo arranque:** schemas `match` y `player` presentes; Go `/healthz`, `/readyz`, `/metrics`, Envoy `/ready` y Prometheus `/-/ready` respondieron; Grafana `/api/health` respondió después de un retry durante sus migraciones iniciales. Envoy mostró dos upstreams con `health_flags::healthy` por gRPC Health. Los dos contenedores Rust estaban saludables, pero usaban IDs de imagen distintos. Tras declarar una etiqueta compartida en Compose y repetir `up --build --wait`, ambos quedaron `healthy` con el mismo ID de imagen `sha256:1c8beb6b56d90da4dc1c74a64d093fa92d9a156fc302b8966fd529a27745f278`.
- **CI en `main` `2d4fc23`:** [Go](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/39051712802), [Rust](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/39051712713), [Infrastructure](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/39051712840) y [Contracts](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/39051712800) terminaron con `success`. [CI Integration ejecutado manualmente en main](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/39052723480) también terminó con `success`, incluida limpieza `docker compose down -v --remove-orphans`.
- **CI del PR A07:** [CI Integration de la revisión con imagen compartida](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/39054107757) pasó schemas, réplicas, gRPC Health, endpoints y limpieza. `go`, `rust`, `validate` y `contracts` también pasaron en el mismo commit `d934971`.
- **Limpieza local:** `docker compose down -v --remove-orphans` terminó con éxito; `docker compose ps` volvió a mostrar cero servicios del proyecto. Los volúmenes borrados eran los creados para este ensayo.

## Matriz de A07

`PASS (CI)` confirma el commit indicado en GitHub Actions y es evidencia válida para A07. La validación de cada PC del laboratorio no forma parte del cierre de A07; queda registrada en A05.

| Componente | Responsable | Prueba y evidencia | Estado | Bloqueante |
| --- | --- | --- | --- | --- |
| Go | Ángel | CI Go: formato, `go vet ./...`, `go test -race ./...`; Compose expone `/healthz`, `/readyz` y `/metrics`. | **PASS** | Ninguno para A07. |
| Rust | Ricardo | CI Rust: `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, `cargo test --locked`; ambas réplicas quedan `healthy` y comparten imagen. | **PASS** | Ninguno para A07. |
| PostgreSQL | Ángel | `pg_isready` healthy; schemas `match` y `player` verificados localmente y en CI Integration. | **PASS** | La validación física del host final queda en A05. |
| Docker/Compose | Ángel | `docker compose config` y `up --build --wait` pasan; CI Infrastructure/Integration reproducen el stack. | **PASS** | La instalación en las PC finales queda en A05/H66. |
| Envoy y monitoreo base | Ángel | Envoy ready, dos upstreams gRPC saludables, Prometheus y Grafana responden en smoke test. | **PASS** | Instrumentación funcional avanzada corresponde a H67–H69. |
| Web | Ralph/Santiago | PR #7 importa el frontend real; `CI Web` pasa y el PR documenta `npm start`, `npm run check` y `npm test` con 135 pruebas aprobadas. | **PASS para A07** | Integración online real corresponde a G56–G61. |
| Segunda interfaz | Ralph/Santiago | Aún no existe porque su lenguaje/estrategia se decide en D30. | **FUERA DEL ALCANCE DE A07** | D30/G58. |
| Contratos | Ángel/Ricardo | CI Contracts compila `.proto` con `protoc`; el contrato puede seguir evolucionando hasta E43. | **PASS de entorno** | E43 cierra semántica, no el entorno. |

## Comandos reproducibles

Desde la raíz del repositorio:

```bash
docker compose config
# En esta estación, 8080 está ocupado por otro contenedor:
GO_HTTP_PORT=18080 docker compose up -d --build --wait --wait-timeout 300
docker compose ps
curl -fsS http://127.0.0.1:18080/healthz
curl -fsS http://127.0.0.1:18080/readyz
curl -fsS http://127.0.0.1:18080/metrics
curl -fsS http://127.0.0.1:9901/ready
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:3000/api/health
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT nspname FROM pg_namespace"'
docker compose down -v --remove-orphans
```

`down -v` **borra los volúmenes de este stack de ensayo**: úsese solo tras confirmar que no contienen datos que deban conservarse. En CI se ejecuta siempre después del smoke test. La comprobación de réplicas y de gRPC Health está en `.github/workflows/ci-integration.yml` de este PR. Compose ahora declara la misma etiqueta de imagen para las dos réplicas; el workflow compara sus IDs de imagen y estados `healthy`.

Pruebas directas, desde el directorio de cada servicio cuando exista la toolchain:

```bash
cd services/match-service-go
test -z "$(gofmt -l .)"
go vet ./...
go test -race ./...

cd ../player-profile-service-rust
cargo fmt --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked
```

Para los clientes no existe todavía comando válido de arranque. Al importar el frontend real, Ralph y Santiago deben añadir a `apps/web/README.md` el **comando exacto desde un checkout limpio** para instalar dependencias y arrancar el cliente, y ejecutarlo cada uno en su equipo; deben aportar salida del comando, captura del cliente y versión de runtime. La segunda interfaz debe aportar la misma evidencia después de D30. No se inventa un `npm`/lenguaje antes de conocer el proyecto importado.

## Incidencias y huecos de cobertura

| Severidad | Componente | Reproducción y hallazgo | Tratamiento |
| --- | --- | --- | --- |
| Media | CI Integration | Antes de este PR, el workflow solo esperaba arranque y consultaba Go, Envoy, Prometheus y Grafana; no confirmaba `match`/`player`, ni salud/imagen de ambas réplicas Rust, ni upstreams gRPC saludables. | **A07 corregida:** se añadieron pasos y pasaron en el run enlazado arriba. |
| Media | Docker/Compose Rust | En el primer arranque local, `docker inspect -f '{{.Image}}'` devolvió IDs distintos para Rust #1/#2, aunque ambos estaban saludables: cada servicio se construía bajo una etiqueta distinta. | **A07 corregida:** `compose.yml` declara imagen compartida; repetición local confirmó IDs iguales y salud de ambas. |
| Baja | Puertos de esta estación | El primer `up --build --wait` falló porque `audit-api` ya publicaba 8080. | **A07:** se usó `GO_HTTP_PORT=18080`; no se modifica ni detiene el contenedor ajeno. A05 comprobará puertos del laboratorio. |
| Baja | Toolchains de esta sesión | `go`, `cargo` y `protoc` no están instalados directamente en este WSL, pero las validaciones equivalentes pasan en CI y los servicios construyen mediante Docker. | **No bloquea A07.** Si un integrante quiere desarrollo nativo fuera de contenedores, instala la toolchain según README. |
| Baja | Clientes | La auditoría original ocurrió antes de la importación del frontend. PR #7 ya incorpora el prototipo y `CI Web` pasa. | **Resuelto para A07.** D30/G58 cubren la segunda interfaz futura. |
| Informativa | Laboratorio | No existe todavía acceso/verificación de las seis PC Windows 10, su WSL2/Docker, firewall, LAN ni latencia. | **A05 independiente:** se verificará antes de D31/H66 y de la entrega física, sin bloquear el desarrollo. |
| Baja | Servicio Go/Rust | Go ofrece solo health/readiness/metrics base; Rust solo gRPC Health. El smoke test no demuestra flujo de perfil o DB funcional. | **E43/F46/F47/E44:** alcance futuro; no añadir negocio en A07. |

## Cierre de A07

A07 se considera **completada** porque existe evidencia reproducible de que el entorno base del proyecto puede construirse, validarse e integrarse:

1. Go y Rust pasan sus checks de calidad y pruebas en CI.
2. PostgreSQL inicializa los schemas requeridos.
3. Docker Compose levanta el stack integrado.
4. Envoy observa dos réplicas Rust saludables.
5. Go, Prometheus y Grafana responden a sus probes.
6. Los contratos Protobuf compilan.
7. El frontend real cuenta con ejecución y validación automatizada en PR #7 / CI Web.
8. Las incidencias encontradas durante la auditoría quedaron documentadas y las de Compose/CI fueron corregidas.

### Trabajo diferido que no reabre A07

- **A05:** hardware, Windows 10, WSL2/Docker de las PC finales, firewall, LAN, IPs/hostnames y latencia del laboratorio.
- **D30/G58:** segunda interfaz.
- **E43:** cierre semántico de contratos.
- **H66/I76:** despliegue y ensayo sobre la infraestructura física.

**Conclusión:** A07 completada. A05 es una validación de infraestructura física posterior y no bloquea el desarrollo de Go, Rust, contratos, CI ni el primer vertical slice.
