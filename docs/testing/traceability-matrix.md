# I70 / C24 · Matriz de trazabilidad y plan de pruebas

Conecta cada requisito ([RF](../requirements/functional-requirements.md), [NFR](../requirements/non-functional-requirements.md)) con componente, prueba, comando, entorno, resultado **observado** y evidencia. Trello sigue siendo la fuente operativa de tarjetas; aquí solo se registra qué prueba demuestra qué y con qué resultado real.

**Estado:** actualizada el 26 de octubre de 2026. **Leyenda de resultado:**

- **PASS-CI**: ejecutada en GitHub Actions y aprobada (se cita el PR o la ejecución).
- **PASS-local**: ejecutada fuera de CI y documentada en `docs/evidence/`.
- **PEND**: preparada pero sin resultado todavía.
- **BLOQ**: requiere acceso físico al laboratorio.
- **NO CUBIERTO**: no hay implementación o prueba.

Una prueba omitida no cuenta como PASS: las pruebas de PostgreSQL de Rust (`PLAYER_TEST_REQUIRE_DB=1`) y de Go (`MATCHSTORE_TEST_REQUIRE_DB=1`, desde #76) fallan si falta la base de datos.

## Entornos y comandos

| Id | Entorno | Comando |
| --- | --- | --- |
| E-GO | CI Go: Go 1.24, PostgreSQL 17 migrado | `go test ./... && go test -race ./...` (`MATCHSTORE_TEST_*`) |
| E-RS | CI Rust: Rust 1.99, PostgreSQL 17 migrado | `cargo fmt --check && cargo clippy … && cargo test --locked` (`PLAYER_TEST_*`) |
| E-WEB | CI Web: Node 24, TypeScript fijado | `npm run build && npm run check && npm test` |
| E-PY | CI Client Secondary: Python 3.12, Ubuntu y Windows | `python -m pytest -q` |
| E-CT | CI Contracts | `swagger-cli validate contracts/http/openapi.yaml` + `protoc` |
| E-INT | CI Integration: `docker compose` en runner Ubuntu (PostgreSQL, migraciones, 2 Rust, Envoy, Go, Prometheus, Grafana) | pasos del workflow y `scripts/validation/*.py`, `npm run test:integration`, `npm run test:e2e` |
| E-DEP | CI Deploy: runner limpio | `scripts/deploy/deploy.sh` / `rollback.sh` |
| E-LAB | Equipos del laboratorio (Windows 10 + WSL2) | pendiente de A05 |

## Requisitos funcionales

| Req. | Componente | Prueba | Entorno | Resultado | Evidencia |
| --- | --- | --- | --- | --- | --- |
| RF-001 identidad/sesión | Go `sessionhttp`, `identity` | `TestSessionEndpointsAndIdentity`, `TestInvalidCredentialsAreSafe`, `TestCookieOriginAndUpgradeSeam`; G57/G58 integración | E-GO, E-INT | PASS-CI | #76, #71, #70 |
| RF-002 perfil y catálogo online separados | Go `profilehttp` → Rust; web `online-profile`, `src/net/profile.ts` | `integration/profile.test.js`; `tests/go-profile-adapter.test.js`; J83 | E-INT, E-WEB | PASS-CI | #71 (run 40267035798) |
| RF-003 `localStorage` nunca acredita online | web `online-profile.js` | `tests/online-profile.test.js`, `go-profile-adapter.test.js` | E-WEB | PASS-CI | #71 |
| RF-004 cosméticos válidos sin efecto en carrera | Rust economía; web | `economy_mutations.rs`; G57 integración (equipar, apariencia) | E-RS, E-INT | PASS-CI | #71 |
| RF-005 elección de Reducir por participación | Go rooms; lobby web; cliente Python | lobby G56 (Playwright), G58/I72 (`--reduce`), resultado con `reduceChoice` | E-INT | PEND (navegador) / PASS-CI (Python) | #72, #70 |
| RF-006 `ready` tras perfil verificado | Go rooms + verificador | `TestInvalidMapAndFailClosedPreparation`; `integration/realtime.test.js` (revisión obsoleta rechazada) | E-GO, E-INT | PASS-CI | #72 (run 40267496997, prueba Node) |
| RF-007 mapa fijo por sala | Go rooms | `TestLifecycleAndCapacity`, `TestVersionedCoursesAndWireShape` | E-GO | PASS-CI | main |
| RF-008 joins en LOBBY hasta 4 | Go rooms | `TestLifecycleAndCapacity`; I72 (salas de 4) | E-GO, E-INT | PASS-CI / PEND (I72) | #77 |
| RF-009 2–4 humanos, sin bots | Go race/rooms | `race.New` (2–4), `TestLifecycleAndCapacity` | E-GO | PASS-CI | main |
| RF-010 cuenta atrás 3 s cancelable | Go rooms | `TestCountdownCancellationAndStaleDisconnect` | E-GO | PASS-CI | main |
| RF-011 bloqueo de roster/versiones | Go rooms/race | `TestRaceInputGatewayAndReentrySequences` | E-GO | PASS-CI | main |
| RF-012 solo intenciones válidas | Go `inputmailbox`, race | `TestLatestInputAndJumpEdges`, `TestRealtimeInputReachesAuthoritativeRace`; web/Python secuencias | E-GO, E-WEB, E-PY | PASS-CI | main, #70 |
| RF-013–RF-018 simulación `surf-mvp-1` | Go race | `TestMovementBoostJumpAndValidation`, `TestEnergyCapAndExactBoostBurn`, `TestObstacleProtectionOctopusAndDisqualification` | E-GO | PASS-CI | main |
| RF-019 un único propietario por objeto | Go race | `TestDeterministicPickupOwnershipAndEnergy`, `TestCloserPickupCandidateWins`; G58/I72 (propiedad = contadores en snapshot) | E-GO, E-INT | PASS-CI | #70 (run 40265326508) |
| RF-020 red/tabla barridas | Go race | `TestDeterministicPickupOwnershipAndEnergy` | E-GO | PASS-CI | main |
| RF-021 `finished` al cruzar | Go race | `TestReentryFinishDeadlineRankingAndImmutableResult` | E-GO | PASS-CI | main |
| RF-022 métricas de agua (contribución/total) | web | sin prueba específica identificada en online | — | NO CUBIERTO | — |
| RF-023 objetos de DQ/left/DNF no acreditados | Go race | `TestNonFinishersNeverCreditCollectedMaterials`; G58/I72 | E-GO, E-INT | PASS-CI | main, #70 |
| RF-024 perder foco no pausa | web `game.js` | `tests/network-game-bridge.test.js` | E-WEB | PASS-CI | main |
| RF-025 reentrada 15 s | Go race/rooms; web; Python | `TestRaceInputGatewayAndReentrySequences`, `TestCreateAndRebind`; `integration/realtime.test.js` (G61); I73 | E-GO, E-INT | PASS-CI (Go) / PEND (G61, I73) | #73, #78 |
| RF-026 `left` inmediato | Go rooms | `TestAllRacingMembersLeaveClosesRoom`; G59 integración; I72 | E-GO, E-INT | PASS-CI | #72 (prueba Node) |
| RF-027 estados terminales distintos | Go race | `TestTerminalDisplayOrderHasNoRank` | E-GO | PASS-CI | main |
| RF-028 cierre global / DNF a 45 s | Go race | `TestReentryFinishDeadlineRankingAndImmutableResult` | E-GO | PASS-CI | main |
| RF-029 puesto solo para `finished` | Go race | `TestSimultaneousFinishRanksByPlayerID`, `TestFinishTimePrecedesPlayerID`; G58/I72 | E-GO, E-INT | PASS-CI | #70 |
| RF-030 resultado vs settlement pendiente | web G56; Python | resultado con acreditación pendiente/confirmada; G59 integración (`race.ended` confirmado notificado una vez) | E-WEB, E-INT | PASS-CI (Node) / PEND (navegador) | #72 |
| RF-031 crédito una sola vez | Go settlement + Rust | `TestSuccessReplayAndGlobalConfirmation`, `economy_settlement.rs`; F54; G58/I72/I73 (`player.settlements`) | E-GO, E-RS, E-INT | PASS-CI; F54 PASS-local | #70, `docs/evidence/f54-settlement-e2e.md` |
| RF-032 canje | Rust | `economy_mutations.rs`; G58 (replay del CLI con el mismo `requestId`) | E-RS, E-INT | PASS-CI | #70 |
| RF-033 fabricación | Rust | `economy_mutations.rs`; G57 (rechazo sin materiales) | E-RS, E-INT | PASS-CI | #71 |
| RF-034 compra y equipamiento separados | Rust; Go `profilehttp` | `economy_mutations.rs`, `TestStrictBodiesAndErrorMapping`; G57 (`IDEMPOTENCY_CONFLICT`, replay) | E-RS, E-GO, E-INT | PASS-CI | #71 |
| RF-035 repetir RESULTS → LOBBY | Go rooms | `rooms.Manager.Repeat` existe pero **ni E43 ni E45 definen el disparador** | — | NO CUBIERTO (decisión de contrato pendiente) | `docs/uml/README.md` |
| RF-036 compatibilidad de protocolo | Go realtime; clientes | `TestRealtimeHandshakeAndRoomState`; G58 (subprotocolo rechazado); web (`INCOMPATIBLE_VERSION`) | E-GO, E-INT, E-WEB | PASS-CI | #70, #72 |
| RF-037 `rulesVersion`/`courseVersion` | Go race; web | `TestVersionedCoursesAndWireShape`; `tests/go-realtime-adapter.test.js` con el manifiesto real de Go | E-GO, E-WEB | PASS-CI | #72 |
| RF-038 `catalogVersion` | Rust; web/Python | `economy_mutations.rs`; adaptador (`INVALID_CATALOG_VERSION`, cuerpo fijo por `requestId`) | E-RS, E-WEB | PASS-CI | #71 |
| RF-039 web y Python en la misma frontera | clientes | G58; G59 (dos clientes web); E2E navegadores + Python en la misma sala | E-INT | PASS-CI (G58, Node) / PEND (E2E) | #70, #72 |
| RF-040 sin verdad del cliente | Go | `TestStrictBodiesAndErrorMapping`, decodificación estricta E43; los clientes solo envían intenciones | E-GO | PASS-CI | main |

## Requisitos no funcionales

| Req. | Prueba | Entorno | Resultado | Evidencia |
| --- | --- | --- | --- | --- |
| NFR-CON-001 desconexión aislada | `TestCriticalOverflowClosesOnlyOneConnection`; I73 (corte de socket, la carrera sigue) | E-GO, E-INT | PASS-CI (Go) / PEND (I73) | #78 |
| NFR-CON-002 concurrencia acotada | `TestRoomsIndependentAndQueueBounded`, `TestSeparatePoolsAndShutdown`, `go test -race` | E-GO | PASS-CI | main |
| NFR-CAP-001 carga de referencia | I72: 3 salas × 4 clientes simultáneos con medición | E-INT | PEND (cifras al pasar #77) | #77 |
| NFR-CAP-002 backpressure | `TestRealtimeInputRateBeforeRoomCommandQueue`, `TestSixthRoomRejectedWhileExistingRoomsStayAvailable`, `TestConnectionAdmissionAndRelease` | E-GO | PASS-CI | main |
| NFR-NET-001 latencia realtime | I72 mide intervalo entre snapshots (contrato 100 ms) | E-INT | PEND | #77 |
| NFR-AVL-001 caída de Rust | H68, H69 (una y ambas réplicas, Circuit Breaker abre y cierra), I73 (carrera activa sin Rust); J78 | E-INT | PASS-CI (H68/H69); J78 PASS-local | #67, `docs/evidence/h69-grafana.md`, `j78-rust-failover.md` |
| NFR-AVL-002 disponibilidad observada | H68/H69 (Prometheus, alertas, Grafana) | E-INT | PASS-CI | #67 |
| NFR-RES-001..004 deadline, retry, circuito, degradado | `TestCircuitTransitionsAndProbe`, `TestReadRetrySameContextAndMutationNoRetry`, `TestAuthAndOpenCircuit`; H69; adaptador web 503 | E-GO, E-INT, E-WEB | PASS-CI | main, #67, #71 |
| NFR-REC-001/002 reconexión y reentrada | Go reentry tests; G61; I73 | E-GO, E-INT | PASS-CI (Go) / PEND | #73, #78 |
| NFR-REC-003 restauración durable | `TestNewCoordinatorRecoversPendingAfterRestart`, `TestPostgresConcurrentClaimAndRestart`; I73 (reinicio de Go con settlement pendiente) | E-GO, E-INT | PASS-CI (Go) / PEND (I73) | #76, #78 |
| NFR-DAT-001 ownership y transacción | J84 (denegación cruzada), E42 smoke, `db_schema.rs` | E-INT, E-RS | PASS-CI | CI Integration de main |
| NFR-DAT-002 settlement idempotente | `TestSuccessReplayAndGlobalConfirmation`, `economy_settlement.rs`, F54 | E-GO, E-RS | PASS-CI; F54 PASS-local | `docs/evidence/f54-settlement-e2e.md` |
| NFR-CMP-001 evolución de contratos | CI Contracts; tipos E43 importados por TypeScript (falla la compilación si cambian) | E-CT, E-WEB | PASS-CI | #71 |
| NFR-OBS-001/002 salud y métricas | `TestHealthReadinessTransitions`, `TestOperationalMetrics`, `grpc_observability.rs`, H67/H68/H69 | E-GO, E-RS, E-INT | PASS-CI | #65, #66, #67 |
| NFR-SEC-001 identidad y confianza | `TestAllRoutesBearerAndCookieMutations`, `TestCookieOriginAndUpgradeSeam`; G57 (`Origin` ajeno → 401); G59 (WebSocket con `Origin` ajeno rechazado) | E-GO, E-INT | PASS-CI | #71, #72 |
| NFR-SEC-002 configuración y secretos | `TestParseRejectsInvalidWithoutLeakingSecrets`; H62 (Grafana sin `admin` por defecto); H66 preflight | E-GO, E-INT, E-DEP | PASS-CI / PEND (H66) | #74, #79 |
| NFR-DEP-001 despliegue y rollback | CI Deploy (A → B con copia → rollback a A); laboratorio | E-DEP, E-LAB | PEND (CI) / BLOQ (laboratorio) | #79, `docs/deployment/h66-deploy-procedure.md` |

## Copia de seguridad y restauración

| Prueba | Entorno | Resultado | Evidencia |
| --- | --- | --- | --- |
| E42 `database/scripts/smoke.sh`: migraciones, constraints, permisos por rol, `backup.sh` → `restore.sh` en otra base y verificación de filas | E-INT (cada ejecución) | PASS-CI | paso «Verify E42 migrations and recovery» |
| H66 copia `pg_dump` previa a cada despliegue | E-DEP | PEND | #79 |
| Restauración en el laboratorio | E-LAB | BLOQ | A05/H66 |

## Huecos conocidos

1. **RF-035** sin disparador contractual para repetir carrera.
2. **RF-022** sin prueba online específica.
3. **Navegador Firefox**: en el runner de CI Firefox headless no crea contexto WebGL; el E2E de navegador usa dos procesos Chromium independientes más el cliente Python.
4. **Sesiones de Go en memoria (F48)**: un reinicio de Go invalida todas las sesiones; el jugador no recupera su perfil online anterior aunque los datos sigan en `player.*` (lo verifica I73).
5. **Pruebas físicas** (Windows 10, varios equipos, HTTPS para navegadores remotos): BLOQ hasta A05.
