# Preparación del front para backend · 15 de octubre de 2026

Paquete **1.1.0**. Alcance: preparar el cliente para el backend del otro equipo, sin implementar un servidor. El proveedor entregado es `null`; no hay partidas online disponibles.

## Implementación y pruebas

Se integraron lobby, adaptador de sesión, intenciones de control, validación e interpolación de snapshots completos, IDs de participantes/objetos, efectos únicos y resultados confirmados. La ruta online no ejecuta física/IA/recogidas ni acredita el perfil local. El regreso al modo local restaura curso, radios y equipo de rivales.

`npm run check`: aprobado. `npm test`: **110 aprobadas, 0 fallidas**. Las **34 pruebas nuevas** se distribuyen así:

| Archivo | Casos | Cobertura |
|---|---:|---|
| `multiplayer-client.test.js` | 10 | Proveedor desactivado, sala, listo, cancelación, versiones/miembros, respuestas tardías, errores y limpieza. |
| `network-race.test.js` | 8 | Manifiesto, IDs, límites/campos finitos, propiedad completa, paquetes atrasados, interpolación y estados terminales. |
| `network-presentation.test.js` | 8 | Identidad local, propiedad confirmada, eventos únicos, temporizadores y resultados sin premio local ni predicción. |
| `network-game-bridge.test.js` | 8 | Funciones reales del juego: guardia online, salto/intenciones, pausa/foco, neutral, tráfico y restauración del curso local. |

Los dobles de transporte existen exclusivamente en pruebas. No constituyen un servicio ni demuestran conexión entre navegadores.

## Comprobación en navegador

Se abrió «Jugar con amigos». El diálogo recibió nombre accesible y foco en su título; Escape lo cerró y devolvió foco al botón de origen. Crear/unirse quedaron desactivados con el aviso de servicio pendiente. «Tengo un código» mostró su formulario sin enviar solicitudes.

Se revisó el diseño de dos columnas en escritorio. A **320 × 568 px**, el diálogo quedó entre Y=10 e Y=558, sin desbordamiento horizontal. Su desplazamiento permite alcanzar la acción de jugar local, que cerró el diálogo e inició una carrera con cuatro surfistas, tres vidas y los controles habituales.

Se salió de Maracaibo tras 136 m y un residuo recogido, sin completar ni acreditar esa carrera; la cartera habitual continuó en 150 monedas. No se gastaron recursos.

Se completó una carrera local real en **Orinoco**, en el perfil de pruebas separado `localhost:4173`: **900 m, 57 segundos, 4.º lugar, 1 plástico, 0 chatarras y 1 vida restante**. Se observaron resultado y guardado. La reserva quedó en 45 plásticos/39 chatarras y se comprobó tras recargar. El perfil habitual `127.0.0.1:4173` permaneció separado. Esto verifica el recorrido local; no certifica FPS para todos los dispositivos ni una carrera online.

No aparecieron errores/advertencias en las lecturas de consola consultadas. No se inyectaron entradas, recompensas ni cambios de almacenamiento mediante evaluación del navegador. Capturas nuevas: [sala de escritorio](../preview-sala-amigos-desktop.png), [sala móvil](../preview-sala-amigos-movil.png) y [resultado local Orinoco](../preview-network-regresion-orinoco.png).

## Límites y entrega

Crear/unirse con participantes, listo confirmado, sincronización, latencia y reentrada requieren el proveedor real. Siguen pendientes identidad/autenticación, almacén de perfil online, tienda/economía de servidor y acreditación única. El cliente no mezcla el saldo online con el offline. No hay reconexión automática; backend debe acordar un timeout de intenciones porque un neutral no garantiza entrega en una conexión rota.

[FRONT_ADAPTER.md](../docs/backend/FRONT_ADAPTER.md) especifica la interfaz actual, sus límites y diferencias con los DTO propuestos. [FRONTEND_NETWORK.md](../docs/FRONTEND_NETWORK.md) resume esta fase. El ZIP backend incorpora el contrato del adaptador y fixtures con hashes de los quince módulos relevantes.
