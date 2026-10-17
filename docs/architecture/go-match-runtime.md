# D28 — Runtime autoritativo de Go, realtime y concurrencia

Este diseño desarrolla el [modelo C25](domain-model.md) y [ADR 0003](../adr/0003-primary-distributed-architecture.md) bajo las reglas de [B16](../product/authoritative-race-rules.md), [B17](../product/multiplayer-room-lifecycle.md) y [C22](../requirements/non-functional-requirements.md). Define comportamiento del Match Service; no implementa código ni cierra el contrato E43. La carrera viva existe en memoria de Go, con Go como única autoridad de tiempo, movimiento, objetos, estados y resultado.

## Fronteras y ritmos

| Tema | Decisión |
| --- | --- |
| Transporte público | **WebSocket bidireccional** cliente↔Go para sala/carrera viva. HTTP conserva operaciones request/response apropiadas. Web y Python usan la misma frontera pública Go; E43 define URLs, subprotocolos, envelopes, mensajes y payloads. |
| Tick | **20 Hz: un paso lógico de 50 ms por carrera**, con reloj monotónico/temporizadores del servidor. El frame rate y reloj del navegador no ordenan la carrera. Si el proceso se retrasa, Go mide el retraso y aplica una política de recuperación acotada en implementación, sin aceptar tiempo suministrado por cliente ni prometer exactitud física del planificador. |
| Snapshots | **10 Hz: cada segundo tick / 100 ms lógicos.** Contienen estado autoritativo recuperable; eventos semánticos pueden salir entre snapshots. Un snapshot posterior permite recuperar estado aunque se haya omitido uno anterior. |
| Inputs | El cliente puede enviar hasta **aproximadamente 20 Hz**. Go valida sesión/participación, carrera/estado, secuencia monotónica y rangos, conserva la última intención válida por participante y aplica intención neutral cuando no hay control válido. `jumpSeq` u otra acción discreta se consume una sola vez aunque se repita el paquete. La forma final de secuencias y límites va a E43/B16. |
| Estado de sala | `RoomLoop` mantiene LOBBY→COUNTDOWN→RACING→RESULTS→LOBBY/CLOSED. El countdown común de B17, joins solo en LOBBY, roster/curso/reglas congelados en RACING y `ready` confirmado por Go se respetan. |

## Topología de ejecución

```text
Server context
└─ RoomManager: registry pequeño (sync.RWMutex), creación/búsqueda/cierre
   ├─ RoomLoop A: canal de comandos + ticker de 50 ms; única escritora de A
   │  ├─ ConnectionReader A1 → intención/comando → RoomLoop A
   │  ├─ ConnectionWriter A1 ← cola acotada ← publicación de RoomLoop A
   │  └─ ... una pareja reader/writer por WebSocket
   └─ RoomLoop B: estado independiente

Profile/Settlement workers: pool acotado separado → puerto → Envoy → Rust
```

Hay **una goroutine RoomLoop por sala activa**. Es la única que modifica `Room`, `Race`, `ActivePlayer`, `RaceParticipant`, `PickupState`, persecuciones, relojes y resultados de esa sala. Los comandos entran por un canal acotado y se procesan en orden del loop; no se ponen mutex en entidades dentro del tick. `RoomManager` protege con `sync.RWMutex` solo el registro de referencias y su vida, sin usar ese lock para leer/escribir el interior de una sala. No se crea una goroutine por jugador, pickup, obstáculo o pulpo.

Cada WebSocket tiene un `ConnectionReader` y un `ConnectionWriter` con contexto de conexión y cola de salida acotada. El reader decodifica, limita y verifica sesión básica, después entrega intención al loop; nunca cambia directamente la carrera. El loop realiza la validación autoritativa de estado/secuencia antes de aplicar. El writer es el único que escribe al socket. `Publisher` puede ser parte del loop o un helper sin estado propio: produce snapshots y eventos desde una vista coherente del loop y los encola sin esperar a la red. Tampoco se hace I/O de PostgreSQL dentro del tick.

El contexto raíz cancela admisiones y dirige el cierre ordenado de RoomManager, loops, conexiones y workers. El contexto de sala abarca su loop; el de conexión acaba al desconectar/reemplazar el socket; cada trabajo de perfil/settlement tiene deadline propio. Los canales/colas son acotados para que un cliente o dependencia lenta no acumule memoria sin límite. La implementación definirá tamaños y política de cierre medidos conforme a C22.

## Orden lógico de un tick

1. Drenar los comandos disponibles con trabajo acotado; validar pertenencia/estado/secuencia y dejar la **última intención válida** por participante. Procesar también expiraciones de timers de sala.
2. Avanzar giro, velocidad, boost, salto y posición según B16 con el paso lógico de Go.
3. Resolver colisiones, daño y protección, sin aceptar vidas o posición declaradas por cliente.
4. Calcular candidatos a residuos/salvavidas y adjudicar cada objeto una vez con orden determinista de B16; actualizar conteo individual y objetivo de agua compartido.
5. Actualizar la persecución individual del pulpo y sus efectos de daño/protección.
6. Detectar meta, estados terminales y vencimiento de reentrada/fin global. El primer `finished` inicia el plazo global de **45 s**; cerrar cuando todos están terminales o vence ese plazo. Si vence, activos/reconectando pasan a `dnf`. Si todos terminan sin primer `finished`, cerrar por terminalidad.
7. Derivar y encolar eventos semánticos del estado ya resuelto. Cada segundo tick construir y publicar snapshot completo y recuperable. El resultado global se construye en Go y se anuncia separado de la posterior confirmación de Rust.

Los eventos de un tick se ordenan respecto de su snapshot usando tiempo/tick del servidor; E43 fijará la representación pública. El loop no espera a clientes ni al perfil antes de avanzar al siguiente tick. Si una fase excede presupuesto, se registra duración/retraso para diagnóstico y se evita que el drenaje infinito de comandos impida simular.

## Desconexión, backpressure y resultado

Una desconexión **accidental durante RACING** crea una ventana de **15 s** para el participante ya admitido. El loop lo conserva, aplica entrada neutral y sigue simulando para todos; no pausa ni devuelve pickups. La misma identidad/sesión válida reata una conexión y recibe **de inmediato un snapshot completo** desde Go, sin reproducir el historial de eventos. Una identidad distinta no secuestra la plaza. Si el participante llega a meta o queda descalificado mientras está ausente, conserva ese terminal; si vence la ventana todavía activo, queda `left`. Una salida voluntaria queda `left` inmediata. Antes de RACING rigen las reglas de B17, sin importar la ventana de reentrada de carrera.

Para un cliente lento, el writer puede **reemplazar o descartar snapshots obsoletos** y entregar el estado más reciente. Eventos críticos, errores y resultado no se descartan silenciosamente: si su entrega no progresa dentro del límite de salida, se cierra esa conexión y se registra el motivo. Si aún rige la ventana de reentrada, una conexión válida recupera la verdad mediante snapshot; E43 definirá el acceso al resultado confirmado cuando la sala ya está en RESULTS. El cierre de un socket no bloquea otros sockets ni el RoomLoop. E43 precisará qué mensajes requieren entrega/reconsulta y su compatibilidad, sin convertir los eventos transitorios en un libro durable.

Go calcula ranking, estados terminales, materiales acreditables y resultado conforme B16: solo `finished` obtiene puesto y sus materiales confirmados; `disqualified`, `left` y `dnf` reciben cero. El cierre global no espera la confirmación de Rust. El resultado confirmado y el settlement pendiente/confirmado son estados distintos; la UI no muestra saldo ficticio.

## Rust fuera del tick y observabilidad

Las consultas de perfil y solicitudes de settlement se despachan a **workers acotados separados** con contexto/deadline y aislamiento de carga. Nunca hay una RPC Go→Envoy→Rust dentro del tick. La preparación que exige perfil válido solo se confirma si la consulta de perfil se completó; una caída de Rust degrada perfil/economía/settlement, pero **la carrera activa y su resultado siguen**. Las decisiones concretas de circuit breaker, retry seguro y política de reintento quedan en E38–E40/J77/F52–F54 según C22; la idempotencia de settlement corresponde a Rust. Go no escribe datos `player` directamente.

Se instrumentarán conceptualmente IDs de `roomId`, `raceId` y `playerId`/correlación, duración y retraso del tick, profundidad y descartes de colas, conexiones/reentradas, errores y latencias de Rust, modo degradado y settlement pendiente. Los nombres de métricas/logs y umbrales de alerta se fijan al implementar, evitando secretos en registros.

## Límites de esta decisión

E43 cerrará rutas, identidad pública, formatos, versiones y payloads; los [eventos](../../contracts/realtime/events.md), el [proto](../../proto/player_profile.proto) y los [tipos web](../../apps/web/docs/backend/contracts-proposed.ts) siguen siendo borradores. E41 diseñará tablas/índices e historia persistente: no se persiste cada tick. Este diseño no promete supervivencia de una carrera tras caída del proceso Go ni define un broker externo. Las pruebas de carga, reconexión, backpressure, degradación y settlement se ejecutarán en las tareas de implementación y validación de C22.
