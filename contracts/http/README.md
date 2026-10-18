# E45 · Frontera HTTP pública v1

[`openapi.yaml`](openapi.yaml) es la especificación normativa de las operaciones request/response cliente ↔ Go. Describe un contrato para implementar en F48/F49/J77; la existencia de una ruta aquí no afirma que el servidor actual ya la atienda.

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

Los códigos de negocio corresponden a las categorías de `proto/player_profile.proto`; las respuestas gRPC no se exponen literalmente. `INCOMPATIBLE_VERSION` puede rechazar una entrada cuando Go no puede confirmar compatibilidad de la sala, sin convertir `rulesVersion`, `courseVersion` o `catalogVersion` en versión de red. F48/F49/J77 implementarán estas rutas y la traducción de errores.

Validación local, con versión exacta del validador usada por CI Contracts:

```sh
npx --yes --package @apidevtools/swagger-cli@4.0.4 swagger-cli validate contracts/http/openapi.yaml
```
