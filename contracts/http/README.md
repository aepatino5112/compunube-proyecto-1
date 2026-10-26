# E45 · Frontera HTTP pública v1

[`openapi.yaml`](openapi.yaml) es la especificación normativa de las operaciones request/response cliente ↔ Go. Todas las rutas están implementadas por Go (sesiones F48, salas F49, perfil/economía J77/F52) y su conformidad se comprueba en CI (ver «Verificación»).

## Documentación interactiva (Swagger UI)

Con el stack levantado y el cliente web arrancado con `COMPUNUBE_GO_URL=http://127.0.0.1:8080 npm start` (en `apps/web`), abrir **http://127.0.0.1:4173/api-docs/**. La página muestra este mismo `openapi.yaml` (copiado sin cambios por `npm run build`) y «Try it out» envía las peticiones a Go por el mismo origen: primero `POST /sessions` crea la cookie de sesión y después se pueden probar perfil, catálogo, economía y salas. No necesita Internet: Swagger UI va versionado en `apps/web/dist/api-docs/` desde `swagger-ui-dist` fijado. El WebSocket de `/realtime` solo se documenta (Swagger UI no abre WebSockets); sus mensajes están en [E43](../realtime/events.md).

| Transporte | Uso | Fuente |
| --- | --- | --- |
| HTTP cliente ↔ Go | Sesión, perfil, catálogo, mutaciones y crear/entrar sala | `openapi.yaml` |
| WebSocket cliente ↔ Go | `room.ready`, `room.leave`, `race.input`, `room.state`, `race.*` y errores realtime | [`../realtime/events.md`](../realtime/events.md) |
| gRPC Go ↔ Envoy ↔ Rust | Consultas, mutaciones y settlement internos | [`../../proto/README.md`](../../proto/README.md) |
| PostgreSQL Go/Rust | Persistencia de cada ownership; nunca acceso directo del cliente | [`../../database/README.md`](../../database/README.md) |

## Sesión y sala

`POST /v1/sessions` crea una identidad y credencial **opacas** en Go. El cliente no elige `playerId`. Para clientes no navegador, la credencial va en `Authorization: Bearer <token>`; para la web del mismo origen, Go también emite una cookie `compunube_session` `HttpOnly; Secure; SameSite=Strict; Path=/v1`. La cookie permite el handshake de WebSocket, cuya API del navegador no permite añadir `Authorization`. Go debe comprobar `Origin` en upgrades WebSocket y en mutaciones autenticadas por cookie. No se aceptan tokens en URL, parámetros de consulta, mensajes realtime ni logs. `GET /v1/sessions/current` permite recuperar la identidad si la credencial sigue siendo válida. La persistencia y expiración exactas pertenecen a F48.

La creación devuelve el `roomId`, mapa y membresía confirmados en `LOBBY`; la entrada admite solo una sala `LOBBY` con espacio y versión compatible. El estado completo, cambios de miembros, preparación, salida y carrera llegan por WebSocket E43. La API HTTP no recibe posición, resultados, premios ni saldos declarados por el cliente. El mapa válido del MVP es Maracaibo u Orinoco conforme a B17; el servidor valida `mapId` y conserva el mapa durante la vida de la sala.

## Idempotencia y errores

Cada mutación económica lleva `requestId` y `catalogVersion`; Go deriva `playerId` de la sesión y transmite la misma clave a Rust. Una repetición de la misma intención debe devolver el resultado guardado (`replayed: true`); reutilizar la clave con otra intención produce `409 IDEMPOTENCY_CONFLICT`. Compra y equipamiento son operaciones separadas. Un timeout después de enviar la operación puede dejar el resultado incierto: `504 MUTATION_OUTCOME_UNKNOWN` no incluye perfil ni saldo, y el cliente reintenta **la misma intención con el mismo `requestId`**. No se acredita nada en el cliente por el mero envío.

La envoltura `{code, message, requestId?}` contiene un código estable y un mensaje seguro. `requestId` aparece cuando hay una operación asociada; no se filtran tokens, SQL ni trazas. La tabla fija la traducción pública, además de los status descritos en OpenAPI:

| HTTP | Códigos | Sentido |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | JSON, ID, cantidad o campo estructural inválido |
| 401 | `SESSION_REQUIRED` | Sin sesión válida |
| 404 | `ROOM_NOT_FOUND` | Código de sala desconocido o ya no utilizable |
| 409 | `ROOM_FULL`, `INCOMPATIBLE_VERSION`, `INVALID_STATE`, `IDEMPOTENCY_CONFLICT` | Conflicto determinista de sala/versión/clave |
| 422 | `INVALID_ACTION`, `INVALID_ITEM`, `INSUFFICIENT_COINS`, `INSUFFICIENT_MATERIALS`, `NOT_OWNED`, `ALREADY_OWNED`, `INVALID_APPEARANCE`, `INVALID_CATALOG_VERSION` | Rechazo definitivo de reglas o catálogo |
| 503 | `PROFILE_UNAVAILABLE`, `SERVICE_UNAVAILABLE` | Dependencia de perfil o servicio no disponible; no se inventa respuesta |
| 504 | `MUTATION_OUTCOME_UNKNOWN` | Venció el plazo tras enviar una mutación; resultado pendiente de confirmar |

Los códigos de negocio corresponden a las categorías de `proto/player_profile.proto`; las respuestas gRPC no se exponen literalmente. `INCOMPATIBLE_VERSION` puede rechazar una entrada cuando Go no puede confirmar compatibilidad de la sala, sin convertir `rulesVersion`, `courseVersion` o `catalogVersion` en versión de red. Un `503 PROFILE_UNAVAILABLE` en una mutación puede llegar después de que Rust la aplicara: los clientes lo tratan como resultado no confirmado y reintentan con el mismo `requestId`.

## Verificación

- **Sintaxis y estructura:** CI Contracts valida el documento con el validador fijado (comando abajo).
- **Conformidad con Go real:** CI Integration ejecuta [`apps/web/integration/openapi-contract.test.js`](../../apps/web/integration/openapi-contract.test.js): llama a cada operación contra el stack Compose real, exige que cada estado HTTP esté documentado para esa operación y valida cada cuerpo JSON contra su esquema (incluido el handshake de `/realtime`). Los estados 503/504 de dependencias caídas se cubren en H69/I73.
- **Swagger UI:** `apps/web/e2e/api-docs.spec.mjs` abre la página en Chromium, comprueba las 12 operaciones y ejecuta «Try it out» de `POST /sessions` y `GET /sessions/current` contra Go.

Validación local, con versión exacta del validador usada por CI Contracts:

```sh
npx --yes --package @apidevtools/swagger-cli@4.0.4 swagger-cli validate contracts/http/openapi.yaml
```
