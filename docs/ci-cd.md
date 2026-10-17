# CI/CD

## Objetivo

El pipeline del proyecto existe para mantener `main` cerca de un estado desplegable, coherente con **Fast Deployment**.

El repositorio tiene actualmente **CI implementado** y una base preparada para **CD**, pero el despliegue automático al laboratorio todavía no está habilitado. No llamamos CD a algo que aún no despliega.

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

`Integration` solo se dispara automáticamente cuando cambian servicios, infraestructura, base de datos, Compose o contratos.

## Workflows actuales

### CI Go — `.github/workflows/ci-go.yml`

Se ejecuta en todo Pull Request y en cambios a `main`.

Valida:

1. formato con `gofmt`;
2. análisis con `go vet`;
3. pruebas con `go test -race ./...`.

El race detector es obligatorio porque la concurrencia con goroutines/channels es una responsabilidad central del Match Service.

### CI Rust — `.github/workflows/ci-rust.yml`

Se ejecuta en todo Pull Request y en cambios a `main`.

Valida:

1. `cargo fmt --check`;
2. `cargo clippy --all-targets --all-features -- -D warnings`;
3. `cargo test`.

El Player/Profile Service debe permanecer apto para múltiples réplicas.

### CI Infrastructure — `.github/workflows/ci-infra.yml`

Valida:

1. `docker compose config`;
2. sintaxis/configuración de Envoy mediante `envoy --mode validate`.

No reemplaza el smoke test de integración; su objetivo es feedback rápido sobre configuración.

### CI Contracts — `.github/workflows/ci-contracts.yml`

Compila todos los `.proto` con `protoc` para detectar errores de sintaxis o referencias rotas.

Cambios en `proto/**` también provocan CI de Go y Rust porque el contrato afecta ambos servicios.

### CI Integration — `.github/workflows/ci-integration.yml`

Es el smoke test del stack.

Cuando el cambio afecta componentes integrados:

1. copia `.env.example` a `.env`;
2. valida Compose;
3. ejecuta `docker compose up -d --build --wait`;
4. espera servicios healthy/running;
5. comprueba health/readiness de Go con reintentos acotados mientras termina de iniciar;
6. comprueba readiness de Envoy con la misma política;
7. comprueba Prometheus;
8. comprueba Grafana esperando su readiness HTTP antes de fallar;
9. muestra estado del stack;
10. siempre destruye contenedores y volúmenes al terminar.

Los checks HTTP usan reintentos acotados porque un contenedor puede estar en estado `running` unos segundos antes de que su servidor HTTP acepte conexiones. Esto evita falsos negativos de arranque sin ocultar fallos persistentes.

Este workflow no sustituirá pruebas E2E del juego; verifica que la plataforma mínima puede construirse y arrancar de extremo a extremo.

## Qué debe bloquear un merge

Antes de fusionar un PR, los workflows que se hayan ejecutado deben estar verdes.

Recomendación de protección para `main`:

- Require a pull request before merging.
- Require branches to be up to date before merging.
- Require status checks:
  - `CI Go / go`
  - `CI Rust / rust`
  - `CI Infrastructure / validate`
  - `CI Contracts / contracts`
- No permitir push directo a `main`.

`CI Integration` usa filtros por rutas y por eso **no debe configurarse todavía como required check global**: un PR que no lo dispare podría quedar bloqueado esperando un check inexistente. Cuando queramos volverlo obligatorio para todos los PR, consolidaremos el gate o retiraremos los filtros.

## Ejecución local equivalente

Antes de abrir un PR relevante:

```bash
make lint
make test
docker compose config
docker compose up -d --build --wait
docker compose ps
docker compose down -v
```

## Política de fallos

Si un check falla:

1. no mergear;
2. leer el step exacto que falló;
3. reproducir localmente cuando sea posible;
4. corregir en la misma rama;
5. dejar que GitHub Actions vuelva a ejecutar el pipeline.

No desactivar un check para hacer pasar un PR salvo que exista una razón documentada.

## Dependencias y reproducibilidad

- Go debe mantener `go.mod`/`go.sum` cuando aparezcan dependencias.
- Rust debe versionar `Cargo.lock` al comenzar a incorporar dependencias reales de aplicación.
- Imágenes Docker deben usar tags explícitos y no `latest` siempre que sea viable.
- Los secretos nunca se guardan en el repositorio.

## CD al laboratorio — pendiente

El CD se implementará cuando se cierre el mecanismo de acceso a las máquinas Windows 10.

La opción debe documentarse antes de implementarse. Posibilidades razonables:

- runner self-hosted controlado dentro del laboratorio;
- despliegue remoto autenticado desde un runner;
- procedimiento semiautomático si las restricciones del laboratorio impiden automatización completa.

El flujo esperado será:

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
  | +--> failure --> rollback / previous known-good version
  |
  +----> success
```

No se implementará un `deploy-lab.yml` hasta saber cómo se autentican y alcanzan los equipos.

## Cuándo actualizar este documento

Actualizar `docs/ci-cd.md` cuando cambie:

- un workflow;
- un required check;
- la estrategia de branches;
- el método de despliegue;
- rollback;
- generación/publicación de imágenes;
- infraestructura del laboratorio.
