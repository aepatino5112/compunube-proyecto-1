# ADR 0002: Client language strategy

- Status: Accepted
- Date: 2026-10-17

## Context

El requisito docente consolidado en A01 pide **dos lenguajes de interfaz distintos**, elegidos entre Python, TypeScript y Java. La [línea base B08](../product/frontend-baseline.md) confirma que Surf Club ya tiene un cliente web jugable en `apps/web/`, construido con HTML/CSS, módulos **JavaScript** y Three.js, y que su ruta online aún no está conectada. `apps/client-secondary/` está reservado para la segunda interfaz.

Reescribir el prototipo visual ahora aumentaría el costo y el riesgo sin aportar una capacidad online. Los dos clientes deben respetar la [frontera de servicios](0001-service-boundaries.md): Go es la entrada pública y la autoridad de carrera; Rust conserva perfil, economía y settlement detrás de Go.

## Decision

### Clientes y responsabilidades

| Cliente | Lenguaje elegido | Responsabilidad |
|---|---|---|
| Web principal, `apps/web/` | **TypeScript** como lenguaje objetivo | Conservar Surf Club, Three.js y sus recursos; enviar intenciones y presentar estado confirmado por Go. |
| Segunda interfaz, `apps/client-secondary/` | **Python** | Ser un cliente real del mismo sistema y consumir la frontera pública de Go; su alcance de interfaz se implementará en G58. |

Ambos clientes consumirán el mismo modelo público de identidad, sala, entradas, snapshots, eventos, resultados y perfil. Usarán HTTP para operaciones apropiadas y el canal realtime público hacia **Go** para estado y eventos. La forma definitiva de los mensajes, URLs y transporte se acordará en E43; los DTOs existentes del frontend son propuestas, no un contrato aprobado. gRPC/Protobuf permanece como comunicación **interna Go↔Rust**. Ningún cliente accederá directamente a Rust o PostgreSQL ni calculará como autoridad posición, vidas, recogidas, clasificación, recompensas o saldo.

### Migration strategy

El JavaScript/Three.js actual sigue funcionando. Los **nuevos módulos de integración y realtime** del cliente principal se escribirán en TypeScript cuando se implementen; los módulos JavaScript existentes se migrarán gradualmente al modificarlos en tareas posteriores. D30 no convierte código ni añade una herramienta de compilación.

**Esta decisión no satisface todavía materialmente el requisito de TypeScript.** `apps/web/` continúa ejecutando JavaScript; la existencia de `contracts-proposed.ts` como archivo de tipos documentales no basta. El requisito se demostrará cuando el cliente web contenga código TypeScript de aplicación compilado y validado por su flujo de build/CI, además de la interfaz Python funcional. La integración y validación corresponden a las tareas de implementación, no a este ADR.

### Alternativa evaluada: Java

Java también es un lenguaje permitido. Para este proyecto exigiría más trabajo en una segunda interfaz sin reutilizar el cliente web existente, y no resuelve una necesidad arquitectónica adicional frente a Python. Por ese costo relativo se elige Python; la decisión no cuestiona la validez de Java en otros contextos.

## Consequences

### Positive

- Se conserva el prototipo Surf Club y el flujo artístico Three.js/GLB.
- TypeScript permite tipar progresivamente intenciones, eventos y DTOs en la frontera del cliente.
- Python permite construir la segunda interfaz con menor costo relativo para este proyecto.
- Los dos lenguajes podrán demostrarse con clientes reales que comparten una sola frontera pública y las mismas reglas autoritativas.

### Trade-offs

- La migración JavaScript→TypeScript y su compilación/validación siguen pendientes; el requisito aún no está cumplido.
- Habrá dos clientes que mantener y probar contra el mismo contrato público.
- E43 deberá definir compatibilidad y evolución del protocolo para ambos, sin confundirlo con el contrato interno Go↔Rust.

## Non-goals

Este ADR no implementa G58, no elige un framework gráfico Python, no migra todo el frontend, no define E43 ni endpoints/protocolo definitivos, y no cambia reglas de juego, `proto/`, Go, Rust o ownership de datos.

## Estado de implementación (26 de octubre de 2026)

Esta sección registra el cumplimiento sin cambiar la decisión:

- **TypeScript:** el cliente web contiene código de aplicación TypeScript en `apps/web/src/net` (HTTP E45, perfil/economía, WebSocket E43, traducción a la presentación y reentrada), compilado en modo estricto con la versión fijada en `package-lock.json`. CI Web compila y falla si la salida versionada `dist/net` no coincide; los tipos realtime se importan del contrato `contracts/realtime/v1.ts`. Three.js y el resto del juego siguen en JavaScript.
- **Python:** `apps/client-secondary` es un cliente funcional (G58) que juega carreras reales contra Go en CI Integration y comparte sala con el cliente web en el E2E de navegador.

