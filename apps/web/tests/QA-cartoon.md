# Revisión visual · caricatura 3D

Comprobado el 12 de octubre de 2026 en el navegador local:

- Blender 5.2.1 guarda `art/surfer.blend` y exporta `dist/assets/surfer.glb` sin texturas externas. El GLTFLoader del proyecto carga siete mallas/materiales, 14.552 triángulos y 401.592 bytes. Las ranuras Skin y OutfitColor están presentes.
- El menú y la carrera muestran cabeza grande, rostro, pelo, chaleco y piernas del modelo. La vista previa Brisa cambia el chaleco a azul sin comprar ni alterar el equipo del jugador.
- Probados escritorio (1280 px de ancho) y carrera móvil (390 × 844). La cabeza, los corazones, la vista trasera y los controles táctiles siguen visibles. Se restableció el tamaño del navegador al finalizar.
- En carrera se recogieron tres residuos; los controles Z/X cambiaron el lado de la red y ambos agarres acompañaron el mango. Se comprobaron pausa y regreso al menú sin acreditar los materiales de la prueba.
- Sin errores ni advertencias en la consola durante la revisión. Comprobaciones de sintaxis y las diez pruebas existentes de economía/supervivencia pasan.

La animación del cuerpo y el agarre siguen controlados por código. La postura de piernas es fija; el esqueleto y los clips de Blender siguen pendientes. Esta revisión no constituye una medición de rendimiento en otros dispositivos.
