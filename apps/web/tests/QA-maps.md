# Destinos Maracaibo / Orinoco · 12 de octubre de 2026

## Implementación

Orinoco está disponible desde Inicio junto a Maracaibo. El selector y la foto principal muestran el destino elegido; el botón Jugar y los títulos de carrera siguen esa elección. El destino se recuerda en una preferencia separada del perfil. Caroní y Encuentro continúan como próximos mapas.

El segundo paisaje usa agua verde dorada, árboles de copas amplias creados en Blender, manglares, palmeras y canoas. Maracaibo mantiene el puente, los palafitos y su distribución anterior. Las dos escenas se preparan una vez, comparten los modelos importados y solo una está visible. Los objetos de carrera se reutilizan al entrar; vidas y propietarios de basura/salvavidas se reinician, el inventario no.

## Verificación automática

- `npm run check`: sintaxis correcta, incluido `maps.js`.
- `npm test`: 25 pruebas aprobadas. La nueva prueba comprueba generación reproducible e independiente, objetos finitos, límites del recorrido, separación de obstáculos y recuperación del mapa inicial ante una preferencia inválida.
- `node art/verification/check_environment.mjs`: ambos paisajes cargan los GLB reales, con vértices y matrices finitos, límites de instancias y canal libre. Maracaibo: 23 lotes, 178.912 triángulos instanciados y 26,94 m de separación mínima de orilla. Orinoco: 23 lotes, 414.400 triángulos y 33,19 m. Son cifras de escenario, no del dibujo completo con personajes y cámara trasera, ni una medición de FPS en móvil físico.
- Blender 5.2.1 LTS exportó `delta-tree.glb` (43.056 bytes) y guardó `orinoco-kit.blend` editable. El aviso de caché de miniaturas no impidió estos resultados.

## Navegador

Se utilizó `localhost:4173` para probar, separado del perfil habitual en `127.0.0.1:4173`. No se añadieron monedas ni materiales de demostración. Se observaron partidas activas que cambiaron fuera de las acciones enviadas; por ello los recorridos no se consideran una comparación controlada de dificultad.

1. Selección Orinoco: miniatura real, nombre, región, botón y coordenada coherentes. Al abrir otra pestaña del mismo origen se conservó la selección y Red reutilizada equipada.
2. Carrera Orinoco: recogida inicial, giro, red izquierda/derecha, carga de impulso, daño, persecución y recuperación mediante salvavidas observados. Un intento terminó descalificado a 830 m con 5 residuos; la pantalla informó que no se guardaban y que el inventario anterior se conservaba.
3. Meta observada en Orinoco: 900 m, 55 s, cuarto puesto, 10 residuos (7 plástico / 3 chatarra), 2 vidas y pulpo a 20 m. La pantalla confirmó materiales guardados. No se atribuye ese recorrido completo a una secuencia exclusiva de automatización. La consola consultada no mostró errores ni advertencias.
4. El perfil original se recargó desde Inicio y restauró sus 150 monedas y equipo. Allí se pudo seleccionar Orinoco. No se controló su carrera ni se gastaron sus materiales.
5. Menú móvil 390×844: selector de dos destinos visible, botones utilizables y sin desbordamiento horizontal (`clientWidth === scrollWidth`, 375 px útiles con barra de desplazamiento). El tamaño temporal se restauró al terminar. La vista completa está en `preview-menu-orinoco-movil.png`.

## Evidencia y pendientes

- `preview-menu-orinoco.png`: selector y paisaje del nuevo destino.
- `preview-carrera-orinoco.png`: escenario durante la carrera.
- `preview-meta-orinoco.png`: meta y acreditación informada.

El equilibrio de dificultad, el rendimiento en móviles físicos y la variedad de los tramos siguen abiertos. El cauce actual mantiene un corredor recto, con una distribución propia de objetos; no implementa curvas de navegación ni una transición entre ríos. El pulpo es ficticio, no una afirmación sobre fauna local. El menú comparte la tienda y el taller; no añade otra economía por destino.
