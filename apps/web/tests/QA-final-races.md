# Cierre de carrera local · 15 de octubre de 2026

## Alcance de esta auditoría

Se revisaron `dist/game.js`, `app.js`, reloj, supervivencia, generación de cursos, recogida y audio. No se encontraron instrucciones `AGENTS.md` aplicables. Esta auditoría no utilizó navegador ni modificó inventarios guardados.

`tests/local-race.test.js` ejecuta los cuerpos reales de `reset`, `start`, `pause`, `showHit`, `simulate` y `netReach` leídos de `game.js`. No mantiene otra copia de las reglas. Los cursos, Three.js MathUtils, supervivencia, contacto de red, impulso y reloj son los módulos reales. Solo la presentación DOM/WebGL/audio tiene sustitutos mínimos. Si cambian los límites de esos bloques, la extracción falla de forma explícita para revisar el arnés.

Esto verifica estado y reglas; no mide GPU, FPS sostenidos, claridad del HUD, calidad de las animaciones o controles táctiles reales. Las carreras sin obstáculos indicadas abajo son escenarios controlados de prueba, no recorridos visuales de los mapas completos.

## Hallazgos

- **P2, efecto tras la meta.** Los rivales que terminaban conservaban velocidad e impulso, aunque `simulate` ya no los desplazaba. Mientras continuaba el jugador, las condiciones de estela, espuma de contacto y gotas podían tratar al rival inmóvil como una tabla navegando. El cierre corta la emisión de nuevos efectos para un surfista con `finishTime`, permite disiparse a la estela previa y desactiva su impulso al llegar. La prueba de carrera comprueba el último punto para todos los que cruzan.
- **P3, texto de reinicio.** El diálogo de reiniciar usaba el botón «Salir de la carrera», aunque volvía a la salida. El cierre distingue «Reiniciar carrera» de «Salir de la carrera» y adapta el aviso de pérdida de materiales a cada acción.
- No se reprodujeron bloqueos de meta, cobro durante descalificación ni reinicio con recursos de la carrera anterior en los escenarios ejecutados.

## Regresiones ejecutadas

Comando: `node --test tests/local-race.test.js`.

Resultado: **3 pruebas aprobadas** (aproximadamente 1,2 segundos).

1. Meta de Maracaibo y Orinoco, con obstáculos retirados únicamente en el arnés. Alimentando el reloj con 15 y 60 fotogramas por segundo se obtiene el mismo tiempo y recogida. El jugador llega exactamente a 900 m; solo hay una llamada de liquidación, aunque el reloj siga recibiendo fotogramas hasta 75 s. La suma de residuos de los cuatro surfistas coincide con los objetos reclamados y no supera los 103 disponibles. Cada resultado conserva los totales de plástico y metal de su jugador.
2. Colisión real con una vida restante en ambos mapas. Se produce descalificación, cero vidas y ninguna liquidación. Reiniciar restablece tres vidas, salida, recursos, objetos visibles, efectos e inputs, sin crear nuevos pickups ni modificar su curso.
3. Pausa con 1,4 s de cuenta atrás pendiente: soltar entradas y reanudar conserva esos 1,4 s. Pausar/reanudar durante carrera retorna a `running`. Reintentar tras resultado obtiene otro identificador de carrera.

## Escenarios exploratorios con los cursos completos

Antes de escribir la regresión se ejecutó también `simulate` con la misma sustitución de presentación, manteniendo obstáculos e IA reales, y entrada humana deliberadamente simple:

| Mapa | Entrada humana | Resultado observado |
| --- | --- | --- |
| Maracaibo | Sin girar, saltar ni impulsar | Descalificado a 474 m; no acredita materiales |
| Maracaibo | Mantener impulso, sin girar | Descalificado a 479 m; no acredita materiales |
| Orinoco | Sin girar, saltar ni impulsar | Meta en 57,45 s; 1 vida; 3 plásticos y 1 metal |
| Orinoco | Mantener impulso, sin girar | Descalificado a 660 m; no acredita materiales |

No se usaron esos resultados para modificar balance. Que una ruta sin intervención sobreviva en un mapa y no en el otro no prueba un fallo: trayectos, choques, salvavidas y competencia por materiales son distintos. Mantener impulso tampoco garantiza sobrevivir si se ignoran obstáculos. La validación jugable con personas sigue siendo necesaria para evaluar dificultad.

## Rendimiento y límites de cierre

El reloj limita cada paso a 1/60 s y pausa tras una interrupción mayor a 500 ms; al reanudar descarta tiempo pendiente. El comportamiento está cubierto por `frame-clock.test.js` y por esta carrera integrada. No se quitó la pausa para esconder fotogramas lentos.

Las sombras y ambas cámaras siguen teniendo un coste que esta prueba offline no puede certificar. No debe usarse la aprobación de estas tres regresiones como promesa de FPS mínimos en móvil ni como evidencia de una carrera visual completa. Tampoco valida multijugador: los tres rivales de estos casos son IA local.
