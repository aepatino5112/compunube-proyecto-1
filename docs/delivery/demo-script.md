# I75 · Guion de demostración

Duración orientativa: 20–25 minutos. Todo se ejecuta localmente; no depende de Internet si las imágenes y dependencias se prepararon antes (`docker compose build`, `npm ci`, `pip install -r requirements.txt`). No se muestran secretos: el `.env` no se abre en pantalla.

**Estado:** guion preparado y cubierto pieza a pieza por pruebas automatizadas (ver la última columna). **No se ha ensayado completo en el laboratorio** (I76).

| # | Paso | Qué se muestra | Comando / acción | Respaldo automatizado |
| --- | --- | --- | --- | --- |
| 0 | Preparación (antes de la sesión) | — | `scripts/deploy/deploy.sh`; abrir Grafana; dos navegadores en `http://127.0.0.1:4173` con `COMPUNUBE_GO_URL`; una terminal con el cliente Python | CI Deploy |
| 1 | Arquitectura | Clientes → Go (HTTP/WebSocket) → Envoy → rust-1/rust-2 → PostgreSQL con `match`/`player` separados | [D32](../uml/components.svg), [D33](../uml/deployment.svg), [D34](../uml/README.md#d34--secuencias-críticas) | CI Docs |
| 1b | API documentada | Swagger UI de E45: operaciones, esquemas, errores; «Try it out» de `POST /sessions` y `GET /profile` contra Go | `http://127.0.0.1:4173/api-docs/` | contrato E45 en CI Integration |
| 2 | Salud y observabilidad | Cinco targets UP, réplicas Rust, Envoy, PostgreSQL | Grafana → Compunube Operations | H68/H69 |
| 3 | Perfil online | Sesión emitida por Go; perfil y catálogo confirmados por Rust; separados del progreso local | Web → Mi progreso → Online | G57 |
| 4 | Economía idempotente | Canje/compra confirmados; rechazo por saldo; mismo `requestId` = replay | Web Taller/Tienda; `python -m compunube_client exchange plastic 1 --request-id demo-1` dos veces | G57, G58 |
| 5 | Sala | Crear sala en un navegador, entrar con el código en el otro, unir el cliente Python | Lobby «Con amigos»; ventana Python (`gui`, *Entrar con código*) o `play --join <código>` | E2E #72 (dos navegadores + Python) |
| 6 | Preparación | «¿Qué llevas para hidratarte?» (Reducir) y Listo confirmados por Go; revisión de perfil verificada | Lobby | G59 |
| 7 | Carrera con varios clientes | Cuenta atrás 3 s, snapshots a 10 Hz, recogidas con un único propietario, salto/impulso como intenciones | Jugar | G58, I72 |
| 8 | Fallo controlado | Matar rust-1: Envoy hace failover; matar rust-2: la carrera sigue, perfil degradado, Circuit Breaker abierto en Grafana | `docker compose kill player-profile-rust-1` y luego `-2` durante la carrera | H69, I73 |
| 9 | Resultado y settlement | `race.ended` con acreditación **pendiente** mientras Rust está caído | Tarjeta de resultado | I73 |
| 10 | Recuperación | Arrancar Rust: Circuit Breaker se cierra, settlement `confirmed` sin doble crédito, perfil actualizado | `docker compose start player-profile-rust-1 player-profile-rust-2`; Mi progreso | H69, I73 |
| 11 | Reentrada | Recargar una pestaña durante otra carrera (< 15 s): vuelve a la carrera vigente | F5 en un navegador | G61 |
| 12 | Cierre | Requisitos y evidencia | [Matriz de cumplimiento](compliance-matrix.md) | — |

## Riesgos de la demo

- Si los navegadores están en equipos distintos del servidor, se necesita HTTPS (cookie `Secure`); por defecto la demo usa navegadores en el mismo equipo que Go o el cliente Python desde otros equipos.
- Reiniciar Go durante la demo invalida las sesiones (limitación F48); no se incluye ese paso.
- La sala no vuelve a LOBBY tras el resultado (RF-035 sin disparador): para otra carrera se crea una sala nueva.
