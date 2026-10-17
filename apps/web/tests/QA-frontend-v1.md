# Cierre Front v1 · 15 de octubre de 2026

Primera entrega **local** de Compunube, paquete 1.0.0. Dos mapas, cuatro personajes y el ciclo de carrera/materiales/club. El multijugador entre humanos pertenece a la integración backend. Este informe distingue comprobaciones automáticas, interacción real y límites de la sesión.

## Correcciones del cierre

- El casco de las tres tablas queda junto al agua: la raíz ahora compensa los 10 cm de altura local del casco, en vez de añadir 15 cm y dejar una separación de unos 25 cm. Los apoyos locales de pies y manos se conservan. La oscilación adicional se reduce a 1 cm; el salto y la amortiguación siguen siendo presentación independiente de la lógica de recogida.
- La salida de la estela y las salpicaduras acompañan la orientación de la tabla. La onda de aterrizaje y la estela quedan a 3,2 cm del agua analítica. La estela conserva la curva recorrida, se interrumpe en el aire y se disipa. Un rival que ya cruzó la meta deja de generar espuma y gotas.
- Carrera, estudio de movimiento, escena piloto y visor de paisaje usan la misma altura de tabla. Las vistas de equipo sobre pedestal conservan sus apoyos locales.
- El agua concentra sus vértices donde existen contactos. La diferencia máxima observada entre superficie triangulada y contacto analítico baja de 9,52 cm a 0,891 cm. La espuma litoral suma correctamente la altura base; detalle, límites y coste en [QA-shore-finalization.md](QA-shore-finalization.md).
- Se corrigen foco de tarjetas, desplazamiento del taller, recibos de canje, explicación de faltantes, estados de carga/error, nombres accesibles y confirmaciones distintas de reinicio/salida. Detalle en [QA-ui-finalization.md](QA-ui-finalization.md).

## Verificación automática

`npm run check`: aprobado, incluidos el nuevo módulo de agua, los visores y el servidor. `npm test`: **76 pruebas aprobadas, 0 fallidas**. Después de actualizar los casos de encuadre a la altura real de agua se repitieron las tres pruebas de cámara/revisión afectadas: todas aprobadas.

Las pruebas cargan los GLB reales y comprueban casco/agua, cubierta/apoyos de pies, agarres, deformaciones de ropa, cuatro personajes y encuadre de redes en escritorio y formato vertical. Cubren también economía, persistencia, reparto único de residuos/salvavidas, impulso, vidas, persecución, reloj fijo, pausas, efectos y geometría de ambos destinos.

[local-race.test.js](local-race.test.js) ejecuta las funciones reales de simulación sin iniciar WebGL. Comprueba meta y acreditación única en ambos mapas a 15/60 actualizaciones por segundo, eliminación sin crédito y limpieza al reiniciar. Los casos de meta retiran obstáculos para aislar reloj/liquidación; no equivalen a jugar visualmente los mapas. [QA-final-races.md](QA-final-races.md) detalla escenarios y límites.

## Interacción en navegador

Se usó `localhost:4173` como perfil de pruebas, separado del perfil habitual `127.0.0.1:4173`. No se inyectaron materiales, resultados, entradas ni cambios de almacenamiento por consola.

| Flujo | Resultado observado |
|---|---|
| Carga | Estado de preparación con inicio inactivo; al cargar modelos aparecen equipo, destino guardado y botón de jugar. Sin errores/advertencias capturados. |
| Taller | La selección conserva foco; las siete recetas y sus estados se presentan con los modelos existentes. |
| Canje | 15 plásticos → 60 monedas; reserva 69 → 54. «Todo mi plástico» oculta el recibo anterior. |
| Compra | Manglar por 60 monedas; saldo 60 → 0. Primero pasa a propiedad, después se equipa. El foco pasa a Equipar y luego a la tarjeta equipada. |
| Fabricación | Red marea consume 10 plásticos y 5 chatarras; reserva 54/44 → 44/39. Se equipa en una acción independiente. |
| Persistencia | Tras recargar siguen Amara, Manglar, Red marea y Orinoco, con las reservas anteriores. |
| Inicio/pausa | Orinoco carga sus cuatro surfistas, tres vidas, HUD compacto y pulpo trasero. Continuar devuelve a la cuenta atrás; una interrupción larga vuelve a pausar. |
| Reinicio/salida | Diálogos nombrados, avisos distintos y acciones correctas; reiniciar restablece salida, vidas, recogida y reloj. Salir devuelve al club sin acreditar materiales. |
| Móvil | 390 × 844: ayuda nombrada, completa dentro del diálogo. 320 × 568: canje sin desbordamiento horizontal; cantidades y acciones disponibles. Son tamaños simulados, no hardware móvil. |
| Paisaje | Visor estático con recursos actuales: puente delante en salida y meta de Maracaibo; reflejo frontal, tabla junto al agua y espuma litoral revisados. No es evidencia de una carrera completada. |
| Perfil habitual | Sólo lectura al entregar: mantiene 150 monedas, Amara, Coral, Costero y Red costera. |

Capturas nuevas: [Maracaibo](../preview-v1-maracaibo.png), [meta de composición](../preview-v1-maracaibo-meta.png), [Orinoco](../preview-v1-orinoco.png), [ayuda móvil](../preview-v1-ayuda-movil.png) e [inicio v1](../preview-v1-inicio.png). Los visores estáticos no modifican el progreso.

## Límite de rendimiento observado

En esta sesión el navegador automatizado volvió a interrumpir la carrera antes de completar la cuenta atrás. La página `frame-probe.html`, sin Three.js, audio ni modelos, comenzó en unos 56 fps y después mostró **130 fotogramas en 107,5 s, intervalo mediano 1.016,1 ms (1 fps), documento visible**. Eso confirma intervalos largos también sin el juego; no identifica su causa ni descarta costes adicionales de renderizado.

Se mantiene la pausa de seguridad ante intervalos superiores a 500 ms. No se alteró el reloj para ocultar el problema. Esta revisión **no certifica FPS sostenidos ni una carrera visual completa** en el navegador automatizado. La fluidez final requiere una sesión activa normal en el equipo de destino. Las carreras visuales completas de pases anteriores están documentadas en [QA-race-clock-audio.md](QA-race-clock-audio.md), y no se presentan como pruebas nuevas de este cierre.

## Entrega e integración

[FRONTEND_V1.md](../docs/FRONTEND_V1.md) resume lo entregado. README y PLAN distinguen el estado actual del historial artístico. El ZIP backend contiene README, contratos propuestos, extractor y fixtures regenerados del código actual; no contiene datos del perfil del navegador.

Caroní, Encuentro y una mecánica propia de reducir quedan como ampliaciones. No existen cuentas, salas, red autoritativa ni economía de servidor; los contratos TypeScript son documentación para acordar la integración.
