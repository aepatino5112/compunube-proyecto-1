# QA · pase 04 de comparación con la referencia

Fecha: 2026-10-13. Revisión sobre modelos y código del proyecto, en el navegador integrado de escritorio. El pase mejora la presentación; las comprobaciones de funcionamiento no certifican que se haya alcanzado el acabado de la ilustración.

## Modelos y pruebas

Blender regeneró Amara, las tres tablas, las siete redes y las cuatro rocas. Se conserva Amara anterior para comparar. El nuevo GLB pesa 1 297 304 bytes. Las pruebas del GLB verifican quince huesos, ocho clips, articulaciones combinadas, peinados y recursos independientes, además de pies apoyados y manos en ambos agarres. Las siete redes mantienen el anclaje y las empuñaduras al recoger.

`npm run check` pasó y `npm test` pasó 52 pruebas. Se añadieron pruebas de espuma de contacto y encuadre real. La espuma se mantiene en un lote sin reemplazar su buffer tras 80 actualizaciones, se congela con el tiempo, omite tablas detenidas/en el aire/descalificadas y se limpia al reiniciar. La cámara incluye Amara, tabla y red costera, proyectando sus vértices a ambos lados en aspectos 16:9, 2.1 y 390/772, posiciones laterales ±15 y salto hasta 1.1 m. También se prueba el retraso lateral máximo permitido por la cámara; las dos pruebas de encuadre/AO volvieron a pasar después de ese último ajuste.

La prueba de profundidad para GTAO mantiene agua, cielo y señales transparentes en el render de color, excluyéndolos de la oclusión. El efecto adicional se limita a la escena piloto. Su compilación y los shaders de agua/sombras/radiancia se comprobaron en WebGL real.

## Navegador

En escritorio se jugó Maracaibo con Amara, Coral y Red reutilizada. La cámara mantiene al personaje cerca durante el avance. La captura final registra la carrera activa a 262 m / 00:16, con tres vidas, un plástico y 20 % de impulso; se pausó a 268 m y se abandonó. Otra ejecución llegó a 306 m con dos vidas después de un golpe y mostró protección y acercamiento del pulpo. Se reinició desde la confirmación y se restauraron vidas, contadores y efectos. La consola consultada de la carrera final no mostró errores ni advertencias.

En un viewport efectivo de 390 × 844 se probó red izquierda y se pausó a 84 m / 00:05, con tres vidas y cero residuos. Se reanudó, cambió la red a la derecha y volvió a pausar a 231 m / 00:14. Tabla, personaje, bolsa, puente, vista trasera y controles táctiles quedaron dentro de pantalla. Se abandonó y se retiró el tamaño temporal. La consola consultada no mostró errores ni advertencias.

En la escena piloto se compararon Amara anterior/actual, frente/espalda, movimiento manual al 100 % con red izquierda y volumen activado/desactivado. La comparación muestra la ilustración identificada como referencia junto al render real. Una compilación inicial de radiancia registró avisos de precisión X4122 del compilador gráfico; no impidieron el render. Las consultas finales de las vistas del juego/paisaje no registraron errores.

En el estudio de paisaje se revisaron Orinoco a 450 m y Maracaibo a 900 m: paleta del delta y puente oculto en Orinoco; puente delante y vegetación posterior a meta en Maracaibo. La vista de movimiento se dejó en Amara, piel Oscuro, cabello Negro, Afro, espalda y gesto al 40 %.

El perfil de localhost conserva 0 monedas, 44 plásticos y 27 chatarras, y se restauró Nico. La pestaña habitual de 127.0.0.1 conserva 150 monedas, Nico, Coral, Costero, Red costera y su destino Orinoco. No se compró ni canjeó. Se cerraron las pestañas de prueba; quedaron juego y tres vistas de revisión.

## Paisaje y coste

`art/verification/check_environment.mjs` volvió a pasar con los nuevos GLB. Maracaibo: 25 lotes de entorno, 1 218 464 triángulos instanciados completos; 550 208 en salida, 759 432 a 450 m y 533 144 a 900 m. Orinoco: 26 lotes, 445 396 triángulos. La separación mínima comprobada del paisaje respecto al centro del canal es 24 m y 33.19 m respectivamente. Estos recuentos excluyen actores, agua, horizonte, suelo no instanciado, sombras y vista trasera; no son el coste total de una imagen.

Las sombras añaden dos dibujos de profundidad por imagen, reutilizados en la vista trasera. La radiancia se calcula al iniciar y se reutiliza al cambiar destino. GTAO permanece como ensayo del estudio. No se acredita FPS sostenido ni tiempo de GPU de la versión final. El tamaño vertical simulado no sustituye pruebas en un teléfono físico.

## Evidencias y límites

- `preview-maracaibo-encuadre-v4.jpg`: carrera activa con la versión final de modelos/luz/agua.
- `preview-movil-encuadre-v4.jpg`: red izquierda en vertical, pausada a 84 m.
- `preview-comparacion-referencia-v4.jpg`: escena real e ilustración acordada juntas.
- `preview-maracaibo-meta-v4.jpg`: vista estática del paisaje a 900 m.

No se completó una carrera hasta meta en este pase. El acabado de las otras tres familias de surfistas, materiales pintados, vegetación y composición de orillas sigue pendiente. [REFERENCE_ALIGNMENT.md](../art/REFERENCE_ALIGNMENT.md) recoge la comparación artística y la continuación propuesta.
