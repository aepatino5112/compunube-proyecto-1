# Revisión de supervivencia · v0.5

Comprobaciones realizadas en el navegador local:

- Inicio con tres corazones y pulpo a 48 m; los indicadores se mantienen en los bordes de la pantalla.
- Carrera sin esquivar: pérdida de vidas y descalificación cerca de los 470 m. El inventario anterior mantuvo sus monedas y materiales; no se acreditó la recolección de la carrera fallida.
- Reinicio: vidas, distancia de persecución y recolección restauradas.
- Pausa: tiempo y distancia del pulpo permanecieron en 00:34 y 4 m durante la interrupción.
- Recorrido hasta los 900 m: llegada con una vida restante, pulpo alejado tras contacto y un residuo acreditado como chatarra.
- Recuperación: después de un choque, paso con la tabla sobre el salvavidas a 322 m. El HUD pasó de dos a tres vidas y mostró «Salvavidas · +1 vida».
- Vista trasera revisada en escritorio (1280 px) y móvil. El pulpo, los tentáculos y la cercanía se ven en la misma escena que la carrera.
- Sin errores ni advertencias de JavaScript durante las partidas observadas.

`npm test` cubre además salud máxima, propiedad única de los salvavidas, protección frente a golpes simultáneos, retirada aun bajo protección, imposibilidad de revivir descalificados y capturas al cruzar rápidamente un objeto. Las pruebas de economía anteriores siguen pasando.

El GLB del pulpo se cargó con el GLTFLoader del proyecto y sus ocho pistas de animación modificaron las rotaciones de los tentáculos al avanzar AnimationMixer. Las pruebas de escritorio y móvil son de funcionalidad y presentación; no representan una medición de rendimiento en dispositivos físicos ni un balance final de dificultad.
