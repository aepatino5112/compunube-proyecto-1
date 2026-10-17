# D26 — Evaluación de estilos arquitectónicos para Compunube

## Fuente y método

La fuente docente es **UCAB, CEN-03 — Introducción a los Sistemas Distribuidos**, PDF facilitado para este proyecto, pp. 14–38. La p. 14 permite combinar modelos; la p. 17 enumera cuatro familias principales: **en capas**, **basada en objetos**, **centrada en recursos** y **basada en eventos**. Las pp. 18–21 explican capas; las pp. 22–27 sitúan llamadas remotas, SOA/ESB y microservicios dentro de la familia basada en objetos/orientada a servicios; las pp. 28–29 tratan recursos/URI/interfaz uniforme; las pp. 30–38 explican eventos, publicación-suscripción y espacio compartido. Esta evaluación usa esas cuatro familias, no una lista de tecnologías candidatas.

Se contrastan con el [modelo de dominio C25](domain-model.md), el [ADR 0001](../adr/0001-service-boundaries.md), el [GDD B18](../product/game-design-document-v1.md) y [C21](../requirements/functional-requirements.md)/[C22](../requirements/non-functional-requirements.md). El requisito docente pide Go, Rust, gRPC, PostgreSQL, concurrencia, replicación/balanceo de Rust y evidencia de fallos; los criterios de aceptación concretos están en esos documentos. «Principal» significa la estructura distribuida que explica responsabilidades, comunicación y fallos; un mecanismo complementario puede seguir siendo esencial dentro de ella.

## Comparación de las cuatro familias

| Criterio | En capas | Basada en objetos / servicios | Centrada en recursos | Basada en eventos |
| --- | --- | --- | --- | --- |
| Requisitos docentes y separación Go/Rust | Ordena interfaz, dominio y persistencia dentro de cada proceso; no especifica servicios separados. | **Alta**: Go Match y Rust Player/Profile son componentes autónomos con interfaz y contrato. | Describe recursos públicos, pero no la separación completa ni la ejecución autoritativa. | Difunde cambios, pero por sí sola no asigna autoridad ni ownership. |
| Aislamiento de fallos | No modela caída parcial de otro proceso. | **Alto** con Go y Rust desplegables/fallables por separado; Go mantiene carrera si Rust falla. | HTTP puede exponer errores, pero el estilo no decide el aislamiento de procesos. | Desacopla emisor y receptores de notificaciones; no resuelve por sí solo una dependencia request/response de perfil. |
| Realtime y concurrencia | Capas organizan validación, simulación y publicación dentro de Go. | Go conserva RoomLoop/tick y ofrece la frontera realtime sin transferir autoridad. | Una interfaz uniforme HTTP sirve a operaciones puntuales, no describe bien un flujo continuo bidireccional. | Eventos/snapshots distribuyen observaciones de la carrera; la simulación y las intenciones siguen siendo dirigidas a Go. |
| gRPC/Protobuf interno | Puede ordenar adaptador y dominio; no explica el enlace distribuido. | **Natural** como contrato de llamada Go→Envoy→Rust entre servicios. | Forzar gRPC a una interfaz de recursos no aporta al caso. | No sustituye consultas de perfil ni settlement con respuesta. |
| PostgreSQL y ownership | Repositorios encapsulan acceso dentro de cada servicio. | Go posee `match`; Rust posee `player`, como límites de servicio. | Puede proyectar recursos de perfil/sala sin decidir quién escribe cada dato. | Un espacio de datos compartido como coordinación principal complicaría el ownership fijado; no se requiere. |
| Balanceo de Rust | No prescribe réplicas. | **Claro**: Envoy puede distribuir llamadas entre réplicas Rust sin mover la carrera fuera de Go. | No determina topología de réplicas. | Pub/sub puede tener receptores, pero no reemplaza balanceo de las RPC existentes. |
| Despliegue de laboratorio y complejidad operativa | Simple internamente, insuficiente para evidenciar servicios independientes. | Dos servicios, Envoy y PostgreSQL ya previstos; complejidad acotada y demostrable. | HTTP aporta una frontera conocida, pero no define el sistema completo. | Pub/sub **interno** en Go basta para difusión; un broker externo agregaría operación sin necesidad del MVP. |
| Demostrabilidad | Permite explicar código, pero no prueba falla independiente de Rust. | Permite mostrar Go vivo con Rust caído, réplica Rust sustituta, gRPC y datos de ownership. | Permite probar consultas HTTP, no el ciclo entero de carrera. | Permite mostrar broadcast y recuperación por snapshot, pero no explica solo el flujo completo cliente→Go→Rust. |

## Variantes de la familia basada en objetos/servicios

El material presenta **SOA clásica con ESB** en p. 26 y **microservicios** en p. 27. Un ESB central gestionaría comunicaciones entre servicios; para dos servicios de negocio con un enlace gRPC/Protobuf ya delimitado añadiría una pieza, operación y posible cuello de botella sin resolver una necesidad del MVP. Envoy actúa como Ambassador/balanceador hacia Rust, **no** como ESB empresarial ni autoridad de datos.

La variante de **microservicios** sí corresponde al sistema: Go Match y Rust Player/Profile tienen capacidades de negocio distintas, contratos explícitos y fallos independientes; Rust puede replicarse mientras Go mantiene el estado de cada carrera. «Microservicios» aquí no significa dividir cada entidad en un servicio ni añadir descubrimiento, malla o mensajería externa. PostgreSQL puede ser una instancia común con ownership lógico separado. El costo real es coordinar contratos, versiones, deadlines, idempotencia y operación de varios procesos; C22 y ADR 0001 ya exigen esos controles.

## Decisión recomendada

Elegir **arquitectura orientada a servicios basada en microservicios** como estilo principal de la familia basada en objetos. Aplicar **capas internas** para separar frontera/adaptadores, dominio y persistencia en Go y Rust; aplicar **eventos** para snapshots, sucesos semánticos y difusión/publicación-suscripción interna de Go. Los recursos y HTTP son útiles donde una operación pública request/response lo pida, sin imponer REST sobre el canal realtime ni sobre gRPC interno. El material CEN-03 p. 14 permite esta combinación.

La publicación de eventos no exige broker externo: Go puede difundirlos a conexiones suscritas con su propio estado autoritativo. Los comandos de carrera siguen entrando directamente a Go y las operaciones de perfil/settlement siguen siendo RPC dirigidas. La decisión formal se registrará en D27; los detalles del runtime y del contrato público corresponden a D28 y E43.
