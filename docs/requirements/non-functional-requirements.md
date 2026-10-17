# C22 — Requisitos no funcionales y resiliencia

Versión 0.1 · 2026-10-17 · Estado: propuesta para revisión · Responsable: Ángel Patiño

## Alcance y procedencia

Esta especificación es entrada para C25, D26–D29, E38–E43 e I70–I73. Describe **criterios futuros**, no cumplimiento actual. Trello conserva el estado operativo de C22. Los contratos [realtime](../../contracts/realtime/events.md) y [gRPC](../../proto/player_profile.proto) siguen en borrador hasta E43; B16–B17 definirán reglas y ciclo de partida.

Cada requisito indica **tipo/origen**, enunciado, criterio, prueba, responsable, evidencia y dependencias. «C22 confirmado» significa criterio de la tarjeta C22 reproducido en el handoff, no cifra impuesta por el profesor. «Arquitectura aceptada» remite a [AGENTS.md](../../AGENTS.md), [ARCHITECTURE.md](../../ARCHITECTURE.md) y [ADR 0001](../adr/0001-service-boundaries.md). **Todo umbral numérico nuevo se marca «Objetivo interno propuesto — pendiente de aprobación»**. Al cambiar un umbral se conserva el ID y se registra la decisión; un cambio de significado recibe otro ID.

Las mediciones propuestas usan `docker compose` en hardware equivalente al laboratorio, registrando CPU, RAM, versión, cantidad de clientes y RTT. Percentiles: al menos 1 000 muestras; fallos: tres repeticiones, salvo cuando el requisito indique otra cantidad. Si el laboratorio no soporta un objetivo propuesto, el equipo lo revisa antes de aprobarlo.

## Concurrencia y capacidad

### NFR-CON-001 — Desconexión aislada

- **Tipo/origen:** C22 confirmado: desconectar un cliente no detiene a los demás.
- **Enunciado/criterio:** Go aísla conexiones y partidas; tras cortar abruptamente una conexión, otras conexiones siguen enviando intención y recibiendo estado autoritativo durante 60 s, sin terminar partidas ajenas.
- **Prueba:** dos partidas, dos clientes por partida; cortar uno durante actividad y verificar progreso de los restantes.
- **Responsable/evidencia:** Go Match Service; trazas por conexión/partida y snapshots recibidos.
- **Dependencias:** D28, F50–F51, I72–I73; abandono definitivo depende de B17.

### NFR-CON-002 — Trabajo concurrente acotado

- **Tipo/origen:** Arquitectura aceptada: Go posee estado vivo, goroutines/channels y aislamiento.
- **Enunciado/criterio:** una conexión lenta o RPC bloqueada no impide avanzar otra partida; Go cancela trabajo al cerrar y no presenta carreras de datos detectables.
- **Prueba:** inyectar consumidor lento y Rust no responsivo, observar otra partida y ejecutar `go test -race ./...`.
- **Responsable/evidencia:** Go; trazas de progreso, perfil de goroutines y salida del race detector.
- **Dependencias:** D28, E39, F50–F51, J77, I72.

### NFR-CAP-001 — Carga de referencia

- **Tipo/origen:** Objetivo interno propuesto — pendiente de aprobación.
- **Enunciado/criterio:** sostener **20 clientes en 5 partidas durante 10 min** sin caída, deadlock ni partida sin progreso; informar p50/p95 de latencia, errores, CPU y memoria.
- **Prueba:** generador de clientes que envían intención y consumen snapshots; tres ejecuciones documentadas.
- **Responsable/evidencia:** Go e infraestructura; configuración, series de recursos y reporte de I72.
- **Dependencias:** B17, F50–F53, H67–H69, I72; recalibrar tras A05.

### NFR-CAP-002 — Backpressure

- **Tipo/origen:** Objetivo interno propuesto — pendiente de aprobación.
- **Enunciado/criterio:** límites configurables de conexiones, partidas y colas; al aplicar **2 veces** NFR-CAP-001 durante **5 min**, memoria RSS de Go ≤ **512 MiB**, rechazos contabilizados y partidas admitidas en progreso.
- **Prueba:** subir carga e incluir consumidores lentos; medir RSS, colas, rechazos y progreso.
- **Responsable/evidencia:** Go; configuración de límites y series de saturación.
- **Dependencias:** E39, F51, H67–H69, I72; tamaño final de mensajes depende de E43.

## Red y disponibilidad

### NFR-NET-001 — Latencia realtime

- **Tipo/origen:** Objetivo interno propuesto — pendiente de aprobación.
- **Enunciado/criterio:** p95 ≤ **200 ms** entre enviar intención y recibir estado autoritativo que refleje su procesamiento, bajo NFR-CAP-001 con RTT ≤ **50 ms**; informar p99 y pérdida. No fija frecuencia de tick ni incluye render.
- **Prueba:** cliente instrumentado con secuencia y reloj monotónico, ≥ 1 000 muestras por ensayo.
- **Responsable/evidencia:** Go y cliente de prueba; histograma con RTT, carga y tamaño de mensaje.
- **Dependencias:** B16–B17, E43, F53, G59, I72.

### NFR-AVL-001 — Caída de Rust

- **Tipo/origen:** C22 confirmado y arquitectura aceptada ([ADR 0001](../adr/0001-service-boundaries.md)).
- **Enunciado/criterio:** detener todas las réplicas Rust no derriba Go ni destruye partidas activas; estas siguen progresando. Perfil/economía/settlement indican indisponibilidad, sin saldo o premio ficticio.
- **Prueba:** partidas activas, detener Rust, continuar entradas, consultar perfil/settlement, restaurar Rust y verificar datos durables.
- **Responsable/evidencia:** Go para continuidad/degradación, Rust para persistencia; snapshots, health, errores y consultas PostgreSQL.
- **Dependencias:** E38, F50–F54, J77–J78, I73. No promete supervivencia a caída de Go.

### NFR-AVL-002 — Disponibilidad observada

- **Tipo/origen:** Objetivo interno propuesto — pendiente de aprobación.
- **Enunciado/criterio:** ≥ **99 %** de sondas exitosas de Go y operación sintética de partida en **1 h**, cada **10 s**, excluyendo mantenimiento registrado. Es objetivo del entorno de integración, no SLA de producción.
- **Prueba:** sondeo externo y registro de despliegues/incidentes durante la ventana.
- **Responsable/evidencia:** Go e infraestructura; serie de sondeos y cálculo reproducible.
- **Dependencias:** E40, H66–H69, I73.

## Resiliencia y recuperación

### NFR-RES-001 — Deadline gRPC

- **Tipo/origen:** C22 confirmado y arquitectura aceptada ([AGENTS.md](../../AGENTS.md)).
- **Enunciado/criterio:** toda llamada Go→Rust lleva deadline propagado mediante contexto; una RPC bloqueada termina con error controlado al vencerlo, libera recursos y no para otras partidas.
- **Prueba:** revisión del adaptador e inyección de Rust no responsivo.
- **Responsable/evidencia:** Go; revisión, código de error, duración y prueba de timeout.
- **Dependencias:** E38, E43, J77; el valor por operación se define con el contrato.

### NFR-RES-002 — Retry seguro

- **Tipo/origen:** Arquitectura aceptada ([AGENTS.md](../../AGENTS.md), [ADR 0001](../adr/0001-service-boundaries.md)).
- **Enunciado/criterio:** Go reintenta solo operaciones seguras o idempotentes dentro del deadline total. `SettleRace` solo se reintenta tras demostrar deduplicación; Go y Envoy no aplican retries agresivos simultáneos.
- **Prueba:** provocar error antes y después del commit; contar intentos y comprobar un solo efecto durable.
- **Responsable/evidencia:** Go para política, Rust para idempotencia, Envoy para balanceo/failover; configuración, trazas y datos PostgreSQL.
- **Dependencias:** E38, E43, F54, J77–J78.

### NFR-RES-003 — Límites de retry y circuito

- **Tipo/origen:** Objetivo interno propuesto — pendiente de aprobación.
- **Enunciado/criterio:** `GetProfile` tiene presupuesto total ≤ **750 ms** y máximo **1 retry**; `SettleRace` tiene presupuesto total ≤ **2 s**, sin retry hasta demostrar idempotencia. Go abre circuito tras **5 fallos consecutivos** por **10 s** y permite **1 sonda** de recuperación. Abierto: no salen llamadas normales a Rust y la partida progresa.
- **Prueba:** fallos gRPC consecutivos, contar intentos Go/Envoy, restaurar Rust y observar transición.
- **Responsable/evidencia:** Go y Envoy; configuración, métricas de circuito y reporte de inyección.
- **Dependencias:** E38, J77–J78, I73; valores revisables con carga real.

### NFR-RES-004 — Modo degradado

- **Tipo/origen:** Arquitectura aceptada ([ARCHITECTURE.md](../../ARCHITECTURE.md)).
- **Enunciado/criterio:** Go separa partida de perfil/economía. Sin Rust, las partidas existentes avanzan y operaciones dependientes indican indisponibilidad; ningún saldo se acredita o descuenta sin confirmación transaccional.
- **Prueba:** detener Rust, solicitar perfil/settlement, observar respuesta y comparar datos tras restauración.
- **Responsable/evidencia:** Go y Rust; respuestas, métricas de degradación y consultas PostgreSQL.
- **Dependencias:** E38, E43, F52–F54, G60, J77; UX final depende de B10/G60.

### NFR-REC-001 — Reconexión autoritativa

- **Tipo/origen:** C22 confirmado por alcance de recuperación y arquitectura aceptada; [realtime draft](../../contracts/realtime/events.md).
- **Enunciado/criterio:** con Go/partida activos, cliente con identidad válida recupera snapshot actual sin reproducir todo el historial; otros jugadores nunca se pausan. Identidad ajena no toma su sesión.
- **Prueba:** desconectar/reconectar en partida; comparar snapshot con estado de Go y probar identidad inválida.
- **Responsable/evidencia:** Go y clientes; trazas, snapshots comparados y rechazo de identidad.
- **Dependencias:** B17, E43, F48, G61, I73; ventana de reentrada pendiente de B17.

### NFR-REC-002 — Tiempo de reentrada

- **Tipo/origen:** Objetivo interno propuesto — pendiente de aprobación.
- **Enunciado/criterio:** p95 ≤ **3 s** desde restaurar conectividad hasta recibir snapshot válido, RTT ≤ **50 ms**, en ≥ **100** reconexiones; informar fallos y p99. No cubre reinicio de Go.
- **Prueba:** cortar enlace del cliente 5 s, restablecer y medir con reloj monotónico.
- **Responsable/evidencia:** Go y clientes; histograma y capturas de estado.
- **Dependencias:** B17, E43, G61, I73.

### NFR-REC-003 — Restauración durable

- **Tipo/origen:** Objetivo interno propuesto — pendiente de aprobación.
- **Enunciado/criterio:** copia/restauración documentada de PostgreSQL para `match` y `player`; objetivo **RPO ≤ 15 min, RTO ≤ 30 min** en ensayo. No promete restaurar cada frame ni partida activa tras caída de Go.
- **Prueba:** crear datos, copiar, simular pérdida del volumen de ensayo, restaurar y verificar integridad/tiempos.
- **Responsable/evidencia:** infraestructura/PostgreSQL y dueños de datos; runbook, marcas temporales y consultas.
- **Dependencias:** E41–E42, F55, H66, I73; revisar objetivos tras A05.

## Datos y contratos

### NFR-DAT-001 — Ownership y transacción

- **Tipo/origen:** Arquitectura aceptada ([AGENTS.md](../../AGENTS.md), [ARCHITECTURE.md](../../ARCHITECTURE.md)).
- **Enunciado/criterio:** Go escribe solo `match`, Rust escribe `player`; operación económica/settlement queda aplicada entera o no aplicada tras fallo a mitad de transacción.
- **Prueba:** revisar permisos/rutas SQL e inyectar fallo previo al commit Rust.
- **Responsable/evidencia:** Go, Rust y PostgreSQL; permisos, prueba de rollback y tablas resultantes.
- **Dependencias:** E41–E42, F52, F54–F55.

### NFR-DAT-002 — Settlement idempotente

- **Tipo/origen:** Arquitectura aceptada ([ADR 0001](../adr/0001-service-boundaries.md)).
- **Enunciado/criterio:** Rust deduplica por identificador estable; **10** solicitudes idénticas concurrentes y un timeout tras commit producen una sola modificación durable y respuestas coherentes. El resultado viene de Go, no del cliente.
- **Prueba:** solicitudes concurrentes, fallo entre commit/respuesta y comparación antes/después.
- **Responsable/evidencia:** Go para resultado/clave; Rust para transacción; pruebas y datos PostgreSQL.
- **Dependencias:** E43, F52–F54, J77. Diez es tamaño de prueba, no capacidad exigida por profesor.

### NFR-CMP-001 — Evolución de contratos

- **Tipo/origen:** Arquitectura aceptada ([AGENTS.md](../../AGENTS.md)).
- **Enunciado/criterio:** cambio incompatible de realtime/gRPC requiere versión/migración; cliente incompatible recibe rechazo explícito. Una versión compatible anterior sigue funcionando durante la transición definida.
- **Prueba:** matriz de compatibilidad y checks `contracts`, `go`, `rust` con versiones diferentes.
- **Responsable/evidencia:** Go, Rust y clientes; matriz, resultados y CI.
- **Dependencias:** E43 define mensajes y ventana exacta. Este NFR no congela los borradores.

## Observabilidad, seguridad y despliegue

### NFR-OBS-001 — Salud por instancia

- **Tipo/origen:** C22 confirmado por salud; [README.md](../../README.md), [ci-cd.md](../ci-cd.md).
- **Enunciado/criterio:** health/readiness reflejan capacidad real por instancia; Envoy excluye réplica Rust no saludable y Go distingue degradación Player/Profile de incapacidad para servir partidas.
- **Prueba:** detener una/todas las réplicas, consultar probes/Envoy y ejecutar una operación real.
- **Responsable/evidencia:** Go, Rust, Envoy; respuestas, estado de Envoy y operación sintética.
- **Dependencias:** E40, J78, H67–H69; semántica exacta de readiness se diseña en E40.

### NFR-OBS-002 — Métricas y logs

- **Tipo/origen:** C22 confirmado por observabilidad; stack Prometheus/Grafana del README.
- **Enunciado/criterio:** registrar conexiones/partidas, latencias/errores RPC, rechazos, circuito, degradación y settlement con IDs de correlación; escenarios de desconexión, caída Rust e idempotencia reconstruibles sin secretos en logs.
- **Prueba:** ejecutar NFR-CON-001, AVL-001 y DAT-002; consultar métricas/logs e inspeccionar secretos.
- **Responsable/evidencia:** Go, Rust e infraestructura; consultas, gráficos y logs redactados.
- **Dependencias:** H67–H69, I73; nombres de métricas se fijarán al instrumentar.

### NFR-SEC-001 — Identidad y confianza

- **Tipo/origen:** Arquitectura aceptada ([AGENTS.md](../../AGENTS.md)).
- **Enunciado/criterio:** Go valida identidad/intención/reconexión; posición, vidas, pickups, ranking, premio y saldo declarados por cliente no alteran estado. Rust acepta settlement solo de flujo servidor autorizado.
- **Prueba:** identidad ausente/ajena y mensajes manipulados; comparar Go y PostgreSQL antes/después.
- **Responsable/evidencia:** Go y Rust; rechazos, pruebas negativas y estado persistente.
- **Dependencias:** F48, E43, F52–F54; mecanismo de identidad se define luego.

### NFR-SEC-002 — Configuración y secretos

- **Tipo/origen:** Arquitectura aceptada ([AGENTS.md](../../AGENTS.md), [ci-cd.md](../ci-cd.md)).
- **Enunciado/criterio:** direcciones, credenciales y límites se configuran fuera del código; ningún secreto o IP fija de Rust en Git/logs. Un mismo artefacto arranca en dos configuraciones válidas sin reconstrucción.
- **Prueba:** dos arranques Compose con configuración distinta y revisión de diff/logs.
- **Responsable/evidencia:** Go, Rust e infraestructura; `.env.example`, configuración y revisión.
- **Dependencias:** D31, H62–H66.

### NFR-DEP-001 — Despliegue y rollback reproducibles

- **Tipo/origen:** C22 confirmado por despliegue; [ci-cd.md](../ci-cd.md).
- **Enunciado/criterio:** una revisión identificable se despliega con `compose.yml`, configuración externa y migraciones controladas; dos instalaciones limpias quedan saludables. Un despliegue fallido vuelve a revisión compatible y supera probes; CD al laboratorio sigue pendiente.
- **Prueba:** dos instalaciones y un rollback de ensayo, con versión de imágenes, migraciones y datos registrados.
- **Responsable/evidencia:** infraestructura/CI, Go y Rust; commit/digests, `docker compose config`, smoke test y runbook ejecutado.
- **Dependencias:** A05, E42, H62–H66, I73.

## Cobertura y decisiones pendientes

| Criterio C22 | Requisitos |
| --- | --- |
| Concurrencia y desconexión | CON-001/002, CAP-001/002 |
| Red y rendimiento | NET-001, CAP-001/002 |
| Caída de Rust y resiliencia | AVL-001/002, RES-001/002/003/004 |
| Recuperación e integridad | REC-001/002/003, DAT-001/002 |
| Salud y observabilidad | OBS-001/002 |
| Seguridad, despliegue y compatibilidad | SEC-001/002, DEP-001, CMP-001 |

En la tabla los códigos abreviados llevan prefijo `NFR-`. B16–B17, E43, E38–E40 y A05/D31 siguen abiertos. La arquitectura actual pone Envoy delante de Rust y concentra retry/circuit breaker en Go. Si J78/Trello contradice el reparto, se documenta la discrepancia y se resuelve mediante ADR antes de cambiarlo. **Los objetivos internos permanecen pendientes de aprobación del equipo.**
