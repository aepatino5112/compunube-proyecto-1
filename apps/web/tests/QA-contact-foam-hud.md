# Espuma de contacto y lectura del HUD

Fecha: 2026-10-12. Pase local en Three.js; se reutilizan los modelos y clips existentes de Blender. No se modifica el balance de vidas, impulso, recogida ni economía.

## Cambios

- Un lote `InstancedMesh` dibuja espuma para los 54 obstáculos: 36 rocas y 18 boyas. Sustituye los aros individuales de las rocas e incorpora las boyas. Cada paisaje tiene otro lote para los bancos de arena.
- La espuma tiene borde suave, fragmentos y variación de fase. Comparte ondas y reloj visual con el agua; la superficie de poca profundidad ahora es transparente para conservar el contacto visible.
- Los buffers se conservan al cambiar de mapa. Sus límites incluyen el desplazamiento del shader. Las superficies transparentes planas usan `forceSinglePass`; no hay geometría creada por fotograma.
- Corazones sin contenedor, texto oscuro, botones claros y fondos suaves en las esquinas. Los halos de plástico y chatarra conservan sus colores y formas distintas.
- `pause()` actualiza la interfaz inmediatamente. Antes, pausar justo antes del refresco de UI podía dejar el aviso «¡Impulso activo!» sobre una carrera congelada.

## Comprobaciones automáticas

`npm run check` y `npm test`: 36 pruebas pasan. La prueba nueva comprueba matrices finitas, capacidad, reutilización de buffers, conservación del recorrido, límites de desplazamiento y reloj congelado/movimiento reducido. La compilación real del shader se verificó en el navegador.

`node art/verification/check_environment.mjs`: ambos paisajes pasan, con 24 lotes de instancias cada uno. Holgura del canal: Maracaibo 26,94; Orinoco 33,19. Los triángulos registrados por ese verificador son 181984 y 417472, respectivamente; no son una medición de GPU ni de FPS.

## Carrera jugada y capturas

Prueba de escritorio a 1280 × 720, en una pestaña de QA en `localhost`, separada del perfil de la pestaña entregada en `127.0.0.1`.

Se cambió la red con Z/X, se condujo hasta un borde del canal y se mantuvo Shift en tramos de recogida. A 246 m había 3 plásticos, 3 chatarras y 12 % de carga; el pulpo estaba a 51 m. A 393 m la cuenta era 7 residuos y el pulpo estaba a 55 m. Los rivales comparten la basura, por lo que pasar por una posición no garantiza que el objeto siga disponible.

La partida terminó en tercera posición, a 900 m y 00:54, con 4 plásticos, 3 chatarras y una vida. El resultado confirmó que los materiales estaban guardados. Después de recargar y abandonar una segunda partida, el panel de materiales mostró 44 plásticos y 27 chatarras acumulados. No se midió el inventario inicial de esta sesión para atribuir todo ese saldo a la carrera; la recompensa del resultado fue 4 y 3. Se intentó un salto durante el recorrido, pero hubo otra pérdida de vida; este pase no acredita haber esquivado con éxito ese obstáculo.

- `preview-contacto-agua.png`: captura durante la carrera, a 615 m. Muestra espuma alrededor de una roca, estelas, residuos y HUD, sin el rótulo de pausa.
- `preview-contacto-resultado.png`: resultado de la carrera completa.
- `preview-espuma-hud.png` y `preview-espuma-impulso.png`: capturas pausadas de etapas anteriores del recorrido.
- `preview-contacto-movil.png`: Orinoco pausado, a 390 × 844 y 61 m. Tres corazones sin contenedor, materiales y controles táctiles visibles; `scrollWidth = clientWidth = 390`. El aviso actualizado muestra «Impulso en pausa». Se restauró el tamaño del navegador después de revisar.

Las capturas están en la raíz del proyecto. No hubo errores ni avisos en la consola en estas comprobaciones. La pestaña de la carrera completa cargó antes del ajuste de refresco de pausa; la revisión móvil cargó después y verificó el ajuste.

## Límites y continuación

No se midieron FPS sostenidos ni coste de GPU en dispositivos físicos. La reducción de aros individuales a lotes compartidos evita muchas llamadas de dibujo, pero no acredita por sí sola una mejora porcentual de rendimiento. El coste de transparencia debe seguir contrastándose en equipos modestos.

Quedan por revisar ritmo de recogida, dificultad de esquiva, expresividad de brazos y diferencias de iluminación entre mapas. La carrera completa confirma el flujo, no un equilibrio final ni el acabado final del arte.

Referencias técnicas: [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) y [Material](https://threejs.org/docs/pages/Material.html), documentación oficial de Three.js.
