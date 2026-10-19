# E38 — Resiliencia, failover y modo degradado

Diseño para el puerto Go→Player/Profile seleccionado en [E37](cloud-native-pattern-selection.md), sin implementar todavía J77/J78. Sigue el runtime sin RPC en el tick de [D28](go-match-runtime.md), la replicabilidad de [D29](rust-player-profile-service.md), el estado durable de [E41](postgresql-schema.md), los contratos [E43](../../proto/README.md) y los criterios [C22](../requirements/non-functional-requirements.md). La fuente académica del catálogo E36/E37 es *Patrones arquitectónicos y de diseño para aplicaciones nativas en la nube* (Patiño, Beltrán y Rivera, 2026), secciones de Circuit Breaker, Bulkhead, Retry, Timeout/Fallback y Ambassador.

## Frontera y ownership del failover

```text
Go RoomLoop ──resultado/intención──> worker fuera del tick
                                  └─> PlayerProfilePort / J77
                                      ├─ deadline total + cancelación
                                      ├─ Circuit Breaker lógico + clasificación
                                      ├─ retry seguro y backoff dentro del deadline
                                      └─> Envoy (único endpoint configurado)
                                           ├─ health/ROUND_ROBIN ──> Rust #1 ─┐
                                           └─ health/ROUND_ROBIN ──> Rust #2 ─┴─> PostgreSQL `player`
Go `match` ──resultado/settlement_delivery──> PostgreSQL `match`
```

Go conoce **un destino lógico** de Player/Profile, Envoy; no mantiene IPs ni circuitos por réplica. Envoy excluye/reincorpora instancias según health y distribuye entre las sanas. Go decide el deadline, los reintentos de aplicación y el Circuit Breaker de esa dependencia lógica. Envoy no recibe una segunda política agresiva de retry. Un fallo transitorio de Rust #1 puede resolverse al enviar un intento posterior a Rust #2, sin que Go elija la instancia. Si Envoy mismo falla, el destino lógico está indisponible para Go aunque Rust siga vivo.

## Presupuesto, retry y clasificación

**Objetivos internos propuestos — pendientes de aprobación; todos configurables.** El `context.Context` de la petición/trabajo determina cancelación y límite superior. Para cada operación Go fija un deadline total `min(deadline del padre, ahora + presupuesto configurado)`, propagado por gRPC a través de Envoy y Rust. Los intentos, backoff y trabajo de respuesta caben en ese mismo presupuesto; no se reinicia el reloj por retry. Un intento cancelado libera worker/conexión. Ninguna llamada ni espera por backoff ocurre dentro del RoomLoop.

| RPC / clase E43 | Deadline total inicial | Retry automático | Clave y fallback |
| --- | --- | --- | --- |
| `GetProfile` | ≤ **750 ms**, NFR-RES-003 propuesto | Máximo **1** retry ante fallo transitorio elegible y tiempo restante | Lectura; si falla, perfil no confirmado y `ready` no avanza. Carrera activa sigue. |
| `GetCatalog` | Baseline **750 ms**, objetivo interno propuesto pendiente de aprobación | Máximo **1** retry elegible como lectura, con el mismo límite total | Lectura; catálogo indisponible explícito, sin inventar versión/precios. |
| `BuyItem`, `CraftItem`, `ExchangeMaterials`, `EquipItem`, `SetAppearance` | Baseline **2 s**, objetivo interno propuesto pendiente de aprobación | **0** hasta verificar deduplicación; después, solo retry elegible con el mismo `(player_id, request_id)` y presupuesto total | Nunca anticipar saldo/equipo. Timeout posterior a commit deja resultado incierto hasta replay/consulta segura. |
| `SettleRace` | ≤ **2 s**, NFR-RES-003 propuesto | **0** hasta demostrar idempotencia durable con fallo tras commit; luego solo retry elegible con el mismo `(race_id, player_id)` y huella | Resultado Go inmutable; entrega `pending` hasta confirmación Rust. |

Backoff recomendado: **exponencial con full jitter**, objetivo interno propuesto pendiente de aprobación: base **50 ms**, tope **200 ms**, parámetros configurables. Para el retry número `n` (primero `n=1`), esperar un valor aleatorio uniforme en `[0, min(200 ms, 50 ms × 2^(n−1))]`, únicamente si queda tiempo útil para otro intento. Las lecturas tienen como máximo un retry; el tope evita crecimiento si más adelante se autoriza otra política para mutaciones verificadas. No se reintenta por una respuesta lenta que ya agotó el deadline total. C22 conserva el presupuesto propuesto de `GetProfile` y `SettleRace`; los presupuestos de catálogo/mutaciones aquí son nuevos baselines internos, no requisitos docentes.

| Resultado del puerto gRPC E43 | Clasificación y acción |
| --- | --- |
| Rechazo de negocio en response gRPC `OK` (`MUTATION_REJECTION_*`, `SETTLEMENT_REJECTION_*`) | **Determinista**: devolver rechazo seguro; no retry, no sumar fallo al circuito. Conflicto de idempotencia exige investigación, nunca otra clave automática. |
| `INVALID_ARGUMENT`, `NOT_FOUND` y errores de versión/validación | **No retryable** para la misma solicitud; corregir datos/contrato. No abrir circuito por error del llamador. |
| `UNAVAILABLE`, conexión rechazada, pérdida de upstream, `DEADLINE_EXCEEDED` por dependencia | **Transitorio o sistémico**: contar un fallo lógico tras agotar intentos permitidos; retry solo si la clase de operación lo admite y queda deadline. En mutación, timeout puede significar commit aplicado. |
| `RESOURCE_EXHAUSTED` | **Saturación sistémica**: contar fallo lógico, aplicar backpressure; no retry inmediato que amplifique carga. Un nuevo intento posterior requiere capacidad y política segura. |
| `INTERNAL` | **Fallo sistémico**: contar y observar; no retry automático sin evidencia de que fue transitorio e idempotencia probada. |
| `UNIMPLEMENTED`, `PERMISSION_DENIED`, `UNAUTHENTICATED`, esquema/credenciales incompatibles | **Fatal/configuración**: alerta y rechazo explícito; no retry automático ni usar el circuito como sustituto de corregir configuración. |
| Cancelación del cliente o del proceso Go | Cancelar trabajo; no imputar fallo a Rust ni abrir circuito. Para operación mutable ya enviada, conservar incertidumbre hasta reconciliación idempotente. |

La política de retry se aplica a **la llamada lógica**, no a cada instancia: el circuito registra un éxito o fallo final una vez por operación, tras sus intentos. El conteo no incluye rechazos deterministas ni cancelaciones del cliente. Errores de infraestructura persistentes pueden abrir el circuito; errores de configuración permanecen visibles como incidentes de configuración. No se reintenta una operación mutable con nueva clave para «resolver» un timeout.

## Circuit Breaker lógico

Un solo circuito en Go/J77 protege Player/Profile. **Objetivo interno propuesto — pendiente de aprobación:** en `closed`, abrir tras **5 fallos lógicos consecutivos** elegibles; permanecer `open` **10 s** y fallar rápido las operaciones dependientes; al expirar, `half-open` permite **1 sonda** simultánea. Éxito de esa sonda → `closed` y contador a cero; fallo elegible → `open` por otra ventana. Las demás solicitudes en `half-open` reciben indisponibilidad controlada. Umbral, ventana, duración y sondas se configuran/observan; los valores provienen de NFR-RES-003, no del profesor. Un éxito real en `closed` reinicia la racha de fallos.

Mientras está `open`, Go no emite RPC normales a Rust. La sonda debe ser una consulta segura como `GetProfile`/`GetCatalog`, no un settlement ni una compra; un resultado de negocio determinista que prueba comunicación sana no debe contarse como fallo transitorio. Una sonda exitosa prueba la ruta lógica disponible, no garantiza que todas las réplicas o PostgreSQL estén perfectos. E40 define la salud por instancia y Envoy; no se sustituye por el circuito.

## Matriz de fallos y modo degradado

| Escenario | Go / carrera viva | Perfil, economía y settlement | Recuperación |
| --- | --- | --- | --- |
| Rust #1 cae, Rust #2 sana | Tick/snapshots/resultados siguen. | Envoy excluye #1 y usa #2; una llamada en vuelo puede fallar y solo se reintenta según tabla. | Health de Envoy reincorpora #1 sana, sin reconfigurar Go. |
| Todas las Rust caen | Carrera activa continúa; no se crea autoridad Rust en Go. | `UNAVAILABLE`/circuito `open`; perfil y economía explícitamente indisponibles; no se confirma `ready`; settlement `pending`. | Circuito `half-open` tras ventana; al volver una ruta sana, cerrar y drenar pendientes gradualmente. |
| Envoy cae o agota timeout | Carrera activa continúa. | Destino lógico indisponible; mismo fallback/circuito, aunque réplicas estén sanas. | Restaurar Envoy; sonda segura y luego tráfico normal. |
| PostgreSQL cae | El RoomLoop no depende de DB por tick y la carrera viva puede seguir en memoria. | Rust debe quedar no-ready y no confirmar operaciones; Go bloquea nuevas acciones/admisiones que necesitan persistencia. Si `match` DB también está caída, un resultado no escrito **aún no es durable**. | Restaurar DB; verificar readiness/esquema y persistir resultado/entrega antes de prometer recuperación durable. |
| Respuesta perdida después de commit Rust | No se recalcula resultado ni ranking. | Resultado mutable incierto; settlement sigue `pending` en Go hasta confirmación. | Repetir con **misma clave/huella** solo tras probar deduplicación durable; Rust devuelve efecto coherente, nunca crédito duplicado. |
| Rechazo de negocio | Sin impacto en la carrera. | Respuesta determinista E43, sin retry ni apertura del circuito. | Usuario corrige intención; conflicto de clave se investiga. |

El fallback no fabrica un perfil/catálogo/saldo desde caché como verdad ni marca settlement `confirmed` antes de Rust. La frontera pública de Go informa indisponibilidad o resultado pendiente mediante el contrato apropiado: E43 ya define `PROFILE_UNAVAILABLE` para preparación y `race.ended.settlementState`; E45 definirá el mapeo HTTP de operaciones de perfil. El resultado Go permanece separado del crédito persistente. No se promete supervivencia de la carrera si cae el proceso Go.

## Recuperación y entrega pendiente

1. E40 hace que cada Rust indique `SERVING` solo si puede servir con PostgreSQL; Envoy excluye réplicas no sanas y reincorpora las recuperadas.
2. El circuito de Go pasa `open → half-open` tras su ventana y una sonda de lectura segura comprueba el endpoint lógico. Al éxito vuelve a `closed`; no fuerza el estado de Envoy por sí mismo.
3. Go reanuda nuevas consultas normales dentro de los límites Bulkhead de E39. No libera de golpe todas las solicitudes acumuladas; las solicitudes de perfil fallidas deben reintentarse desde una acción/consulta nueva del cliente, sin suponer que siguen válidas.
4. El worker de settlement lee `match.settlement_delivery` durable con `state=pending` y `next_attempt_at`, procesa a ritmo acotado, usa la misma clave `(race_id, player_id)` y confirma solo tras respuesta Rust. Si el resultado/entrega aún no pudo persistirse por caída de `match` DB, queda únicamente en memoria del proceso Go hasta poder escribirlo: no se lo presenta como duradero.
5. Fallos transitorios actualizan intento/siguiente oportunidad con espera y jitter; rechazo permanente o huella conflictiva pasa a `failed` para intervención. La cola RAM no es la fuente de recuperación. E41 define la tabla; F55/J77/F54 implementan el lado Go de la coordinación. La idempotencia y acreditación Rust real de F52 aún no se han validado.

El `route timeout` actual de Envoy es **3 s**, su `connect_timeout` **1 s** y no hay `retry_policy` en [`envoy.yaml`](../../infra/envoy/envoy.yaml). El timeout de ruta es scaffolding más amplio que los presupuestos de aplicación propuestos (750 ms/2 s). El deadline de Go manda cuando es menor; J77/J78 deberán validar propagación y evitar que una ruta/proxy corte antes de lo presupuestado. E38 no modifica Envoy ni Compose. La disponibilidad de Rust no sustituye permisos ni durabilidad de PostgreSQL.

## Evidencia de implementación futura

J77/J78/F52/F54/I73 deberán demostrar: un fallo final por llamada lógica, `closed → open → half-open → closed`, cero RPC ordinarias en `open`, deadlines liberando workers, retry de lectura acotado, timeout tras commit sin doble crédito, rechazo de negocio sin retry, caída de una y todas las Rust, caída de Envoy/DB, `settlement_delivery` pendiente/confirmado y carrera que progresa. Medir latencias, estado de circuito, intentos, error clasificado, perfil degradado y pendientes con IDs de correlación, sin secretos. Esta PR solo fija el diseño.
