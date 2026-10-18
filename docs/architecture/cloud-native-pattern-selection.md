# E37 — Selección y justificación de patrones cloud-native

Este documento selecciona los patrones de [E36](cloud-native-pattern-catalog.md) que **sí se implementarán y demostrarán** en Compunube Proyecto 1. La selección evita contar mecanismos auxiliares dos veces y prioriza evidencia observable en el laboratorio.

## Selección final

Se seleccionan **ocho patrones**:

1. Microservicios.
2. API Gateway.
3. Database per Service.
4. Ambassador.
5. Circuit Breaker.
6. Bulkhead.
7. Retry.
8. Timeout + Fallback, tratados como una misma decisión de estabilidad porque el material base los presenta juntos y porque su prueba comparte el escenario de dependencia degradada.

Load Balancing y Health Monitoring se evalúan explícitamente como mecanismos necesarios para Ambassador/failover, pero no aumentan artificialmente el conteo.

## 1. Microservicios

**Problema.** La simulación autoritativa de carrera y la economía/perfil tienen ciclos de vida, carga y tolerancia a fallos distintos. Un único proceso acoplaría el tick de partida con PostgreSQL y con operaciones económicas.

**Implementación.**
- Go Match Service: salas, WebSocket, tick, ranking y resultado.
- Rust Player/Profile Service: perfil, catálogo, economía y settlement.
- contratos explícitos E43;
- despliegue y escalado separados.

**Componente responsable.** Go + Rust + Compose/despliegue.

**Evidencia esperada.**
- procesos/containers distintos;
- gRPC interno entre servicios;
- repositorios/código separados;
- Rust puede fallar sin detener una carrera Go ya activa.

**Prueba de demostración.**
1. iniciar una carrera;
2. detener todas las réplicas Rust;
3. continuar inputs/tick/resultados Go;
4. mostrar perfil/economía como degradados;
5. recuperar Rust sin reconstruir la carrera.

**Trade-off.** Más puntos de fallo, latencia de red, contratos, observabilidad y operación distribuida.

## 2. API Gateway

**Problema.** Web y Python no deben conocer Envoy, Rust, PostgreSQL ni topología interna.

**Implementación.**
- Go es la frontera pública;
- WebSocket E43 para realtime;
- HTTP/OpenAPI E45 para request/response;
- Go valida identidad, pertenencia y autoridad antes de delegar.

**Componente responsable.** Go Match Service.

**Evidencia esperada.**
- clientes se conectan solo a Go;
- no existen rutas públicas directas a Rust/PostgreSQL;
- Go mapea errores internos a contratos públicos.

**Prueba de demostración.**
- realizar desde ambos clientes una operación que requiera Rust y demostrar mediante logs/trazas que el cliente habla con Go y Go con Envoy/Rust.

**Trade-off.** Go se vuelve componente de alta criticidad y concentra tráfico público; debe mantenerse pequeño, observable y escalable.

## 3. Database per Service

**Problema.** Evitar que Go y Rust se acoplen modificando las mismas tablas o esquemas privados.

**Implementación.**
- ownership lógico `match` → Go;
- ownership lógico `player` → Rust;
- sin claves foráneas entre schemas;
- roles runtime separados cuando E42/H62 materialicen grants.

**Componente responsable.** PostgreSQL + repositorios Go/Rust.

**Evidencia esperada.**
- migraciones separadas por contexto;
- credencial Go no puede hacer DML en `player`;
- credencial Rust no puede hacer DML en `match`;
- comunicación cruzada por contrato, no joins directos.

**Prueba de demostración.**
- ejecutar una escritura válida con cada rol y luego intentar una escritura en el schema ajeno; PostgreSQL debe rechazarla.

**Trade-off.** Se pierden joins/transacciones ACID directas entre servicios. En el laboratorio ambos contexts comparten una instancia física PostgreSQL, por lo que la separación es lógica y de permisos, no dos servidores de base de datos.

## 4. Ambassador

**Problema.** Go no debe depender de una réplica Rust concreta ni implementar localización/balanceo/failover por dirección hardcodeada.

**Implementación.**
- Envoy delante de Rust;
- al menos dos réplicas Rust;
- Go usa un único destino interno configurado;
- Envoy distribuye hacia instancias saludables.

**Componente responsable.** Envoy + J77/J78.

**Evidencia esperada.**
- dos upstream Rust;
- un solo endpoint de dependencia para Go;
- métricas/admin de Envoy muestran miembros del cluster y estado;
- tráfico llega a más de una réplica.

**Prueba de demostración.**
1. ejecutar varias consultas de perfil y observar reparto;
2. detener Rust #1;
3. verificar que Envoy la excluye;
4. nuevas operaciones usan Rust #2;
5. recuperar Rust #1 y comprobar reincorporación.

**Trade-off.** Salto adicional de red, configuración/operación de proxy y nueva dependencia de infraestructura.

### Evaluación explícita de Load Balancing

**Load Balancing se implementa**, pero en E37 se considera mecanismo del Ambassador, no patrón adicional para el conteo. La evidencia será el reparto y failover entre Rust #1/#2 mediante Envoy.

## 5. Circuit Breaker

**Problema.** Cuando Rust o PostgreSQL están fallando, insistir con todas las llamadas consumiría workers, aumentaría latencia y podría degradar Go.

**Implementación prevista.**
- Circuit Breaker en el adaptador Go→PlayerProfilePort/J77;
- fallos elegibles contabilizados en ventana;
- estados closed/open/half-open;
- mientras está open, fallo rápido para operaciones dependientes de perfil;
- carrera activa continúa.

Los umbrales concretos pertenecen a E38 y deben ser configurables/medibles.

**Componente responsable.** Go, alrededor de llamadas gRPC hacia Rust.

**Evidencia esperada.**
- estado/contador observable;
- latencia de fallo disminuye al abrirse el circuito;
- no se ejecutan RPC innecesarias mientras está abierto;
- recuperación mediante probes half-open.

**Prueba de demostración.**
1. detener todas las réplicas Rust;
2. generar llamadas de perfil hasta abrir circuito;
3. medir fallo rápido posterior;
4. mantener una carrera activa;
5. recuperar Rust y observar half-open→closed.

**Trade-off.** Umbrales demasiado agresivos producen falsos positivos; demasiado laxos permiten cascada de fallos.

## 6. Bulkhead

**Problema.** Una dependencia lenta, un cliente o una sala no debe consumir todas las goroutines/colas/conexiones y bloquear a los demás.

**Implementación prevista.**
- RoomLoop independiente por sala;
- colas WebSocket acotadas;
- pool separado/acotado para profile/settlement;
- límites de trabajo por tick;
- rechazo/backpressure al llenarse una frontera.

**Componente responsable.** Go runtime, concretado en E39/F50.

**Evidencia esperada.**
- límites configurados;
- métricas de profundidad/rechazo;
- saturación de profile workers no bloquea RoomLoops;
- un cliente lento puede perder/cerrar su conexión sin congelar a los demás.

**Prueba de demostración.**
- saturar deliberadamente operaciones hacia Rust mientras una carrera corre y medir que tick/snapshots de otra sala continúan dentro del comportamiento esperado.

**Trade-off.** Recursos fragmentados y capacidad ociosa; límites pequeños pueden rechazar carga sana.

## 7. Retry

**Problema.** Fallos transitorios de red o reinicio de una réplica no deberían convertir automáticamente una operación segura en fallo definitivo.

**Implementación prevista.**
- número limitado de intentos;
- backoff;
- deadlines globales;
- solo operaciones seguras/idempotentes;
- mutaciones económicas reutilizan el mismo `requestId`;
- settlement reutiliza `(raceId, playerId)`.

**Componente responsable.** Go/J77; Rust garantiza idempotencia durable.

**Evidencia esperada.**
- logs muestran intentos limitados y mismo identificador;
- un retry después de commit no duplica recursos;
- no se reintenta indefinidamente.

**Prueba de demostración.**
1. provocar pérdida/fallo temporal alrededor de una operación idempotente;
2. repetir con la misma clave;
3. verificar una sola modificación en PostgreSQL;
4. comprobar respuesta coherente.

**Trade-off.** Retry puede amplificar una sobrecarga y crear tormentas; debe combinarse con timeout, backoff y Circuit Breaker.

## 8. Timeout + Fallback

### Timeout

**Problema.** Una RPC lenta no puede bloquear indefinidamente workers o preparación de sala.

**Implementación prevista.**
- `context.Context`/deadline explícito por llamada Go→Rust;
- timeout menor que el presupuesto de la operación que la contiene;
- timeout de perfil fuera del tick; jamás bloquear tick esperando Rust.

### Fallback

**Problema.** Una dependencia opcional para la carrera puede estar indisponible sin que el sistema invente datos o destruya estado válido.

**Implementación prevista.**
- carrera activa continúa sin Rust;
- resultado Go permanece autoritativo;
- settlement queda pendiente;
- perfil/economía se marcan temporalmente indisponibles;
- no se fabrican saldos, catálogo ni premios;
- antes de una carrera, si el perfil requerido no puede validarse, ready no se confirma.

**Componente responsable.** Go, concretado en E38.

**Evidencia esperada.**
- deadline observable;
- respuesta degradada explícita;
- resultado de carrera permanece visible con settlement pendiente;
- recuperación posterior confirma el perfil.

**Prueba de demostración.**
- introducir latencia/fallo en Rust; comprobar timeout y modo degradado mientras el RoomLoop sigue; restaurar Rust y completar settlement seguro.

**Trade-off.** Timeout demasiado corto causa fallos falsos; demasiado largo consume recursos. Un fallback mal diseñado puede ocultar fallos o presentar datos incorrectos, por lo que Compunube prefiere indisponibilidad explícita antes que estado ficticio.

## Evaluación explícita de Health Monitoring

Health Monitoring **se implementa y demuestra**, pero no se cuenta como noveno patrón porque E36 no lo identificó como entrada autónoma del catálogo académico usado.

E40 debe definir al menos:

- Go health/liveness/readiness;
- Rust por instancia;
- PostgreSQL;
- Envoy/upstreams;
- criterios healthy/unhealthy;
- Prometheus/Grafana para observación.

**Prueba:** detener una réplica Rust, observar health negativo y exclusión del pool; las demás permanecen saludables y reciben tráfico.

## Matriz resumida de evidencia

| Patrón | Evidencia principal | Prueba clave | Tarea de implementación/diseño |
| --- | --- | --- | --- |
| Microservicios | Go/Rust separados | caer Rust sin detener carrera | D28, D29, F46/F47 |
| API Gateway | clientes solo hablan con Go | web/Python→Go→Rust | E45, F46, G57/G58 |
| Database per Service | roles/schemas por owner | DML cruzado rechazado | E41, E42, H62 |
| Ambassador | Envoy + 2 Rust | balanceo/failover | J77, J78 |
| Circuit Breaker | estados/latencia de fallo | open→half-open→closed | E38, J77 |
| Bulkhead | pools/colas acotados | saturación parcial aislada | E39, F50 |
| Retry | mismos IDs, intentos limitados | retry sin doble efecto | E38, J77, F52/F54 |
| Timeout + Fallback | deadline + modo degradado | Rust lento/caído sin destruir carrera | E38, D28 |

## Dependencias inmediatas que E37 desbloquea

Con esta selección quedan justificadas y pueden avanzar:

- **E38:** resiliencia, Circuit Breaker, Retry, Timeout y Fallback;
- **E39:** Bulkhead;
- **E40:** health checks que alimentan Ambassador/load balancing/failover;
- **J77:** Adapter/puerto gRPC y políticas de resiliencia;
- **J78:** Ambassador, load balancing y failover;
- **E42/H62:** enforcement de Database per Service mediante roles;
- **E45:** frontera pública/API Gateway.

## Patrones deliberadamente no seleccionados

Aunque E36 los reconoce como válidos en la literatura, no se comprometen para la entrega: Saga, CQRS, Event-Driven Architecture con broker, Serverless, Strangler Fig, Service Mesh, Sidecar, Service Discovery dinámico, Factory, Command y Observer/Pub-Sub como patrón contado.

Adapter, Repository, Command y Observer pueden aparecer naturalmente en el código, pero no forman parte de los ocho patrones que el equipo promete demostrar como evidencia cloud-native principal. Esto mantiene el alcance verificable.
