# G56/G57/G59/G60/G61 · Cliente web contra Go real

Todas las pruebas se ejecutan en CI Integration contra el stack Compose real (PostgreSQL, migraciones, rust-1/rust-2, Envoy, Go), a través de `apps/web/server.mjs` (mismo origen, proxy `/v1`).

| Card / PR (merge) | Prueba | Ejecución | Resultado observado |
| --- | --- | --- | --- |
| G57 · #71 (`4f242a7`) | `integration/profile.test.js` con el adaptador TypeScript compilado | [40267035798](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40267035798) | PASS: cookie de sesión `HttpOnly; SameSite=Strict`; perfil y catálogo vía Go → Envoy → Rust; `INSUFFICIENT_COINS`/`INSUFFICIENT_MATERIALS` sin cambios; equipar y apariencia confirmados (Rust aplica el aspecto del personaje equipado); mismo `requestId` → `replayed: true` sin nueva revisión; otro cuerpo → `409 IDEMPOTENCY_CONFLICT`; mutación con cookie sin `Origin` o con origen ajeno → `401` |
| G59/G56 · #72 (`23dbd86`) | `integration/realtime.test.js` (dos páginas, cookies separadas) | [40273539990](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40273539990) | PASS: handshake WebSocket con `Origin` ajeno rechazado; revisión de perfil obsoleta → `INVALID_READY`; Listo con revisión verificada y Reducir; `race.start` con 103 residuos; inputs monotónicos procesados por Go; salida voluntaria → `left` sin crédito; `race.ended` y settlement confirmado notificado una vez; perfil acreditado una vez |
| G56/G59 · #72 | `e2e/two-browsers.spec.mjs` (Playwright 1.64.0): dos procesos Chromium independientes + cliente Python por su CLI en la misma sala | [40273539990](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40273539990) | PASS (2,6 min): crear sala por la UI, entrar con el código en el otro navegador, unir el cliente Python (3/4), elegir «¿Qué llevas para hidratarte?», Listo, carrera en ambos navegadores, tarjeta de resultado «CARRERA CON AMIGOS» con acreditación pendiente → confirmada; cliente Python 1.º, 43,9 s, 41 plástico + 18 chatarra, settlement `confirmed`. Capturas en el artefacto `web-e2e-results` |
| G60/G61 · #73 (`6e84e9a`) | `integration/realtime.test.js` ampliado | [40273545998](https://github.com/aepatino5112/compunube-proyecto-1/actions/runs/40273545998) | PASS: corte del WebSocket de un corredor → `reconnecting` → `racing`; Go conserva `lastProcessedInputSeq` y el cliente no reenvía una secuencia procesada; otra página «recargada» con la misma cookie reanudó la carrera en 15 ms con el manifiesto versionado y coincidió en la propiedad de recogidas |

Pruebas unitarias web: 149 en CI Web (`npm test`), más compilación TypeScript estricta y verificación de que `dist/net` y `dist/courses` coinciden con sus fuentes.

## Hallazgos durante la validación

- `pagehide` enviaba `room.leave`: una recarga convertía al jugador en `left`. Corregido en G61 (`detach`).
- Al reatar, Go envía el snapshot vigente, que puede repetir el último tick; `network-race` lo rechaza y el juego lo ignora (comportamiento correcto).
- Firefox headless en el runner no crea contexto WebGL; el E2E usa dos Chromium. No se ha probado Firefox con aceleración.
- Con renderizado por software, dos escenas Three.js compiten por CPU; el E2E usa ventana de 640×400 y `reducedMotion`.
