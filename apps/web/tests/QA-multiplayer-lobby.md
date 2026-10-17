# Sala con amigos · preparación del front · 15 de octubre de 2026

`mountMultiplayerLobby` monta un diálogo aislado; `multiplayer-lobby.css` mantiene los estilos bajo `#online-lobby`. La raíz integra su botón y hoja de estilos. El diálogo consume el cliente de partidas; no crea un servidor ni simula amigos conectados.

## Comportamiento implementado

- Sin adaptador: aviso «El modo con amigos estará disponible cuando conectemos el servicio de partidas», creación y unión desactivadas y acceso funcional a la carrera local.
- Con servicio: crear con el mapa/equipo/apariencia actuales o entrar con un código, más un apodo opcional de hasta 24 caracteres. El código conserva mayúsculas y signos; solo se recortan espacios exteriores y se exige una longitud de 1–64 caracteres.
- La sala muestra hasta cuatro plazas. Los nombres y estados de los participantes provienen de `room.members`; las plazas vacías son invitaciones, no jugadores ficticios. Una identidad de sesión distingue «TÚ» de nombres o personajes iguales.
- «Estoy listo» espera la confirmación de `member.ready`. Mientras tanto muestra «Confirmando…»; tras diez segundos sin respuesta permite reintentar. La cuenta atrás bloquea cambios de estado.
- La salida de una sala pide confirmación dentro del mismo diálogo. Cancelar una conexión llama a `leave`; al llegar `status: racing`, el diálogo se cierra sin abandonar la partida.
- Copiar usa el portapapeles del navegador; si no está disponible, selecciona el código y explica cómo copiarlo.
- Datos de la sala se asignan con `textContent` o `value`. Los errores del servicio se convierten en mensajes comprensibles, sin insertar HTML remoto.

## Comprobaciones técnicas

`node --check dist/multiplayer-lobby.js` comprueba sintaxis del módulo. Los flujos con servicio deben verificarse con el adaptador del backend o un doble de prueba; no se afirma una partida online real.

La revisión de código cubre nombres accesibles, etiquetas de campos, estado de conexión anunciado, botones de al menos 44 px, captura de Escape por el diálogo nativo y restauración del foco al control de origen. El diseño usa una columna a menos de 620 px, anchura limitada al viewport, campos flexibles y desplazamiento vertical del diálogo para ventanas cortas.

## Revisión visual y de integración

La raíz comprobó escritorio, 320×568 sin desbordamiento horizontal, nombre/foco del diálogo, cierre con Escape y retorno de foco, formularios desactivados con aviso y acceso real a la carrera local. Se completó Orinoco en el perfil separado de pruebas. Evidencia y límites: [QA-network-front.md](QA-network-front.md).

Queda pendiente una revisión de crear/unirse, miembros, listo y desconexión dentro del navegador cuando exista un proveedor real. Las pruebas de cliente con dobles de transporte no se presentan como una partida online.
