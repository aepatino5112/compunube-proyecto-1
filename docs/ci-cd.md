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

### CI Client Secondary — `.github/workflows/ci-client-secondary.yml`

Instala las dependencias fijadas de `apps/client-secondary/requirements-dev.txt`, compila el paquete y ejecuta `pytest` del cliente Python en Ubuntu y Windows. Como CI Web, se publica en todos los PR.

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

Valida el OpenAPI público E45 con `@apidevtools/swagger-cli@4.0.4` y compila los `.proto` con `protoc` para detectar errores de sintaxis y referencias.

### CI Integration — `.github/workflows/ci-integration.yml`

Smoke test del stack:

1. prepara `.env`;
2. valida Compose;
3. genera contraseñas efímeras independientes para PostgreSQL administrador, Go, Rust y postgres-exporter, y ejecuta `docker compose build` para construir explícitamente las imágenes del stack;
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
| Cliente Python | dependencias fijadas, compilación y `pytest` (Ubuntu y Windows) | `make quality-client-secondary` |
| Contratos | compilación de todos los Protobuf | `make quality-contracts` |
| Infraestructura | validación de Compose y configuración Envoy | `make quality-infra` |
| Base de datos actual | schemas `match` y `player` verificados en CI Integration | CI Integration |

El comando `make quality` ejecuta el conjunto local de calidad de Go, Rust, Web, contratos e infraestructura. Requiere las toolchains documentadas (Go, Rust, Node.js 24, `protoc`, Docker y Make).

E42 añade migraciones versionadas y un smoke de permisos/backup/restauración a `CI Integration`. J84 ejecuta las migraciones y el provisioning de LOGIN con un servicio administrativo one-shot de Compose antes de iniciar Go/Rust; CI comprueba aislamiento real de ambos usuarios y no usa contraseñas runtime fijas. J85 verifica que el healthcheck de Compose consulta gRPC Health `player_profile` y que Docker y Envoy reaccionan a la caída y recuperación de PostgreSQL y del schema.

H68 añade validación de la configuración y reglas Prometheus con `promtool check config` en CI Infrastructure. CI Integration ejecuta [h68-prometheus.py](../scripts/validation/h68-prometheus.py) después de J85: comprueba targets Go, ambas Rust, Envoy y postgres-exporter, consultas y alertas, y caída/recuperación de rust-1 y PostgreSQL en un proyecto Compose aislado.

H69 provisiona desde Git el datasource y el dashboard operacional de Grafana. CI Integration ejecuta [h69-grafana.py](../scripts/validation/h69-grafana.py) después de H68: valida provisioning y consultas, genera tráfico Go/Rust y comprueba indicadores/alertas durante la caída de una y ambas Rust, PostgreSQL y su recuperación.

G58 añade [g58-python-client.py](../scripts/validation/g58-python-client.py) a CI Integration: en un proyecto Compose aislado, dos clientes Python juegan una carrera real contra Go solo con HTTP E45 y WebSocket E43, y se verifican resultado, propiedad única de recogidas, settlement confirmado, perfil acreditado una vez y el replay del CLI con el mismo `requestId`.

G57 compila en CI Web los módulos TypeScript de `apps/web/src/net` y comprueba que `dist/net` versionado coincide con la compilación. CI Integration ejecuta `npm run test:integration` en `apps/web`: el adaptador compilado del navegador, a través de `server.mjs`, crea la sesión con cookie, lee perfil y catálogo, confirma equipamiento y apariencia, recibe rechazos de negocio sin cambios, comprueba replay y `IDEMPOTENCY_CONFLICT` con el mismo `requestId`, y verifica que Go rechaza mutaciones con cookie sin `Origin` o con otro origen.

G59 extiende `npm run test:integration` con dos clientes web (cookies separadas) que crean y entran a una sala, confirman Listo con la revisión verificada por Go, juegan con inputs monotónicos, ven a un participante salir y esperan el `race.ended` con settlement confirmado y el perfil acreditado una vez; también comprueba que el WebSocket rechaza un handshake con cookie desde otro `Origin`. Después, `npm run test:e2e` (Playwright fijado, dos procesos Chromium independientes) recorre la UI real junto al cliente Python: crear sala en un navegador, entrar con el código en el otro, unir el cliente Python por la API pública, elegir Reducir, marcar Listo, carrera y resultado con acreditación; las capturas se publican como artefacto `web-e2e-results`.

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
