# E40 — Health, liveness y readiness por instancia

Diseño para la capacidad de Health Monitoring de [E36/E37](cloud-native-pattern-selection.md) que alimenta el Ambassador Envoy. Debe concordar con el modo degradado [E38](resilience-failover-degraded-mode.md), el Bulkhead [E39](go-bulkhead-backpressure.md), el ownership de [E41](postgresql-schema.md) y NFR-OBS-001 de [C22](../requirements/non-functional-requirements.md). Define semántica objetivo; los handlers, `main.rs`, Compose, Envoy y monitoreo actual siguen como scaffolding hasta sus tareas de implementación.

## Tres preguntas distintas

| Señal | Pregunta | Resultado y uso |
| --- | --- | --- |
| **Liveness** | ¿El proceso puede responder y sigue ejecutándose? | Go `/healthz`: HTTP **200** si puede responder y no terminó; **503** o conexión fallida durante parada/fallo propio. No consulta Rust ni PostgreSQL. No reiniciar Go solo porque Rust no responde. |
| **Readiness de instancia** | ¿Esta instancia acepta el tráfico que se le asigna? | Go `/readyz`: HTTP **200/503** según capacidad propia de servir tráfico público; Rust gRPC Health `player_profile`: **SERVING/NOT_SERVING** según capacidad real de perfil con PostgreSQL. Startup/shutdown son no-ready. |
| **Salud de dependencia/capacidad** | ¿Qué operación está degradada y por qué? | Estado separado de Rust, Envoy, PostgreSQL `match`/`player`, circuito E38 y métricas. No se reduce a un booleano global ni se disfraza como perfil confirmado. |

Un probe debe ser de **solo lectura**, con timeout corto y recursos acotados, sin entrar en RoomLoop ni competir por los pools de perfil/settlement E39. No ejecuta compras, mutaciones, settlement ni una transacción de juego. El estado se observa por instancia y se distingue de una operación de negocio exitosa: un probe verde no prueba por sí solo la semántica completa del servicio.

## Go Match Service

- **`GET /healthz` en HTTP 8080**: 200 si el proceso/event loop HTTP está vivo y no terminó; independiente de Rust, Envoy y PostgreSQL. El handler actual responde siempre 200 mientras sirve; la semántica de ciclo de vida se implementará después.
- **`GET /readyz` en HTTP 8080**: 503 durante inicialización, cierre o si Go no puede aceptar/servir tráfico público de forma controlada por fallo propio. 200 cuando puede mantener salas/conexiones existentes y responder de forma válida, incluso si Player/Profile está degradado. **Rust caído no vuelve Go no-ready.** La respuesta/telemetría de dependencia indica perfil indisponible y E38 evita `ready` de jugadores sin perfil confirmado.
- **PostgreSQL caído**: Go bloquea *nuevas admisiones u operaciones que requieren escritura `match`*, sin destruir salas, WebSockets o carreras ya activos. Si aún puede servir y dar rechazos controlados, `/readyz` puede permanecer 200 con estado de dependencia degradada; marcar Go 503 por un fallo parcial cortaría incluso reentradas sanas. Si Go pierde su propia capacidad de servir tráfico de manera controlada, `/readyz` pasa a 503. Los resultados no persistidos no se presentan como durables (E38/E41).
- **`GET /metrics` en 8080** continúa para observabilidad. Readiness no se usa como sustituto de métricas de saturación, circuito o resultados pendientes.

La admisión HTTP/WebSocket de una operación que requiera persistencia se decide **por capacidad**, además del `/readyz` global. Un 200 global no autoriza inventar perfil, aceptar `ready` inválido ni crear una sala que no pueda registrarse. El contrato público/mapeo HTTP definitivo pertenece a E45; el realtime E43 ya define `PROFILE_UNAVAILABLE` para preparación.

## Rust Player/Profile Service y PostgreSQL

Cada réplica Rust anuncia por gRPC Health `service_name=player_profile`:

| Estado de instancia | gRPC Health | Conducta |
| --- | --- | --- |
| Inicialización incompleta, esquema incompatible o apagado | `NOT_SERVING` | No recibe nuevas RPC a través de Envoy; solicitudes en curso terminan o se cancelan según deadline. |
| Pool DB sin conexión útil, autenticación fallida o PostgreSQL indisponible | `NOT_SERVING` | No afirmar perfil/economía sanos por tener puerto gRPC abierto. Se observa el motivo sin revelar credenciales. |
| Inicializada, conexión/consulta DB válida con rol `player`, esquema/migraciones requeridos compatibles | `SERVING` | Envoy puede dirigir RPC; cada operación sigue validando y puede fallar independientemente. |

La transición de Rust no depende de memoria crítica de una sola réplica. La verificación usa un probe pequeño y acotado a PostgreSQL con el rol propio, más un estado compatible del esquema cuando E42 materialice migraciones; no toca `match` ni ejecuta mutaciones. Debe limitar frecuencia/tiempo y aislar recursos del pool de negocio para que una avalancha de probes no ahogue solicitudes normales. Al parar, Rust anuncia `NOT_SERVING` antes de dejar de aceptar trabajo cuando sea posible.

Para PostgreSQL se requieren **dos niveles**: `pg_isready` comprueba disponibilidad básica del servidor y una **consulta real `SELECT 1` con credenciales de la aplicación** comprueba que la conexión/consulta funciona. TCP abierto o `pg_isready` solo no prueban permisos ni esquema. La readiness de Go/Rust verifica además su schema esperado (`match`/`player`) y versión de migración cuando E42 exista; no presupone un mecanismo de migración ya implementado. Un fallo físico de la única instancia PostgreSQL puede degradar ambos servicios, pero los ticks activos en memoria Go continúan mientras su proceso viva.

## Envoy y topología observada

Envoy escucha gRPC en **50051** y admin en **9901**. `GET /ready` del admin indica si **Envoy mismo** está listo; **no** garantiza que tenga un upstream Rust saludable. El estado del cluster `player_profile_cluster` y los resultados del gRPC health check por réplica son la evidencia de upstream. Go conserva un único destino lógico Envoy; no busca IPs Rust.

El [envoy.yaml actual](../../infra/envoy/envoy.yaml) usa `ROUND_ROBIN`, `connect_timeout: 1s`, `route timeout: 3s` y gRPC Health `player_profile` con `interval: 3s`, `timeout: 1s`, `unhealthy_threshold: 2`, `healthy_threshold: 1`. Estos son **baselines de configuración actual, configurables y sujetos a medición**, no requisitos del profesor. Dos fallos consecutivos de health excluyen una réplica; una comprobación exitosa puede reincorporarla. Health de Envoy afecta selección de upstream, no modifica el resultado de carrera ni sustituye el Circuit Breaker lógico de Go. La recuperación no requiere reiniciar Go: Envoy reincorpora Rust y E38 deja pasar su sonda `half-open`.

## Scaffolding actual frente a semántica objetivo

| Componente | Estado comprobado hoy | Cambio de implementación posterior |
| --- | --- | --- |
| Go `8080 /healthz`, `/readyz`, `/metrics` | [`main.go`](../../services/match-service-go/cmd/server/main.go) devuelve 200 estático para health/ready y métrica básica. | Ciclo de vida y capacidad real por endpoint; dependencia degradada observable sin derribar carrera. |
| Rust interno `50051` | [`main.rs`](../../services/player-profile-service-rust/src/main.rs) registra `tonic_health` y marca `player_profile` `SERVING` al arrancar, sin consultar DB. | `SERVING` condicionado a inicialización, consulta DB y esquema; `NOT_SERVING` al perderlos. |
| Compose Rust | [`compose.yml`](../../compose.yml) usa `nc -z 127.0.0.1 50051`: solo puerto TCP. | Health de Compose representará capacidad real; `depends_on` no sustituye comprobación continua. |
| Compose PostgreSQL | `pg_isready`; Go depende de Postgres healthy y Rust también al arranque. | Añadir/verificar `SELECT 1` con credenciales y esquema donde aplique; dependencia de startup no garantiza salud posterior. |
| Envoy | gRPC health por instancia y admin `/ready` ya configurados. | J78 comprobará exclusión/reincorporación con Rust health ligado a DB y tráfico real. |
| CI de integración | [Workflow](../../.github/workflows/ci-integration.yml) consulta Go `/healthz`/`/readyz`, Envoy `/ready` y dos Rust healthy. | Extender pruebas de fallo/degradación en J78/I73; el verde actual prueba scaffolding, no toda esta semántica. |

Prometheus en **9090** observa targets y Grafana en **3000** visualiza; ninguno decide failover. H68 instrumentará scraping/tableros finales. Puertos y destinos expuestos hoy por Compose son **configurables por entorno**; D31/A05 determinarán la topología física, sin fijar IPs en este diseño.

## Matriz de escenarios a demostrar

| Inyección | Go `/healthz` / `/readyz` | Rust/Envoy y operación real | Recuperación esperada |
| --- | --- | --- | --- |
| Detener Rust #1 | 200 / 200 si Go sano. | #1 no saludable y excluida; #2 `SERVING` recibe consultas; estado cluster refleja una upstream sana. | Reiniciar #1, comprobar DB/esquema, `SERVING`, reincorporación y reparto. |
| Detener ambas Rust | 200 / 200 para Go que sigue sirviendo carreras. | Ambas fuera; perfil/economía indisponibles, `ready` de jugador que exige perfil no se confirma; settlement pendiente. Envoy `/ready` puede seguir 200 por estar vivo. | Restaurar una réplica, ver health sano, sonda E38 y nuevas consultas; drenar pendientes gradualmente. |
| Detener PostgreSQL | 200 / 200 mientras Go mantiene tráfico controlado; nueva admisión que necesita `match`/`player` se rechaza. Si Go ya no puede servir, `/readyz` 503. | Rust `NOT_SERVING` por DB; Envoy excluye réplicas. `pg_isready`/`SELECT 1` fallan. Carrera activa continúa en memoria; resultado no escrito no es durable. | DB vuelve, `SELECT 1`/esquemas válidos, Rust `SERVING`, Envoy reincorpora y E38 reconcilia pendientes durables. |
| Envoy caído | 200 / 200 si Go sano y carreras avanzan. | Ruta Player/Profile degradada aunque Rust esté sano; circuito/fallback E38. | Envoy `/ready`, cluster sano y sonda de Go permiten volver a operaciones. |
| Apagado de Go | Liveness termina o conexión falla; readiness 503 durante cierre ordenado. | No se promete supervivencia de carrera al caer Go. | Nuevo proceso inicia no-ready, inicializa y pasa a ready cuando puede servir. |

J78/I73 deberán contrastar **probe + operación sintética real** y registrar tiempos de exclusión, reincorporación, llamadas fallidas, estado de circuito y continuidad de tick. Los umbrales actuales de Envoy y los objetivos C22 siguen sujetos a medición y aprobación. Esta PR solo define diseño; no cambia handlers, health gRPC, Compose, Envoy ni Prometheus.
