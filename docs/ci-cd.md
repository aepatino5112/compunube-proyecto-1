# CI/CD

## Objetivo

El pipeline mantiene `main` cerca de un estado desplegable, coherente con **Fast Deployment**.

Actualmente existe **CI automatizado**. El CD hacia las máquinas del laboratorio sigue pendiente hasta cerrar el mecanismo de acceso y despliegue.

## Flujo

```text
feature/* | fix/* | docs/* | chore/*
                  |
                  v
            Pull Request
                  |
        +---------+---------+---------+---------+
        |         |         |         |         |
       Go        Rust     Infra   Contracts  Integration*
        |         |         |         |         |
        +---------+---------+---------+---------+
                  |
                  v
                main
                  |
                  v
        [CD al laboratorio]
              pendiente
```

`Integration` se dispara cuando cambian servicios, infraestructura, base de datos, Compose o contratos, tanto en Pull Requests como después del merge a `main`. `CI Web` se ejecuta en todos los Pull Requests para mantener un estado estable y utilizable como evidencia de protección.

## Workflows actuales

### CI Web — `.github/workflows/ci-web.yml`

Valida el frontend importado en `apps/web/` con Node.js 24:

1. instala dependencias fijadas mediante `npm ci --ignore-scripts`;
2. comprueba sintaxis mediante `npm run check`;
3. ejecuta las pruebas del cliente y assets mediante `npm test`.

Se ejecuta en **todos los Pull Requests** y en pushes a `main` cuando cambia el frontend o su workflow, y permite ejecución manual. Ejecutarlo siempre en PR evita que el estado `web` desaparezca por filtros de rutas y permite usarlo de forma estable en la protección de `main`. Usa permisos de lectura y un timeout de diez minutos. Este check no demuestra partidas con backend real ni reemplaza los checks de Go, Rust, infraestructura o contratos.

### CI Go — `.github/workflows/ci-go.yml`

Valida:

1. `gofmt`;
2. `go vet`;
3. `go test -race ./...`.

El race detector es obligatorio porque goroutines/channels forman parte central del Match Service.

### CI Rust — `.github/workflows/ci-rust.yml`

Valida:

1. `cargo fmt --check`;
2. `cargo clippy --all-targets --all-features -- -D warnings`;
3. `cargo test`.

El servicio debe mantenerse apto para múltiples réplicas.

### CI Infrastructure — `.github/workflows/ci-infra.yml`

Valida:

1. `docker compose config`;
2. configuración de Envoy con `envoy --mode validate`.

### CI Contracts — `.github/workflows/ci-contracts.yml`

Compila los `.proto` con `protoc` para detectar errores de sintaxis y referencias.

### CI Integration — `.github/workflows/ci-integration.yml`

Smoke test del stack:

1. prepara `.env`;
2. valida Compose;
3. ejecuta `docker compose build` para construir explícitamente las imágenes del stack;
4. ejecuta `docker compose up -d --no-build --wait`;
5. comprueba que PostgreSQL creó los schemas `match` y `player`;
6. comprueba que las dos réplicas Rust están saludables y usan la misma imagen;
7. comprueba Go y los dos upstreams saludables de Envoy mediante gRPC Health;
8. comprueba Prometheus y Grafana;
9. muestra el estado del stack;
10. destruye contenedores y volúmenes al terminar.

Los checks HTTP usan reintentos acotados porque un contenedor puede estar `running` antes de que el servidor HTTP acepte conexiones.

## Protección de main

El repositorio público tiene activo el ruleset **Protect main** sobre la default branch.

Actualmente exige:

- cambios hacia `main` mediante Pull Request;
- **1 aprobación** antes del merge;
- branch actualizada antes del merge;
- checks requeridos:
  - `go`;
  - `rust`;
  - `validate`;
  - `contracts`;
  - `web`;
- bloqueo de eliminación de `main`;
- bloqueo de force pushes.

`CI Integration` no es required check global porque usa filtros por rutas y no se ejecuta en todos los PR. Su objetivo es validar el stack completo cuando un cambio puede afectarlo. Los checks Go, Rust, Infrastructure, Contracts y Web constituyen la validación rápida y visible de cada PR.

## Cobertura de H64 — Fast Deployment

La tarea **H64 · Crear pipeline de integración continua para Fast Deployment** se considera cubierta cuando esta configuración está integrada en `main`:

| Criterio | Evidencia |
| --- | --- |
| Go | `CI Go`: formato, vet y pruebas con race detector. |
| Rust | `CI Rust`: fmt, Clippy y tests con lockfile. |
| Cliente web | `CI Web`: instalación bloqueada, sintaxis y regresiones en todos los PR. |
| Contratos | `CI Contracts`: compilación de todos los `.proto`. |
| Infraestructura | `CI Infrastructure`: validación de Compose y Envoy. |
| Construcción de imágenes | `CI Integration`: `docker compose build` explícito. |
| Integración | `CI Integration`: PostgreSQL, Go, dos Rust, Envoy, Prometheus y Grafana. |
| Evidencia en PR | GitHub Checks visibles y con timeout acotado. |
| Validación post-merge | `CI Integration` vuelve a ejecutarse en `main` para cambios relevantes. |

H64 automatiza integración continua; **no implementa CD al laboratorio**. Ese trabajo permanece en H66 y depende de la auditoría física A05.

## Cobertura de H65 — Quality gates

La tarea **H65 · Automatizar calidad para habilitar Fast Deployment** formaliza las comprobaciones que deben fallar antes de integrar un cambio incorrecto.

| Área | Gate automático | Equivalente local |
| --- | --- | --- |
| Go | `gofmt`, `go vet`, `go test ./...`, `go test -race ./...` | `make quality-go` |
| Rust | `cargo fmt --check`, Clippy con warnings como error, `cargo test --locked` | `make quality-rust` |
| Cliente web | instalación bloqueada, syntax check y regresiones | `make quality-web` |
| Contratos | compilación de todos los Protobuf | `make quality-contracts` |
| Infraestructura | validación de Compose y configuración Envoy | `make quality-infra` |
| Base de datos actual | schemas `match` y `player` verificados en CI Integration | CI Integration |

El comando `make quality` ejecuta el conjunto local de calidad de Go, Rust, Web, contratos e infraestructura. Requiere las toolchains documentadas (Go, Rust, Node.js 24, `protoc`, Docker y Make).

E42 añade migraciones versionadas y un smoke de permisos/backup/restauración a `CI Integration`. El bootstrap de schemas de Compose permanece para volúmenes nuevos; la aplicación versionada se ejecuta por el runner E42. Las credenciales runtime separadas siguen pendientes de H62.

Los checks separados de GitHub mantienen errores fáciles de localizar: un fallo de Go, Rust, Web, Contracts o Infrastructure aparece en su job correspondiente. No se reemplazan por un único job monolítico.

## Ejecución local equivalente

```bash
make quality

# o por área:
make quality-go
make quality-rust
make quality-web
make quality-contracts
make quality-infra

docker compose config
docker compose up -d --build --wait
docker compose ps
docker compose down -v
```

## Política de fallos

Si un check falla:

1. no mergear;
2. identificar el step;
3. reproducir localmente cuando sea posible;
4. corregir en la misma rama;
5. esperar la nueva ejecución automática.

No se desactiva un check solo para hacer pasar un PR.

## Dependencias y reproducibilidad

- Go versiona `go.mod` y `go.sum` cuando corresponda.
- Rust versiona `Cargo.toml` y `Cargo.lock`.
- CI y Docker deben usar toolchains compatibles.
- Imágenes Docker deben evitar `latest` cuando sea viable.
- Secretos nunca se guardan en Git.

## CD al laboratorio — pendiente

El CD se implementará cuando se cierre cómo GitHub Actions alcanzará las máquinas Windows 10.

Opciones a evaluar:

- runner self-hosted dentro del laboratorio;
- despliegue remoto autenticado;
- procedimiento semiautomático si existen restricciones de red.

Flujo esperado:

```text
main
  |
  v
build/version
  |
  v
deploy lab
  |
  v
health checks
  |\
  | +--> failure --> rollback
  |
  +----> success
```

No se implementará `deploy-lab.yml` hasta conocer el método real de acceso.

## Cuándo actualizar este documento

Actualizarlo si cambia:

- un workflow;
- un required check;
- el ruleset;
- la estrategia de ramas;
- el despliegue;
- rollback;
- publicación de imágenes;
- infraestructura del laboratorio.
