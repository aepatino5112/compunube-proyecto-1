# Pase 05 · follaje pintado y piezas de orilla

La segunda ilustración sigue siendo la referencia de estilo. Este pase trabaja manglares, palmeras, palafitos y rocas sobre los recursos que ya se utilizan en Maracaibo. El acabado del personaje, del agua y de la composición general continúa abierto.

## Follaje

`textures/foliage-atlas-v1.png` contiene cuatro grupos de hojas con fondo transparente. Se generó con la herramienta integrada `image_gen` usando la ilustración como referencia de estilo; el [prompt final](textures/foliage-atlas-v1-prompt.md) queda junto al recurso. La copia para distribución está en `dist/assets/textures/foliage-atlas-v1.png`. Los GLB incorporan el PNG, por lo que la carrera no depende de la carpeta de imágenes generadas del usuario.

En Blender, superficies curvas con UV de uno de los cuatro cuadrantes envuelven copas reducidas y ramas 3D. Cada copa usa seis orientaciones, sin girar los planos automáticamente hacia la cámara. El volumen central sostiene la profundidad y las hojas pintadas definen el contorno. Los arbustos incorporan grupos similares; las palmeras reciben hojas más amplias. Los manglares altos aumentan de tamaño y las raíces se construyen con curvas de varios segmentos.

El follaje se reúne en un único lote por GLB, usando una textura y un material. El material exporta `alphaMode: MASK` con corte .45, conserva profundidad y evita ordenar hojas como transparencias. `alphaToCoverage` suaviza los bordes en el contexto con antialias, según la [documentación de Material de Three.js](https://threejs.org/docs/pages/Material.html). Se mantiene geometría y textura compartida entre emplazamientos; las copias de material pertenecen a cada binding.

El ensayo GTAO del estudio excluye estas superficies de su profundidad genérica, para que una hoja recortada no se convierta en un rectángulo sólido. Las sombras del juego sí usan su alfa. Las piezas de los bancos ilustrados proyectan sombra, excepto la propia arena; ambos mapas de sombras existentes se reutilizan en la vista trasera.

## Palafitos y rocas

Los palafitos añaden tablones en fachada y cubierta del porche, puerta, marcos y travesaños de ventana, barandales, seis escalones con soportes y un techo con nervios y remate de cumbrera. Las variaciones de color por pieza ayudan a leer la construcción. Son interpretaciones estilizadas de arquitectura de orilla; no modelos de edificios concretos.

Las cuatro rocas usan perfiles diferentes: basalto inclinado, arenisca amplia, una forma partida con una muesca profunda y una laja baja. Los anillos tienen desplazamientos distintos, coronas desiguales y variaciones de color. Conservan una malla/material por modelo y el volumen de colisión existente. Las pruebas comprueban su envolvente sobre los GLB reales.

## Integración y revisión

`build_shore_study.py` produce `shore-study.blend` y los bancos de aldea/manglar. La aldea pesa 3 757 596 bytes y el manglar 2 812 736 bytes, incluyendo textura. Los modelos anteriores se conservaron en `art/baselines/` como referencia del pase 04. La escena piloto ofrece «Orilla de cerca» para revisar el palafito, raíces y follaje con los mismos recursos de la carrera.

El paisaje de Maracaibo suma 27 lotes y 1 600 896 triángulos instanciados completos. La selección por tramo registra 719 170 en salida, 1 000 614 a 450 m y 682 986 a 900 m. Estos números excluyen actores, agua, horizonte y dibujos de sombra/vista trasera. El crecimiento de textura, geometría y sombras requiere comprobar calidad y rendimiento en equipos físicos; no se declara una cifra de FPS.

Node no proporciona el decodificador de imágenes del navegador. Las pruebas registran un cargador CPU para GLTFLoader que decodifica los PNG reales con `pngjs@7.0.0`, incluido bajo MIT en `tests/vendor/`. No sustituye ni modifica el cargador del juego. Permite comprobar píxeles, transparencia, UV, materiales y conservación de recursos, además de geometría. La compilación WebGL y el aspecto se revisaron aparte en el navegador.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_shore_study.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python art/build_rocks.py
```

Verificación y capturas: [QA-painted-scenery.md](../tests/QA-painted-scenery.md). La continuación prioriza materiales y construcción de los personajes y su ropa, además de revisar composición y color junto al paisaje. El atlas mejora el detalle de las copas; aún se puede ampliar la variedad de árboles y edificios.
