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

`Integration` se dispara cuando cambian servicios, infraestructura, base de datos, Compose o contratos.

## Workflows actuales

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
3. ejecuta `docker compose up -d --build --wait`;
4. comprueba Go;
5. comprueba Envoy;
6. comprueba Prometheus;
7. comprueba Grafana;
8. muestra el estado del stack;
9. destruye contenedores y volúmenes al terminar.

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
- bloqueo de eliminación de `main`;
- bloqueo de force pushes.

`CI Integration` no es required check global porque usa filtros por rutas y no se ejecuta en todos los PR.

## Ejecución local equivalente

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
