# Roadmap de ejecución del proyecto

> Snapshot de planificación basado en el tablero Trello **Compunube - Proyecto 1** al 17-10-2026.

Este documento define **el orden técnico recomendado de trabajo hasta la entrega final**, quién lidera cada bloque, qué puede ejecutarse en paralelo y qué dependencias bloquean cada tarea. **Trello sigue siendo la fuente operativa de estado Kanban**; este archivo sirve como mapa de dependencias y secuencia de ejecución dentro del repositorio.

No se usan Sprints. El flujo sigue **Fast Deployment + Kanban**: trabajo pequeño, ramas cortas, Pull Requests frecuentes, CI verde e integración continua.

## Cómo usar este roadmap

1. Antes de mover una tarjeta a `To Do` o `In Progress`, revisar su columna **Bloqueada por** en este documento y en Trello.
2. Una tarea no se considera desbloqueada porque exista un skeleton o una implementación parcial; deben cumplirse sus criterios de aceptación.
3. Si una dependencia cambia, se actualizan **Trello y este archivo en el mismo PR**.
4. Mantener poco WIP: cada persona debe priorizar terminar trabajo desbloqueante antes de abrir varios frentes.
5. Los responsables indican liderazgo, no exclusividad. Las tareas compartidas se coordinan por contratos y PRs, no editando todos lo mismo a la vez.

## Estado de partida

- **A02, A04 y A06** están en Done.
- **A07** queda cerrada con evidencia reproducible de CI/Compose y validación del entorno de desarrollo. **A05 es una auditoría independiente del laboratorio físico** y no bloquea el desarrollo normal.
- **B09 y B10** están en To Do, pero ambas dependen de **B08**. La prioridad inmediata de Ralph y Santiago es cerrar B08 antes de tomar esas decisiones como definitivas.
- **A05 no debe aparecer como dependencia de tareas de desarrollo o integración lógica**. Solo bloquea trabajo que necesita la infraestructura física real, como D31, H66 y el ensayo final.
- El repositorio ya contiene una base de Docker/Compose/CI/monitoring. Por eso tareas como **H62-H65** pueden estar parcialmente adelantadas, pero deben auditarse contra sus criterios antes de moverlas a Done.

## Rutas críticas

### Producto → reglas → backend autoritativo

```text
B08
 ├─> B09 -> B10 ----------------------┐
 ├─> B12 -> B14 -> B15 --------------┤
 └─> B13 -> B14 -> B15 -> B16 -------┤
                                      v
                                     B17
                                      |
                        +-------------+-------------+
                        v                           v
                       D28                         E43
                        |                           |
                        +-------------> F46 <-------+
                                      |
                               F48 -> F49
                                      |
                              F50 -> F53
                                      |
                                     F54
```

Mientras **B16/B17** no estén congeladas, no conviene implementar la lógica definitiva de salas/carrera en Go.

### Requisitos → arquitectura → Go/Rust → vertical slice

```text
A01 -> C22
B18 + C21 + C22 -> C25
C22 + C25 + A01 -> D26 -> D27
D27 + C25 -> D29
D27 + B17 + C25 -> E43

D28 + D29 + E43 + F46 + F47
                |
                v
               J77
                |
A07 + E41 + E43 + J77
             |
             v
            E44
```

**E44** es el primer hito integrado que debe demostrar cliente → Go → Envoy/gRPC → Rust → PostgreSQL → respuesta.

### Failover y resiliencia

```text
E36 -> E37
E37 + D28 + D29 -> E38
E37 + D31 -> E40
D28 + D29 + E43 + F46 + F47 -> J77
J77 + E38 + E40 + F47 + F52 + F50 -> J78
J78 + G61 + H69 + I70 -> I73
```

### Entrega final

```text
I70 -> I71 -> I72
I70 + J78 + G61 + H69 -> I73
D32/D33/D34/D35 + E37/E45 + J77/J78 -> I74
C24 + I74 + H66 -> I75
H66 + I72 + I73 + I75 -> I76
```

**I76 es la salida final del proyecto:** ensayo real en laboratorio, corrección de fallos críticos y creación del tag/release entregable.

## Plan de ejecución por oleadas

### Oleada 0 — Desbloquear al equipo

Objetivo: cerrar las condiciones mínimas para que frontend y backend trabajen sin inventar supuestos.

**Ángel**
- A01 — consolidar requisitos y decisiones abiertas.
- A07 — validar el entorno reproducible de desarrollo/integración.
- A03 — formalizar reglas Kanban/Fast Deployment.
- A05 — auditar máquinas y red del laboratorio cuando exista acceso; **no bloquea el desarrollo**.

**Ricardo**
- apoyar A01/A05 donde afecte Rust/red;
- validar Rust dentro de A07.

**Ralph + Santiago**
- B08 — auditar el prototipo y baseline real.
- D30 puede cerrarse apenas A01 + B08 estén listos.

**Gate de salida:** A01, A07 y B08 cerradas; lenguaje/estrategia de clientes encaminada. A05 queda como pista paralela de laboratorio.

### Oleada 1 — Congelar producto, gameplay y requisitos

Ralph y Santiago llevan el camino crítico de producto:

```text
B08
 ├─> B09 -> B10
 ├─> B11
 ├─> B12
 └─> B13
       |
B12 + B13 -> B14 -> B15
B09 + B13 + B14 + B15 -> B16
B09 + B10 + B16 -> B17
B11..B17 -> B18
B17 + B18 -> C19 -> C20
B18 + C19 -> C21
```

En paralelo, Ángel cierra C22. Después:
- C23 = C21 + C22.
- C24 = C21 + C22.
- C25 = B18 + C21 + C22.

**Gate de salida:** B18, C21, C22 y C25 cerradas. A partir de ahí la arquitectura deja de depender de reglas ambiguas.

### Oleada 2 — Congelar arquitectura, contratos y datos

**Ángel + Ricardo**
- D26 → D27.
- D29 después de D27 + C25.
- E36 → E37.
- E41 → E42.
- D32/D34 según se desbloqueen.

**Ángel**
- D28 cuando D27 + B17 + C22 estén cerradas.
- D31 cuando A05 + D27 estén cerradas; es trabajo específico del laboratorio y puede diferirse.
- E38/E39/E40; E40 no depende de D31 porque los health checks se diseñan a nivel lógico/servicio.
- E43 cuando D27 + B17 + C25 estén cerradas.
- E45 después de D27 + E43.

**Ralph + Santiago**
- D35 después de B16 + B17.
- D30 si todavía no está cerrada.

**Gate de salida:** D27, D28, D29, E41 y E43 cerradas. D31 puede completarse después, antes del despliegue físico.

### Oleada 3 — Servicios base y primer vertical slice

- F46 — base real del Go Match Service.
- F47 — base real del Rust Player/Profile Service.
- J77 — interfaz interna Go ↔ Rust + adaptador gRPC.
- H62/H63 — validar/consolidar contenedores y Compose existentes.
- E44 — ejecutar el PoC completo.

El PoC debe probar como mínimo una operación real de perfil:

```text
cliente
  -> Go
  -> PlayerProfilePort
  -> gRPC
  -> Envoy
  -> Rust
  -> PostgreSQL
  -> Rust
  -> Go
  -> cliente
```

**Gate de salida:** E44 demostrable y repetible. No avanzar a multijugador completo sin tener esta cadena funcionando.

### Oleada 4 — Backend funcional + clientes en paralelo

**Ángel / Go**
- F48 — identidad/sesión.
- F50 — modelo concurrente.
- F49 — salas, cuando F48 + B17 + D35 estén listas.
- F51 — Bulkhead/backpressure.
- F53 — simulación autoritativa, después de F49 + F50 + B16 + E43.
- F55 — persistencia/recuperación PostgreSQL.

**Ricardo / Rust**
- F52 — perfil, catálogo, inventario, economía e idempotencia.
- preparar settlement junto con Ángel.

**Ralph + Santiago**
- G56 — UX online.
- G58 — segunda interfaz, tan pronto D30 + E43 + F46 lo permitan.
- G57 — integración del frontend cuando F48/F52 y contratos estén disponibles.
- G59 — snapshots/interpolación después de G57 + F53.

**Gate de salida:** carrera online autoritativa, perfil/economía online y clientes consumiendo estado real.

### Oleada 5 — Settlement, reconexión y failover

- F54 — resultado de carrera + settlement Go→Rust.
- G60 — estados visuales de error/desconexión.
- G61 — reentrada y recuperación.
- J78 — balanceo/failover entre réplicas Rust.
- H67 — logging/métricas de Go/Rust.
- H68 → H69 — Prometheus/Grafana.

**Gate de salida:** se puede matar una instancia Rust sin tumbar la partida; clientes pueden reconectar y la observabilidad muestra el fallo.

### Oleada 6 — CI/CD, pruebas y laboratorio

- verificar H64/H65 contra el CI ya existente;
- H66 — despliegue rápido al laboratorio;
- I70 — plan maestro de pruebas/evidencias;
- I71 — unitarias, integración y contratos;
- I72 — E2E, concurrencia y carga;
- I73 — resiliencia/failover/recuperación.

**Gate de salida:** todos los escenarios P0 pasan de forma repetible en infraestructura equivalente a la entrega.

### Oleada 7 — Documentación, demo y release

- I74 — documentación técnica final.
- I75 — manuales, cumplimiento, runbook y guion de demo.
- I76 — ensayo final en laboratorio + tag/release.

En esta oleada **no se agregan features nuevas** salvo correcciones críticas.

## Trabajo paralelo por persona

### Ángel Patiño

Ruta principal:

```text
A01 -> A07
  |
  +-> C22 -> C24/C25
            |
            +-> D26/D27 -> D28/D31
                         -> E36-E45
                         -> F46/F48-F51/F53/F55
                         -> J77/J78
                         -> H62-H69
                         -> I70-I76
```

Responsabilidad dominante: Go, networking, PostgreSQL, resiliencia, infraestructura, observabilidad y entrega.

### Ricardo Beltrán

Ruta principal:

```text
A07
 |
C25 -> D26/D27 -> D29
                  |
                 E43
                  |
                 F47 -> F52
                  |      |
                  +-> J77+-> J78
                         |
                        F54/I73
```

Responsabilidad dominante: Rust Player/Profile Service, dominio persistente, economía, idempotencia, settlement y apoyo al failover.

### Ralph Antar + Santiago Rivera

Ruta principal:

```text
B08
 ├-> B09 -> B10
 ├-> B12
 └-> B13
      |
     B14 -> B15 -> B16 -> B17 -> B18
                              |
                       C19 -> C20/C21
                              |
                             D35

D30 -> G56 -> G57 -> G59 -> G60 -> G61
  \-> G58
```

Responsabilidad dominante: nombre/identidad del juego, Game Design, assets, UI/UX, frontend, flujo de jugador y clientes.

La regla de frontera se mantiene:

> **Frontend decide cómo se presenta y se interactúa; backend decide qué estado es autoritativo.**

## Registro completo de tareas y bloqueantes

La siguiente tabla refleja las dependencias declaradas actualmente en Trello. Si existe discrepancia, primero se corrige Trello y luego este documento.


### A — Base del proyecto y entorno

Requisitos base, gestión, laboratorio, repositorio y entorno de desarrollo.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **A01** | Consolidar requisitos, restricciones y decisiones abiertas | P0 | Ángel Patiño | ⬜ Backlog | Ninguna |
| **A02** | Definir alcance, MVP y entregas rápidas | P0 | Ángel Patiño | ✅ Done | A01 |
| **A03** | Documentar Fast Deployment y flujo Kanban | P1 | Ángel Patiño | ⬜ Backlog | Ninguna |
| **A04** | Crear y mantener registro de riesgos | P0 | Ángel Patiño | ✅ Done | A01 |
| **A05** | Auditar computadoras y red del laboratorio | P0 | Ángel Patiño | ⬜ Backlog | A01 |
| **A06** | Crear repositorio y flujo Git | P1 | Ángel Patiño | ✅ Done | Ninguna |
| **A07** | Validar entorno de desarrollo del equipo | P0 | Ángel Patiño | ✅ Done | A06 |

### B — Game Design y definición del producto

Cerrar el juego antes de congelar contratos y lógica autoritativa.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **B08** | Auditar prototipo actual y baseline funcional | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | Ninguna |
| **B09** | Cerrar decisiones pendientes del multijugador | P0 | Ralph Antar y Santiago Rivera | 📌 To Do | B08 |
| **B10** | Definir flujo online completo del jugador | P0 | Ralph Antar y Santiago Rivera | 📌 To Do | B08, B09 |
| **B11** | Cerrar narrativa y contexto educativo final | P2 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B08 |
| **B12** | Validar audiencia y objetivos educativos | P1 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B08 |
| **B13** | Documentar core gameplay loop y autoridad online | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B08 |
| **B14** | Cerrar diseño de las 3R y mecánica de Reducir | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B12, B13 |
| **B15** | Definir el papel del agua como recurso y objetivo del juego | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B12, B13, B14 |
| **B16** | Congelar reglas autoritativas de carrera y ranking | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B09, B13, B14, B15 |
| **B17** | Definir modelo multijugador y ciclo de sala | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B09, B10, B16 |
| **B18** | Actualizar Game Design Document desde el prototipo real | P1 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B11, B12, B13, B14, B15, B16, B17 |

### C — Requisitos y modelo de dominio

Convertir el diseño en requisitos verificables y separar runtime de perfil persistente.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **C19** | Identificar actores, casos de uso y flujos online | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B17, B18 |
| **C20** | Crear diagrama UML de casos de uso | P1 | Ralph Antar y Santiago Rivera | ⬜ Backlog | C19 |
| **C21** | Especificar requisitos funcionales desde el prototipo y modo online | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B18, C19 |
| **C22** | Especificar requisitos no funcionales y resiliencia | P0 | Ángel Patiño | ⬜ Backlog | A01 |
| **C23** | Crear historias de usuario y criterios de aceptación prioritarios | P1 | Ralph Antar y Santiago Rivera | ⬜ Backlog | C21, C22 |
| **C24** | Crear matriz de trazabilidad de requisitos | P1 | Ángel Patiño | ⬜ Backlog | C21, C22 |
| **C25** | Crear modelo de dominio con separación runtime/perfil | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | B18, C21, C22 |

### D — Arquitectura y UML

Cerrar arquitectura, topología y modelos que guían la implementación.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **D26** | Evaluar arquitecturas vistas en clase | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | A01, C22, C25 |
| **D27** | Seleccionar y justificar arquitectura resiliente mediante ADR | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | D26, C25 |
| **D28** | Definir Go Match Service, red realtime y concurrencia | P0 | Ángel Patiño | ⬜ Backlog | D27, B17, C22 |
| **D29** | Definir Rust Player/Profile Service replicable | P0 | Ricardo Beltrán | ⬜ Backlog | D27, C25 |
| **D30** | Confirmar los dos lenguajes de interfaz y estrategia de clientes | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | A01, B08 |
| **D31** | Definir topología física, puertos y réplicas backend | P0 | Ángel Patiño | ⬜ Backlog | A05, D27 |
| **D32** | Crear diagrama UML de componentes | P1 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | D27, D28, D29, D30 |
| **D33** | Crear diagrama UML de despliegue | P1 | Ángel Patiño | ⬜ Backlog | D31, D32 |
| **D34** | Crear diagramas UML de secuencia críticos | P1 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | D27, E43 |
| **D35** | Crear diagramas de estados de sala, carrera y participante | P1 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B17, B16 |

### E — Cloud, resiliencia, datos y contratos

Patrones cloud-native, PostgreSQL, contratos y primera integración vertical.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **E36** | Confirmar patrones cloud-native aceptados por la asignatura | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | A01, D27 |
| **E37** | Seleccionar y justificar mínimo cinco patrones cloud-native | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | E36, D27 |
| **E38** | Diseñar resiliencia, failover y modo degradado | P0 | Ángel Patiño | ⬜ Backlog | E37, D28, D29 |
| **E39** | Diseñar aislamiento de recursos y Bulkhead | P1 | Ángel Patiño | ⬜ Backlog | E37, D28 |
| **E40** | Diseñar health checks por servicio e instancia | P0 | Ángel Patiño | ⬜ Backlog | E37, D28, D29 |
| **E41** | Diseñar esquema PostgreSQL y ownership de datos | P0 | Ángel Patiño | ⬜ Backlog | C25, D27 |
| **E42** | Definir migraciones, seeds y recuperación de PostgreSQL | P1 | Ángel Patiño | ⬜ Backlog | E41 |
| **E43** | Cerrar contratos de red: realtime público + gRPC interno | P0 | Ángel Patiño | ⬜ Backlog | D27, B17, C25 |
| **E44** | Realizar PoC frontend → Go → Rust → PostgreSQL | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | A07, E41, E43, J77 |
| **E45** | Definir API HTTP/Swagger y frontera con realtime/gRPC | P1 | Ángel Patiño | ⬜ Backlog | D27, E43 |

### F — Backend Go/Rust/PostgreSQL

Implementación de servicios, concurrencia, economía, carrera y settlement.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **F46** | Crear base del Go Match Service | P0 | Ángel Patiño | ⬜ Backlog | A07, D28, E43 |
| **F47** | Crear base del Rust Player/Profile Service | P0 | Ricardo Beltrán | ⬜ Backlog | A07, D29, E43 |
| **F48** | Implementar identidad de sesión y jugadores activos en Go | P0 | Ángel Patiño | ⬜ Backlog | F46, E41 |
| **F49** | Implementar salas y ciclo de vida de partidas en Go | P0 | Ángel Patiño | ⬜ Backlog | F46, F48, B17, D35 |
| **F50** | Implementar concurrencia del Match Service en Go | P0 | Ángel Patiño | ⬜ Backlog | F46, D28 |
| **F51** | Implementar control de carga, Bulkhead y backpressure en Go | P1 | Ángel Patiño | ⬜ Backlog | F50, E39 |
| **F52** | Implementar perfil, inventario y economía en Rust | P0 | Ricardo Beltrán | ⬜ Backlog | F47, E41, E42, E43 |
| **F53** | Implementar simulación autoritativa y reglas de carrera en Go | P0 | Ángel Patiño | ⬜ Backlog | F49, F50, B16, E43 |
| **F54** | Implementar resultados de carrera y settlement Go→Rust | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | F52, F53, F55 |
| **F55** | Implementar persistencia y estrategia de recuperación en PostgreSQL | P0 | Ángel Patiño | ⬜ Backlog | E41, E42 |

### G — Clientes y frontend online

Adaptación del prototipo visual y segunda interfaz al backend autoritativo.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **G56** | Adaptar UX actual al flujo online | P1 | Ralph Antar y Santiago Rivera | ⬜ Backlog | B08, B10, D30 |
| **G57** | Integrar frontend web actual con el backend online | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | G56, E43, E45, F48, F52 |
| **G58** | Implementar la segunda interfaz requerida | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | D30, E43, F46 |
| **G59** | Implementar snapshots, interpolación y estado remoto | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | G57, E43, F53 |
| **G60** | Implementar manejo visual de errores y desconexión | P1 | Ralph Antar y Santiago Rivera | ⬜ Backlog | G59, E38 |
| **G61** | Implementar reentrada y recuperación de estado en clientes | P0 | Ralph Antar y Santiago Rivera | ⬜ Backlog | G60, F48, F55 |

### H — DevOps, CI/CD y observabilidad

Contenedores, integración continua, despliegue y monitoreo.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **H62** | Contenerizar Go, Rust y PostgreSQL | P0 | Ángel Patiño | ⬜ Backlog | F46, F47, E41 |
| **H63** | Crear Docker Compose de desarrollo e integración | P0 | Ángel Patiño | ⬜ Backlog | H62 |
| **H64** | Crear pipeline de integración continua para Fast Deployment | P0 | Ángel Patiño | ⬜ Backlog | A06, A07 |
| **H65** | Automatizar calidad para habilitar Fast Deployment | P0 | Ángel Patiño | ⬜ Backlog | H64 |
| **H66** | Implementar despliegue rápido hacia el laboratorio | P0 | Ángel Patiño | ⬜ Backlog | A05, D33, H63, H65 |
| **H67** | Implementar logging y métricas de Go/Rust | P1 | Ángel Patiño | ⬜ Backlog | F46, F47, F52, F53 |
| **H68** | Configurar Prometheus y monitoreo de servicios/PostgreSQL | P1 | Ángel Patiño | ⬜ Backlog | E40, H63, H67 |
| **H69** | Crear dashboard Grafana y alertas básicas | P1 | Ángel Patiño | ⬜ Backlog | H68 |

### I — QA, documentación, demo y release

Pruebas finales, evidencias, documentación, despliegue y entrega.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **I70** | Crear plan maestro de pruebas y evidencias | P0 | Ángel Patiño | ⬜ Backlog | C24, D27, B18 |
| **I71** | Implementar pruebas unitarias, integración y contratos | P0 | Equipo por componente | ⬜ Backlog | F52, F53, F55, G57, G59, E43 |
| **I72** | Ejecutar pruebas E2E, concurrencia y carga | P0 | Ángel Patiño | ⬜ Backlog | I70, I71, F51, G59 |
| **I73** | Ejecutar pruebas de resiliencia, failover y recuperación | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | I70, E38, J78, G61, H69 |
| **I74** | Completar documentación técnica final | P1 | Ángel Patiño | ⬜ Backlog | D32, D33, D34, D35, E37, E45, J77, J78 |
| **I75** | Preparar despliegue, manuales, cumplimiento y demo | P0 | Ángel Patiño | ⬜ Backlog | C24, I74, H66 |
| **I76** | Ensayar en laboratorio y crear release final | P0 | Equipo completo | ⬜ Backlog | H66, I72, I73, I75 |

### J — Integración Go↔Rust y failover

Desacoplamiento, adaptador gRPC y continuidad ante caída de réplicas Rust.

| ID | Tarea | Prioridad | Responsable | Estado | Bloqueada por |
|---|---|---|---|---|---|
| **J77** | Diseñar e implementar interfaz Go↔Rust para Player/Profile Service | P0 | Ángel Patiño y Ricardo Beltrán | ⬜ Backlog | D28, D29, E43, F46, F47 |
| **J78** | Implementar load balancing y failover entre instancias Rust | P0 | Ángel Patiño | ⬜ Backlog | J77, E38, E40, F47, F52, F50 |

## Reglas de bloqueo y movimiento en Kanban

- **Backlog → To Do:** todas las dependencias críticas están cerradas o existe una razón explícita para adelantar trabajo no definitivo.
- **To Do → In Progress:** responsable disponible, alcance entendido y contrato necesario definido.
- **In Progress → Review:** implementación/documentación completa y autocheck local realizado.
- **Review → Testing:** PR revisado y CI obligatorio verde.
- **Testing → Done:** criterios de aceptación de Trello verificados con evidencia.
- Una tarea parcialmente adelantada por el bootstrap del repositorio **no pasa automáticamente a Done**; se valida primero su checklist real.
- Si aparece una nueva dependencia, se añade a Trello y a este documento para no crear trabajo oculto.

## Definition of Done del proyecto

El proyecto termina únicamente cuando **I76** esté cerrado. Eso implica, como mínimo:

- los clientes funcionan contra el backend real;
- Go mantiene la autoridad de salas/carreras y usa concurrencia de forma demostrable;
- Rust mantiene perfil/economía/settlement de forma replicable;
- PostgreSQL conserva el estado persistente requerido;
- gRPC Go↔Rust funciona mediante el mecanismo de balanceo acordado;
- la caída de una réplica Rust no detiene partidas activas;
- Docker/Compose y el despliegue de laboratorio son reproducibles;
- CI, pruebas E2E/carga/resiliencia y monitoreo están demostrados;
- UML/documentación coinciden con el código;
- existe manual, evidencia de cumplimiento, guion de demo y release/tag final.

## Mantenimiento

Este archivo debe revisarse cuando:

- una tarjeta cambie de dependencias;
- se cierre una decisión arquitectónica;
- se agregue/elimine una tarea P0;
- se cambie ownership;
- una implementación parcial convierta una tarea en completada;
- cambie el escenario de laboratorio o la entrega final.
