# E36 — Catálogo de patrones cloud-native admitidos para el proyecto

Este documento fija el vocabulario que **Compunube Proyecto 1** utilizará al justificar patrones cloud-native. La fuente base proporcionada para E36 es el artículo **“Patrones arquitectónicos y de diseño para aplicaciones nativas en la nube”**, de Ángel Patiño, Ricardo Beltrán y Santiago Rivera (2026).

La regla aplicada es deliberadamente conservadora:

> Solo se contará como patrón del proyecto aquello que el material base nombra explícitamente como patrón arquitectónico o de diseño. Capacidades como load balancing, health checking, failover u observabilidad pueden ser requisitos o mecanismos de implementación, pero no se contarán como patrones adicionales salvo que estén asociadas a un patrón explícito del catálogo.

Esto evita inflar artificialmente la cantidad de patrones y mantiene la terminología alineada con el material académico usado por el equipo.

## Patrones arquitectónicos admitidos

| Patrón | Problema que resuelve | Encaje en Compunube | Demostrable en el proyecto | Decisión E36 |
| --- | --- | --- | --- | --- |
| **Microservicios** | Separar capacidades con ciclos de despliegue y escalado independientes. | Go Match Service y Rust Player/Profile Service con responsabilidades separadas. | Sí: procesos/containers separados y fallo parcial de Rust sin detener una carrera Go. | **Candidato fuerte** |
| **API Gateway** | Evitar que clientes conozcan la topología interna y centralizar la frontera pública. | Go es la única frontera pública para web/Python; Rust/gRPC/PostgreSQL son internos. | Sí: clientes solo consumen Go. | **Candidato fuerte** |
| **Service Discovery** | Localizar instancias cuyo endpoint puede cambiar. | Envoy conoce/selecciona réplicas Rust; Docker DNS aporta resolución local. | Parcial: el Compose actual usa nombres/endpoints conocidos; no existe un registro dinámico tipo Eureka. | **No contar en MVP** |
| **Database per Service** | Dar ownership exclusivo de datos a cada servicio y evitar acoplamiento por esquema compartido. | Ownership lógico `match` para Go y `player` para Rust dentro de PostgreSQL. | Sí, si E42/H62 materializan roles/grants separados. Es una variante lógica sobre una instancia física compartida. | **Candidato fuerte con matiz** |
| **Saga** | Coordinar una operación de negocio distribuida con varias transacciones locales y compensaciones. | El settlement Go→Rust no requiere una cadena de compensaciones entre varios servicios. | No hay proceso multi-servicio que justifique compensaciones. | **Descartado** |
| **CQRS** | Separar modelos de lectura y escritura cuando sus necesidades difieren sustancialmente. | No existen read/write models independientes ni almacenes separados para consultas. | No sin añadir complejidad artificial. | **Descartado** |
| **Event-Driven Architecture** | Desacoplar productores/consumidores mediante eventos asíncronos y un broker. | El realtime emite eventos, pero no existe broker ni integración asíncrona durable entre servicios. | No en el MVP actual. No confundir `race.event` con una EDA completa. | **Descartado** |
| **Serverless** | Ejecutar cargas event-driven/esporádicas sin gestionar servidores. | El stack objetivo es Go/Rust/PostgreSQL/Envoy en containers. | No forma parte de la infraestructura disponible. | **Descartado** |
| **Strangler Fig** | Migrar gradualmente un sistema heredado detrás de una fachada. | El proyecto no está sustituyendo un sistema legacy en producción. | No aplica. | **Descartado** |
| **Service Mesh** | Aplicar políticas de red uniformes mediante proxies + plano de control. | Hay Envoy, pero como Ambassador/load balancer único delante de Rust; no existe mesh con sidecars/plano de control. | No sin introducir infraestructura fuera del alcance. | **Descartado** |

## Patrones de diseño admitidos

### Estabilidad

| Patrón | Problema que resuelve | Encaje en Compunube | Demostrable | Decisión E36 |
| --- | --- | --- | --- | --- |
| **Circuit Breaker** | Detener llamadas repetidas a una dependencia degradada y evitar fallo en cascada. | Go protege llamadas Go→Envoy→Rust. | Sí: derribar/saturar Rust y observar circuito abierto + modo degradado. | **Candidato fuerte** |
| **Bulkhead** | Aislar recursos para que una dependencia/partida lenta no agote todo el proceso. | Worker pools/colas/límites separados para perfil/settlement y conexiones/rooms. | Sí mediante prueba de saturación. | **Candidato fuerte** |
| **Retry** | Repetir fallos transitorios de forma acotada. | Go reintenta operaciones seguras/idempotentes hacia Rust. | Sí: fallo temporal de una réplica + recuperación/failover. | **Candidato fuerte** |
| **Timeout** | Evitar esperas indefinidas a una dependencia. | Deadlines de context en RPC Go→Rust. | Sí: inducir demora y comprobar corte por deadline. | **Candidato fuerte** |
| **Fallback** | Mantener una funcionalidad reducida cuando una dependencia falla. | La carrera continúa aunque perfil/economía/settlement estén temporalmente indisponibles. | Sí: caída total de Rust durante una carrera. | **Candidato fuerte** |

### Contenedores

| Patrón | Problema que resuelve | Encaje en Compunube | Demostrable | Decisión E36 |
| --- | --- | --- | --- | --- |
| **Sidecar** | Añadir una función auxiliar desplegada junto a cada instancia principal. | No hay proxy/agente auxiliar por instancia Go/Rust. | No sin rediseñar despliegue. | **Descartado** |
| **Ambassador** | Encapsular localización, reintentos o distribución de llamadas hacia dependencias remotas. | Envoy representa a Rust frente a Go y distribuye llamadas entre réplicas Rust. | Sí: al menos dos réplicas, health/failover y reparto de tráfico. | **Candidato fuerte** |
| **Adapter** | Traducir interfaces incompatibles y ocultar detalles de integración. | `PlayerProfilePort` + adaptador gRPC en Go; adaptadores frontend traducen la frontera pública. | Sí mediante fake vs adaptador real y pruebas contractuales. | **Candidato fuerte** |

### Patrones clásicos aplicados

| Patrón | Problema que resuelve | Encaje en Compunube | Demostrable | Decisión E36 |
| --- | --- | --- | --- | --- |
| **Observer / Publish-Subscribe** | Notificar cambios a varios consumidores. | RoomLoop publica snapshots/eventos a conexiones suscritas; no hay broker externo. | Sí como Observer interno, no como arquitectura EDA. | **Candidato secundario** |
| **Command** | Encapsular solicitudes para poder validarlas, encolarlas y aplicar políticas. | Comandos al RoomLoop y operaciones remotas pueden representarse como intenciones/comandos. | Sí, pero aporta menos evidencia cloud-native que los patrones de resiliencia. | **Candidato secundario** |
| **Factory** | Desacoplar creación de implementaciones/configuración concreta. | Podría usarse para construir clientes/adaptadores configurados por entorno. | Posible, pero no es necesario para demostrar el objetivo cloud del proyecto. | **No priorizar** |
| **Repository** | Ocultar persistencia detrás de una interfaz de dominio. | D29/E41 definen repositorios para perfil, inventario, catálogo, settlement y persistencia Go. | Sí con implementación SQL intercambiable/mockeable. | **Candidato fuerte** |

## Load Balancing y Health Monitoring

Las tareas posteriores exigen evaluar explícitamente **Load Balancing** y **Health Monitoring**, pero el material base no los presenta como dos entradas autónomas del catálogo de patrones usado en sus Secciones III–IV.

Por ello E36 fija lo siguiente:

- **Load Balancing** se tratará como **mecanismo demostrable del patrón Ambassador** en este proyecto. Envoy distribuye llamadas entre réplicas Rust. No se contará una segunda vez como patrón independiente.
- **Health Monitoring** se tratará como **capacidad operativa necesaria para Ambassador/failover** y como tarea E40. No se contará dentro del mínimo de patrones de E37 salvo nueva evidencia docente que lo nombre expresamente como patrón.
- La arquitectura sí debe implementar ambos mecanismos porque son necesarios para J78/E40 y para demostrar tolerancia a fallos.

Esta clasificación no impide documentarlos ni probarlos; únicamente evita alterar el conteo académico.

## Patrones que sí pueden demostrarse con la infraestructura prevista

La infraestructura ya diseñada o planificada permite obtener evidencia clara de:

1. Microservicios.
2. API Gateway.
3. Database per Service, bajo ownership lógico y roles separados.
4. Ambassador.
5. Circuit Breaker.
6. Bulkhead.
7. Retry.
8. Timeout.
9. Fallback.
10. Adapter.
11. Repository.
12. Observer interno, si se desea como evidencia adicional.

E37 debe seleccionar **al menos cinco** entre estos, priorizando los que resuelven fallos reales del sistema y cuya prueba sea observable.

## Patrones que no deben introducirse solo para “cumplir”

No se añadirá infraestructura o complejidad únicamente para exhibir:

- Saga;
- CQRS;
- arquitectura dirigida por eventos con broker;
- Serverless;
- Strangler Fig;
- Service Mesh;
- Sidecar;
- Service Discovery dinámico.

Si una necesidad futura los justificara, requeriría una decisión arquitectónica nueva y evidencia proporcional a su costo.

## Correspondencia con la arquitectura actual

| Componente | Patrones del catálogo |
| --- | --- |
| Clientes → Go | API Gateway |
| Go Match Service | Circuit Breaker, Bulkhead, Retry, Timeout, Fallback, Adapter, Observer/Command internos |
| Go → Envoy → Rust | Ambassador + load balancing como mecanismo |
| Rust Player/Profile | Repository, idempotencia como propiedad requerida para Retry |
| PostgreSQL | Database per Service en ownership lógico `match`/`player` |
| Prometheus/Grafana/health endpoints | Health Monitoring como capacidad operativa, no contado como patrón autónomo en E36 |

## Regla para E37

E37 no puede justificar un patrón únicamente porque su nombre aparezca aquí. Para seleccionarlo deberá registrar:

- problema concreto de Compunube;
- componente responsable;
- implementación prevista;
- evidencia observable;
- prueba reproducible;
- trade-off/costo introducido.

Se evaluarán explícitamente Load Balancing y Health Monitoring aunque no se cuenten por separado, y se compararán Retry/Circuit Breaker/Bulkhead con sus fallos objetivo.

## Estado de la duda docente

Con el material suministrado no hay necesidad de depender de una taxonomía externa para alcanzar el mínimo de cinco patrones: existen suficientes candidatos nombrados explícitamente. Por tanto, E36 adopta la decisión segura de **no contar como patrón autónomo ningún término ambiguo**.

Si el profesor exige en una revisión futura que “Health Monitoring” o “Load Balancing” cuenten como patrones independientes, se puede ampliar el catálogo sin invalidar esta selección; hasta entonces permanecen como mecanismos/capacidades.
