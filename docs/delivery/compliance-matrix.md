# I75 · Matriz de cumplimiento

Requisito de entrega → componente → tarjeta/PR → prueba → evidencia → estado real. El detalle por requisito funcional y no funcional está en la [matriz de trazabilidad I70](../testing/traceability-matrix.md). **Estado** usa: **Cumplido** (PR integrado + CI verde + evidencia), **Integrado, pendiente de evidencia**, **En PR**, **Bloqueado** (requiere laboratorio o decisión) o **No cubierto**.

| Requisito | Componente | Tarjeta / PR | Prueba | Evidencia | Estado (26-10-2026) |
| --- | --- | --- | --- | --- | --- |
| Juego multijugador con autoridad del servidor | Go Match Service (salas, RoomLoop, race) | F46–F53, D28; G58 #70 | `go test -race`; carrera real con 2 clientes Python | CI Go; CI Integration run 40265326508 | Cumplido |
| Dos lenguajes de interfaz | Web TypeScript (`apps/web/src/net`) + Python | G57 #71, G58 #70, G59 #72 | `npm run build` (dist/net verificado); `pytest` Ubuntu/Windows; integración; E2E web + Python en la misma sala | CI Web, CI Client Secondary, CI Integration | Cumplido |
| Cliente web conectado a Go real | `src/net/profile.ts`, `realtime.ts`, `server.mjs` | G57 #71; G56/G59 #72 (merge 23dbd86); G60/G61 #73 (merge 6e84e9a) | `integration/*.test.js`; Playwright (2 navegadores + Python) | `docs/evidence/web-online-g56-g61.md` | Cumplido (navegadores Chromium en el mismo host; remoto requiere HTTPS) |
| Microservicios Go ↔ Rust por gRPC/Protobuf | `proto/`, adaptador gRPC Go, servicio Rust | E43, F47, F52, J77 | CI Contracts, `TestGRPCAdapterMapsEveryRPC`, `grpc_economy.rs` | CI | Cumplido |
| Balanceo y failover con Envoy (2 réplicas) | Envoy STRICT_DNS + health gRPC | J78, H69 #67, I73 #78 | J78 (local), H69, I73 | `docs/evidence/j78-rust-failover.md`, `h69-grafana.md`, `i73-resilience.md` | Cumplido |
| Persistencia con ownership separado | PostgreSQL `match`/`player`, roles J84 | E41, E42, J84, I71 #76 | E42 smoke, J84, pruebas DB Go/Rust obligatorias | CI Integration, CI Go, CI Rust | Cumplido |
| Settlement durable e idempotente | Coordinador Go + Rust | F54, J83, I72 #77, I73 #78 | F54 (local), G58/I72/I73 (`player.settlements`, caídas de Rust/Go/PostgreSQL) | `docs/evidence/f54-settlement-e2e.md`, `i72-…`, `i73-…` | Cumplido |
| Resiliencia: Circuit Breaker, timeout, retry, degradado | Go `playerprofile`, settlement | E38, J77, H69, I73 #78 | pruebas Go; H69 (abre y cierra); I73 | CI | Cumplido |
| Concurrencia y carga | Go rooms/workpool; I72 | I72 #77 (merge b0b31b7) | 3 salas × 4 clientes simultáneos con medición | `docs/evidence/i72-e2e-concurrency.md` | Cumplido en runner de CI (laboratorio: Bloqueado) |
| Reconexión | Go reentrada; web G61; Python | F55; G61 #73; G58; I73 #78 | pruebas Go y Python; I73; integración web (reconexión y recarga) | CI | Cumplido |
| Observabilidad | Prometheus, Grafana, logs correlacionados | H67 #65, H68 #66, H69 #67 | H68, H69 | `docs/evidence/h6*.md` | Cumplido |
| Contenedores reproducibles | Dockerfiles, Compose | H62 #74 | CI Integration build/up | #74 | Cumplido (falta validación en Windows 10: Bloqueado) |
| CI/CD | GitHub Actions; despliegue H66 | H63–H65, H66 #79 (merge c8e7d2e) | CI Deploy (A → B → rollback) | `docs/deployment/h66-deploy-procedure.md` | CI y procedimiento: Cumplido; laboratorio: Bloqueado |
| Copia y restauración | `database/scripts`, `deploy.sh` | E42, H66 | E42 smoke en cada CI Integration | CI Integration | Cumplido (CI); laboratorio: Bloqueado |
| UML | casos de uso, estados, componentes, secuencias, despliegue | C20, D35, D32/D34 #75, D33 #81 | CI Docs (render reproducible) | `docs/uml` | Cumplido (D33 con la topología de un host; distribución física pendiente de A05) |
| Topología física y auditoría de equipos | laboratorio | A05 #80, D31 #81 | — | plantillas | Bloqueado (acceso físico) |
| Ensayo y release | todo el sistema | I76 | guion completo en laboratorio | — | Bloqueado |
| Repetir carrera en la misma sala (RF-035) | Go rooms | — | — | — | No cubierto (falta definir el disparador en E43/E45) |

La columna de estado se actualiza al integrar cada PR; Trello conserva el estado operativo de las tarjetas.
| Pruebas Rust de idempotencia y correlación (I71-R1/R2) | Rust Player/Profile | #86 (cf85c1a), #87 (40975e9) | `economy_mutations.rs`, `grpc_request_log.rs` con PostgreSQL obligatorio | CI Rust de `main` (0 ignoradas) | Cumplido |
| Runbook operativo Rust (I74-R1) | documentación | #88 (0cef380) | revisión de variables, puertos y comandos contra el repositorio | `docs/runbooks/rust-player-profile-service.md` | Cumplido |
| Documentación de la API HTTP (OpenAPI/Swagger) | `contracts/http/openapi.yaml`, Swagger UI en `/api-docs/` | E45 | CI Contracts (validador), `openapi-contract.test.js` (conformidad con Go real), `api-docs.spec.mjs` | CI Integration | En PR |
