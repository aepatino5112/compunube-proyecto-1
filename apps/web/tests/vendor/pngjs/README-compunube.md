# pngjs · fixture de lectura

`pngjs@7.0.0`, licencia MIT, copiado sin cambios desde las dependencias de ejecución disponibles en Codex. Se conserva `LICENSE` y el código original. Solo se utiliza para decodificar y comprobar PNG reales en pruebas de GLB; no forma parte de `dist/` ni del juego servido al navegador.

`tests/helpers/gltf-fixture.js` registra un cargador de texturas CPU para GLTFLoader en Node, conservando geometría, materiales, UV y píxeles reales del archivo. La compilación/dibujo de WebGL se verifica por separado en el navegador con el cargador original.
