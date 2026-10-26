# ADR 0004: Vuelta automática de RESULTS a LOBBY (RF-035)

- Status: Accepted
- Date: 2026-10-26

## Contexto

RF-035 y UC-17 piden que, tras el resultado, los miembros que permanecen en la sala vuelvan a LOBBY como `not_ready`, con el mismo mapa y una nueva confirmación de perfil y Reducir; si sale, Go quita la membresía y una sala vacía pasa a CLOSED. Go ya tenía la transición (`rooms.Manager.Repeat`), pero ni E43 ni E45 definen un mensaje para dispararla, y esos contratos están congelados. La sala se quedaba en `RESULTS` hasta que todos salían.

## Decisión

Go dispara la transición sin mensaje nuevo: cuando el settlement de la carrera queda **confirmado** (Go ya republica `race.ended` con `settlementState: confirmed`), la sala espera **10 s** en `RESULTS` y vuelve a `LOBBY`. El plazo se mide con el reloj de la sala desde el primer tick tras la confirmación y se configura con `ROOM_RESULTS_LOBBY_DELAY` (duración positiva, por defecto `10s`).

Al volver, la sala conserva mapa y código; los miembros conectados pasan a `not_ready` sin elección de Reducir; los que salieron o están desconectados se eliminan, igual que en LOBBY; una sala vacía pasa a CLOSED. Se publica `room.state` con `LOBBY`, que E43 ya define, así que los clientes no necesitan mensajes nuevos: vuelven a enviar `room.ready` con la revisión de perfil y la elección de Reducir. Mientras el settlement esté pendiente (por ejemplo, Rust caído) la sala sigue en `RESULTS`; quien no quiera esperar usa `room.leave`.

## Consecuencias

- RF-035/UC-17 se cumplen sin cambiar E43/E45; la carrera nunca arranca sola: hace falta que 2–4 miembros vuelvan a marcar Listo.
- El cliente web muestra «Otra ola con la sala» en la tarjeta de resultado (vuelve al lobby sin salir de la sala); el cliente Python muestra el lobby y Listo otra vez.
- Un jugador que recarga durante `RESULTS` y no se reconecta antes de la vuelta pierde la membresía, como en LOBBY.
- Alternativas descartadas: un mensaje `room.repeat` (cambia el contrato congelado, exige versión/ADR de contrato y cambios en todos los clientes) y no implementarlo (RF-035 quedaría sin cubrir).
