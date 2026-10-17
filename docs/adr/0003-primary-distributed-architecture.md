# ADR 0003: Arquitectura orientada a servicios basada en microservicios

- Status: Accepted
- Date: 2026-10-17

## Contexto

[ADR 0001](0001-service-boundaries.md) ya aceptó la frontera de responsabilidades entre Go Match Service y Rust Player/Profile Service. [C25](../architecture/domain-model.md) detalla sus dominios y [D26](../architecture/architecture-evaluation.md) compara las cuatro familias de CEN-03. Este ADR clasifica y justifica el **estilo distribuido principal**; no reabre el ownership ni la elección de lenguajes de clientes de [ADR 0002](0002-client-language-strategy.md).

El proyecto debe demostrar dos servicios de negocio, gRPC/Protobuf, PostgreSQL con ownership lógico, concurrencia autoritativa en Go y continuación de partidas cuando Rust falla. Se necesita una estructura que haga explícitos contratos, despliegue y fallos parciales sin agregar infraestructura innecesaria.

## Decisión

La arquitectura principal es **orientada a servicios mediante microservicios** de la familia basada en objetos del material CEN-03. El MVP tiene dos servicios de negocio autónomos:

| Elemento | Papel y autoridad |
| --- | --- |
| **Go Match Service** | Frontera pública; identidad/sesión operativa, conexiones, salas, carrera viva, simulación, snapshots/eventos, reconexión y resultado autoritativo. Coordina el settlement sin ceder ranking ni recogidas. |
| **Rust Player/Profile Service** | Perfil, inventario, catálogo, economía, canje, crafting, equipo/apariencia y settlement transaccional e idempotente. Se puede replicar/reemplazar sin guardar estado crítico exclusivo en una réplica. |
| **Web TypeScript objetivo / cliente Python** | Clientes de la frontera pública Go. Envían intención y muestran estado confirmado; no consultan Rust, gRPC interno ni PostgreSQL. |
| **Envoy** | Infraestructura Ambassador/balanceador y health/failover delante de réplicas Rust; no es servicio de dominio ni ESB. |
| **PostgreSQL** | Persistencia compartida físicamente con ownership lógico: contexto `match` de Go y `player` de Rust. E41 definirá la estructura física. |

Go accede a Rust mediante puerto de aplicación y adaptador **gRPC/Protobuf a través de Envoy**. Los contratos en `proto/` son borradores hasta E43. Las llamadas usan deadline; retry solo si es seguro o idempotente y sin duplicar una política agresiva entre Go y Envoy. La caída de Rust degrada consultas/acciones de perfil, economía y confirmación de settlement, pero no elimina ni congela salas o carreras activas en Go. Go conserva resultado confirmado y estado pendiente de settlement sin fingir saldo acreditado. Esto no promete recuperación de cada frame tras caída de Go.

Se usan **capas internas** en cada servicio para separar frontera/adaptadores, reglas y persistencia. La publicación de snapshots y eventos semánticos desde Go emplea el **estilo basado en eventos como complemento**: difusión o pub/sub interno hacia conexiones. No se exige broker externo. El estilo de **recursos** puede ordenar operaciones HTTP request/response donde corresponda; no se fuerza REST sobre el realtime ni sobre gRPC interno. D28 define runtime/realtime y E43 cerrará URLs, mensajes y compatibilidad.

## Alternativas evaluadas

| Alternativa como estilo principal | Motivo para no elegirla |
| --- | --- |
| Solo arquitectura en capas | Organiza código y protocolos internos, pero no representa procesos en máquinas distintas, réplicas ni fallo parcial Go↔Rust. |
| SOA clásica con ESB | Un bus empresarial central para dos servicios agrega operación y un punto de paso/cuello de botella sin necesidad demostrada. Envoy cumple el balanceo previsto sin convertirse en ESB. |
| Solo recursos/REST | Sirve a recursos y operaciones HTTP, pero no describe bien carrera bidireccional realtime ni la RPC interna Go→Rust. |
| Solo arquitectura basada en eventos | La difusión no reemplaza comandos dirigidos, dueño único del estado de sala, consultas de perfil ni settlement con respuesta. |
| Monolito único | Impediría demostrar la separación Go/Rust y la caída independiente de Rust requerida; contradice ADR 0001. |

## Consecuencias

- **A favor:** ownership verificable, contratos claros, aislamiento de fallo de Rust, réplicas Rust balanceadas y una demostración completa cliente→Go→Envoy→Rust→PostgreSQL.
- **Costos:** operación de varios procesos, versionado contractual, latencia de RPC, consistencia entre resultado y perfil confirmado, y necesidad de deadlines e idempotencia. Go debe exponer la degradación sin convertirla en pérdida de carrera; Rust debe poder reintentar settlement sin doble acreditación.
- **Límites:** no se introducen ESB, broker externo, Service Mesh ni nuevos servicios de negocio por esta decisión. La implementación y pruebas de los controles pertenecen a tareas posteriores.
