# A03 — Fast Deployment y flujo Kanban

**Estado documental:** definido  
**Responsable:** Ángel Patiño  
**Metodología:** Fast Deployment + Kanban  
**Tablero operativo:** Trello — `Compunube - Proyecto 1`

Este documento define cómo fluye el trabajo del equipo. Trello mantiene el estado operativo de las tarjetas; GitHub contiene código, contratos, documentación, Pull Requests y evidencia técnica.

El proyecto **no usa Scrum ni Sprints**. El objetivo es trabajar en lotes pequeños, limitar trabajo simultáneo, integrar con frecuencia y mantener `main` cerca de un estado desplegable.

## 1. Principios de Fast Deployment

1. **Cambios pequeños e integrables.** Una rama debe resolver una capacidad o ajuste concreto y evitar cambios no relacionados.
2. **Integración frecuente.** No se acumulan varias tareas terminadas para integrarlas juntas. Cuando una unidad de trabajo cumple sus criterios, pasa a PR.
3. **`main` estable.** Todo cambio entra mediante Pull Request y debe superar los checks definidos para el repositorio.
4. **Despliegue reproducible.** Código, configuración, contenedores y migraciones deben poder reproducirse sin pasos manuales ocultos.
5. **Feedback temprano.** Se priorizan vertical slices y pruebas de integración antes de construir bloques grandes de funcionalidad aislada.
6. **Sin Sprints.** La prioridad cambia mediante Kanban y dependencias reales; no por ciclos temporales de Scrum.
7. **Pull system.** Cada integrante toma trabajo cuando tiene capacidad, respetando prioridad y bloqueantes.

## 2. Flujo Kanban oficial

```text
Backlog
   ↓
To Do
   ↓
In Progress
   ↓
Review
   ↓
Testing
   ↓
Done
```

Si aparece un bloqueo externo y ya no queda trabajo útil que pueda avanzarse en la tarjeta, se documenta el bloqueante y se devuelve a `To Do` para liberar WIP. No se mantiene trabajo artificialmente en `In Progress`.

## 3. Límites WIP

Los límites son del equipo, no por área.

| Columna | Límite | Regla |
| --- | ---: | --- |
| Backlog | Sin límite | Puede contener trabajo futuro aún bloqueado. |
| To Do | 6 | Solo trabajo realmente elegible o preparado para iniciar. |
| In Progress | 4 | Máximo una tarjeta principal activa por integrante. |
| Review | 3 | Evita acumular PRs sin revisión. |
| Testing | 2 | Obliga a terminar validaciones antes de iniciar más trabajo. |
| Done | Sin límite | Historial de trabajo terminado. |

Una tarea compartida por dos personas cuenta como **una tarjeta** de WIP. Los integrantes pueden colaborar, pero no deben abrir varias tarjetas principales simultáneamente salvo incidente o bloqueo justificado.

### Qué hacer si se alcanza el límite

Antes de tomar otra tarjeta:

1. ayudar a terminar o revisar una tarjeta existente;
2. resolver un bloqueo;
3. ejecutar pruebas pendientes;
4. completar documentación/evidencia;
5. solo después tomar trabajo nuevo.

El límite puede revisarse si la evidencia demuestra que causa un cuello de botella, pero el cambio debe quedar documentado.

## 4. Política de entrada y salida por columna

### Backlog

**Entra cuando:**
- existe una necesidad, requisito, deuda o entregable identificable;
- tiene un objetivo entendible;
- puede tener dependencias todavía abiertas.

**Sale hacia To Do cuando:**
- prioridad y responsable están claros;
- dependencias críticas están cerradas, o el trabajo adelantable está explícitamente delimitado;
- criterios de aceptación son suficientes para saber cuándo termina;
- no excede el WIP de To Do.

### To Do

**Entra cuando:**
- la tarea es elegible para comenzar;
- el equipo entiende su alcance;
- no existe un bloqueo crítico oculto.

**Sale hacia In Progress cuando:**
- existe capacidad WIP;
- una persona asume responsabilidad activa;
- para cambios de repositorio se parte del `main` actualizado y se crea una rama corta;
- contratos/decisiones necesarios para esa tarea ya están definidos.

### In Progress

**Entra cuando:**
- se está trabajando realmente en la tarjeta.

**Durante la ejecución:**
- mantener el alcance limitado a la tarjeta;
- actualizar pruebas y documentación cuando corresponda;
- no introducir decisiones arquitectónicas nuevas sin ADR o tarea explícita;
- hacer commits comprensibles y frecuentes.

**Sale hacia Review cuando:**
- el trabajo previsto está completo;
- el responsable hizo autocheck local;
- no quedan errores conocidos que invaliden los criterios;
- existe Pull Request si el trabajo modifica el repositorio;
- la descripción/evidencia necesaria está adjunta o enlazada.

### Review

**Entra cuando:**
- el cambio está listo para revisión de otra persona;
- el PR describe objetivo y alcance.

**Sale hacia Testing cuando:**
- se atendieron observaciones relevantes;
- el PR cuenta con la aprobación requerida por el ruleset;
- los checks obligatorios están verdes;
- el contenido está listo para validar contra criterios de aceptación.

Una aprobación no sustituye las pruebas.

### Testing

**Entra cuando:**
- revisión técnica completada;
- CI requerido en verde;
- existe una forma concreta de verificar el criterio de aceptación.

**Sale hacia Done cuando:**
- criterios de aceptación verificados;
- evidencia disponible;
- cambio integrado en `main` cuando corresponde;
- Trello/checklist actualizado;
- no quedan acciones necesarias para considerar terminada la tarjeta.

### Done

Una tarjeta en Done representa trabajo terminado e integrado, no solamente “código escrito”.

Si después aparece un defecto o cambio de alcance, se crea una tarjeta nueva o se reabre únicamente si realmente invalida la entrega original.

## 5. Git y Pull Requests

### Ramas

Usar ramas cortas desde `main` actualizado:

- `feature/<descripcion>`
- `fix/<descripcion>`
- `docs/<descripcion>`
- `chore/<descripcion>`

No se usan ramas permanentes por persona ni una rama `develop`.

### Pull Requests

Todo cambio hacia `main` pasa por PR.

Un PR debe:

- resolver un objetivo concreto;
- evitar cambios no relacionados;
- incluir pruebas cuando apliquen;
- actualizar documentación/contratos si cambian;
- dejar CI verde;
- ser revisable sin depender de una gran cantidad de trabajo futuro.

El ruleset actual de `main` requiere una aprobación y los checks:

- `go`;
- `rust`;
- `validate`;
- `contracts`.

`CI Integration` se ejecuta cuando cambian rutas relevantes, pero no es un required check global mientras siga filtrado por paths.

## 6. Definition of Done técnica

Según el tipo de tarea, Done exige:

- código compila;
- format/lint pasa;
- pruebas aplicables pasan;
- contratos permanecen compatibles o su cambio está documentado;
- documentación afectada está actualizada;
- integración en `main` completada;
- CI requerido verde;
- criterios de aceptación de Trello verificados;
- evidencia de prueba o demo disponible;
- ningún secreto ni configuración local quedó hardcodeado.

Para tareas puramente documentales, deben cumplirse revisión, consistencia con el repositorio y merge a `main`; no se exige una prueba funcional inexistente.

## 7. Frecuencia de integración

La integración es **por capacidad terminada**, no por fecha de Sprint.

Política:

- abrir PR tan pronto la unidad de trabajo sea revisable;
- no esperar a acumular varias tarjetas terminadas;
- sincronizar con `main` antes de iniciar una nueva rama y antes del merge si GitHub lo exige;
- priorizar PRs pequeños para reducir conflictos;
- si existe trabajo terminado durante una jornada activa, intentar integrarlo ese mismo día después de revisión y CI;
- una rama no debe convertirse en almacenamiento de trabajo de varios días/tareas no relacionadas.

No se fija una cuota artificial de commits o PRs: la frecuencia está guiada por unidades de valor pequeñas.

## 8. Frecuencia de despliegue

### Estado actual

El proyecto ya dispone de CI y de un stack reproducible con `compose.yml`, pero el **CD hacia las máquinas del laboratorio todavía no está implementado**.

Por tanto:

- todo PR ejecuta/respeta las validaciones CI correspondientes;
- cambios que afecten el stack integrado deben validarse con Compose/smoke tests cuando aplique;
- `main` debe permanecer cercano a un estado desplegable;
- no se afirma que existe deployment automático al laboratorio hasta completar H66.

### Cuando H66 esté disponible

La política objetivo será:

```text
merge a main
    ↓
build/version
    ↓
deploy laboratorio
    ↓
health checks
   /        \
error      éxito
 ↓           ↓
rollback   continuar
```

Los despliegues se realizarán en incrementos pequeños y verificables, no como una gran entrega al final.

## 9. Prioridad y selección de trabajo

Orden general:

1. **P0** desbloqueante o de camino crítico;
2. P0 no bloqueante;
3. **P1** necesario para calidad/entrega;
4. **P2** refinamiento o trabajo menos crítico.

Entre dos tarjetas de igual prioridad se prefiere:

- la que desbloquea más trabajo;
- la que reduce un riesgo importante;
- la que termina una integración vertical ya iniciada.

No se inicia una tarea solo porque su responsable esté libre si las dependencias técnicas todavía no permiten cerrarla correctamente.

## 10. Manejo de bloqueantes

Todo bloqueante debe quedar escrito en Trello.

Ejemplos:

- decisión de Game Design pendiente;
- contrato E43 todavía no congelado;
- acceso a laboratorio A05;
- dependencia de otro servicio;
- fallo de CI;
- requisito docente no confirmado.

Mientras A05 siga pendiente, las tareas dependientes del laboratorio pueden preparar documentación/configuración genérica, pero **no deben marcar como verificados datos de hardware, IP, firewall, latencia o despliegue reales**.

## 11. Responsabilidades operativas

- **Ángel:** Go, networking, PostgreSQL, infraestructura, CI/CD y observabilidad.
- **Ricardo:** Rust Player/Profile Service, persistencia del contexto player, economía y settlement.
- **Ralph + Santiago:** Game Design, frontend, UI/UX, assets, identidad visual y clientes.
- **Equipo completo:** revisión cruzada, integración y evidencia final.

El ownership indica liderazgo. No impide colaboración.

## 12. Evidencia de A03

A03 se considera cumplida cuando:

- Fast Deployment está documentado;
- flujo `Backlog → To Do → In Progress → Review → Testing → Done` está definido;
- límites WIP están establecidos;
- políticas de entrada/salida por columna están definidas;
- integración frecuente y despliegue incremental están descritos;
- Git/PR/CI están alineados con el flujo;
- el documento está integrado en `main`.

## 13. Mantenimiento

Actualizar este documento si cambia:

- el flujo Kanban;
- un límite WIP;
- el ruleset de `main`;
- la estrategia de ramas/PR;
- required checks;
- la política de despliegue;
- la infraestructura de laboratorio;
- la Definition of Done.
