# A07 — Auditoría del entorno de desarrollo

**Fecha:** 2026-10-17 · **Responsable:** Ángel Patiño · **Estado:** parcialmente validada; bloqueada por A05 y por evidencia individual del equipo.

Esta auditoría parte de `main` `2d4fc23` y de la rama `chore/a07-environment-validation`. Distingue pruebas de GitHub Actions, pruebas en este WSL2 y verificaciones que solo pueden hacer integrantes o personal con acceso al laboratorio. A06 está cerrada. A05 sigue pendiente: **A07 no debe pasar a Done** por este documento.

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

`PASS (CI)` confirma el commit indicado en GitHub Actions; no equivale a validación de cada PC. `PENDING` indica que falta la evidencia descrita, aunque exista un smoke test relacionado.

| Componente | Responsable | Prueba y evidencia | Estado | Bloqueante |
| --- | --- | --- | --- | --- |
| Go | Ángel | CI Go: formato, `go vet ./...`, `go test -race ./...` en `2d4fc23`; en Compose local, `/healthz`, `/readyz` y `/metrics` PASS con puerto 18080. | **PASS CI y smoke local; PENDING toolchain individual** | Go ausente en este WSL; ejecución de Ángel con toolchain local por confirmar. |
| Rust | Ricardo | CI Rust: `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, `cargo test --locked`; Compose construye con `--locked`. Ambas réplicas locales `healthy`, misma imagen tras ajuste. | **PASS CI y smoke local; PENDING Ricardo** | Falta ejecución en el entorno de Ricardo. |
| PostgreSQL | Ángel | `pg_isready` healthy; consulta local devolvió `match` y `player`. CI Integration ampliado también los consulta. | **PASS local/CI; PENDING laboratorio** | A05 para las PC Windows 10. |
| Docker/Compose | Ángel | `docker compose config` local PASS; `up --build --wait` local PASS con `GO_HTTP_PORT=18080`; CI Infrastructure e Integration base PASS. | **PASS esta estación/CI; PENDING laboratorio** | A05: WSL2/Docker, recursos y puertos en cada PC Windows 10. |
| Envoy y monitoreo | Ángel | CI Integration base y smoke local de Envoy/Prometheus/Grafana PASS; Envoy local mostró dos upstreams gRPC saludables. | **PASS esta estación/CI; PENDING laboratorio** | A05; ampliar monitoreo funcional corresponde a H67–H69. |
| Web | Ralph/Santiago | `apps/web/` contiene solo `README.md`; no hay aplicación, manifest ni comando ejecutable. | **PENDING** | B08/importación del prototipo real y ejecución por ambos responsables. |
| Segunda interfaz | Ralph/Santiago | `apps/client-secondary/` contiene solo `README.md`. | **PENDING** | D30 debe definir lenguaje/estrategia; después se valida el cliente real. |
| Contratos | Ángel/Ricardo | CI Contracts compila `.proto` con `protoc` en `2d4fc23`; contrato sigue draft. | **PASS sintaxis (CI); PENDING contrato final** | E43 para cierre semántico/compatibilidad. |

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
| Media | Entorno de esta sesión | `command -v go cargo protoc` no encuentra toolchains; no se pueden ejecutar localmente race, Clippy ni protoc. | **A07, entorno individual:** instalar según README o demostrar estos comandos desde la estación de Ángel/Ricardo. CI sí aporta evidencia de build/calidad del commit. |
| Alta | Clientes | `rg --files apps/web apps/client-secondary` devuelve únicamente los dos README; no hay frontend jugable importado. | **B08/D30 y A07:** importar/auditar el cliente real; luego cada responsable aporta ejecución individual. |
| Alta | Laboratorio | No existe en esta sesión acceso/verificación de las seis PC Windows 10, su WSL2/Docker, firewall, LAN ni latencia. | **A05:** auditoría física y de red antes de cerrar A07. |
| Baja | Servicio Go/Rust | Go ofrece solo health/readiness/metrics base; Rust solo gRPC Health. El smoke test no demuestra flujo de perfil o DB funcional. | **E43/F46/F47/E44:** alcance futuro; no añadir negocio en A07. |

## Evidencia pendiente para cierre

1. **A05:** inventario de seis PC, Windows 10, WSL2/Docker por equipo, recursos, puertos/firewall, conectividad LAN e IP/hostname reales; pruebas desde el laboratorio.
2. **Ángel y Ricardo:** salida de comandos directos de Go/Rust y arranque de sus componentes en sus estaciones, con versiones de toolchain.
3. **Ralph y Santiago:** checkout limpio y arranque del frontend jugable importado, cada uno con comando y captura; segunda interfaz solo después de D30.
4. **PR A07:** checks obligatorios y CI Integration ampliado pasaron en `d934971`; falta revisión/aprobación según el ruleset.

**Conclusión:** A07 parcialmente validada; bloqueada por A05 y por validaciones de los miembros. El smoke test de CI demuestra que el stack base arranca en un runner Linux, no que el laboratorio o los clientes reales estén listos.
