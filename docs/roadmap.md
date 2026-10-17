# Technical Roadmap

Este documento resume los hitos técnicos del proyecto. **Trello sigue siendo la fuente operativa del backlog, responsables, prioridades y estado Kanban.** Este roadmap no duplica las tarjetas: explica la secuencia técnica del sistema.

## Milestone 1 — Foundation

Estado: **Completado**

- monorepo y estructura base;
- Go Match Service skeleton;
- Rust Player/Profile Service skeleton;
- PostgreSQL;
- Envoy;
- Prometheus + Grafana;
- `compose.yml`;
- CI para Go, Rust, infraestructura y contratos;
- smoke test de integración;
- documentación de arquitectura y contribución;
- ruleset de protección de `main`.

## Milestone 2 — Vertical slice Go → Rust → PostgreSQL

Objetivo: probar el camino backend completo antes de construir multiplayer.

```text
Go Match Service
      |
      | PlayerProfilePort
      | gRPC + Protobuf
      v
    Envoy
   /     \
Rust #1  Rust #2
   \     /
  PostgreSQL
```

Entregables:

- generación de código Protobuf para Go y Rust;
- port/interfaz PlayerProfile en Go;
- adaptador gRPC en Go;
- implementación real de `GetProfile` en Rust;
- Repository pattern en Rust;
- persistencia de perfil en PostgreSQL;
- migración inicial de `player`;
- integration test real Go → Envoy → Rust → DB;
- prueba de failover apagando una réplica Rust.

## Milestone 3 — Multiplayer runtime

Objetivo: convertir Go en el runtime autoritativo de las partidas.

- identidad/sesión necesaria para la partida;
- rooms;
- ready state;
- ciclo de vida de una carrera;
- goroutines y channels;
- procesamiento de inputs;
- snapshots;
- reconexión;
- authoritative state;
- resultado autoritativo.

## Milestone 4 — Resilience

Objetivo: demostrar tolerancia a fallos y patrones cloud-native.

- timeout/deadlines;
- circuit breaker;
- retry limitado e idempotente;
- fallback/degraded mode;
- bulkhead/backpressure;
- health checks;
- failover Rust #1 → Rust #2;
- recuperación cuando vuelve una instancia.

## Milestone 5 — Client integration

Objetivo: integrar el juego existente con el backend autoritativo.

- frontend web;
- segunda interfaz requerida;
- realtime frontend ↔ Go;
- interpolación de snapshots;
- HUD/estado de conexión;
- perfil/economía conectados al backend;
- eliminación de autoridad de `localStorage` para el modo online.

## Milestone 6 — Complete game rules

- pickups únicos;
- vidas/protección;
- obstáculos;
- boost;
- salto;
- octopus policy;
- finish/DQ;
- settlement idempotente;
- Reduce / Reuse / Recycle completos;
- resultados y recompensas.

## Milestone 7 — Observability and delivery

- métricas de backend;
- métricas PostgreSQL;
- dashboards Grafana;
- logging estructurado;
- pruebas de resiliencia;
- CD hacia el laboratorio;
- health checks post-deploy;
- rollback;
- pruebas finales y evidencia de demostración.

## Regla de planificación

Los hitos describen dependencias técnicas, no Sprints. Las tareas concretas se gestionan en Trello mediante Fast Deployment + Kanban.
