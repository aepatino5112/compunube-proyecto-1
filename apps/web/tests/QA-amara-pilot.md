# Revisión · Amara y escena piloto

Primer traslado a 3D de la segunda ilustración elegida. No acredita que el acabado de la ilustración esté ya conseguido.

## Comprobado

- Blender 5.2.1 LTS exportó `surfer-amara.blend` / GLB (1 217 376 bytes) y `shore-study.blend` / GLB (859 480 bytes). Las fuentes conservan piezas y pesos editables. La orilla se agrupa en diez materiales.
- Amara usa el modelo nuevo en tienda, retrato, vista previa y carrera; seleccionar Luna y volver a Amara cambia correctamente entre familias de modelo. No se cambian precios ni estadísticas.
- La escena piloto permite comparar Amara anterior/actual con la misma cámara y movimiento al 35 %, mirar de frente/espalda y revisar la red a izquierda al 100 %. La animación avanzó de su posición inicial y se detuvo con el botón; no se midieron FPS.
- La carrera de prueba en Maracaibo avanzó **473 m / 00:30**, recogió un plástico y terminó descalificada. El perfil de pruebas conservó **44 plástico / 27 chatarra** y 0 monedas. Otra salida se pausó en 0 m / 00:00, con personaje y cámara en su posición inicial. No se completó una carrera ni se acreditaron recursos.
- En móvil **390 × 844**, la escena y controles tienen `clientWidth = scrollWidth = 375`. El encuadre estrecho prioriza al personaje y pierde gran parte de las orillas; esa composición todavía necesita un pase propio.
- Se retiró una opción de sombras obsoleta en Three.js y se usa PCFShadowMap. Las hojas de Blender usan material de doble cara; se eliminaron caras coplanares duplicadas que el exportador había advertido como inválidas.

## Pruebas

`npm run check` aprobado; **46 pruebas aprobadas**. Las pruebas cargan los GLB reales: pesos normalizados, juntas con pesos combinados, esqueletos y materiales independientes, ocho clips, cinco peinados y manos/pies en los dos lados durante distintas poses. La orilla tiene índices/vértices finitos y límites razonables. El agua piloto comparte altura/pendientes físicas y usa un programa de shader distinto del agua actual de los mapas.

## Evidencia

- `preview-amara-piloto-antes.jpg` y `preview-amara-piloto-despues.jpg`: comparación del personaje desde la misma cámara al 35 %.
- `preview-escena-piloto.jpg`: composición de la escena real de revisión.
- `preview-escena-piloto-movil.jpg`: encuadre móvil.
- `preview-amara-piloto-carrera.jpg`: salida pausada con el modelo integrado en una partida.

## Límites y entrega

El acabado de piel, rostro, cabello, manos, vegetación, sombra de contacto y espuma sigue abierto. La tabla y red son las del kit existente. Paisaje y agua piloto se prueban en `art-study.html`; aún no sustituyen los mapas. La cámara de estudio es más cercana que la de carrera. Las otras tres siluetas todavía conservan su construcción anterior.

No se midió rendimiento sostenido ni memoria GPU en un dispositivo físico. Se restauró Nico en el perfil de pruebas al cerrar las pestañas de QA; el perfil habitual mantiene sus 150 monedas, equipo y destino. La escena piloto no lee ni modifica inventarios.
