# QA · paisaje pintado, pase 05

Fecha: 2026-10-13. Recursos finales exportados con Blender 5.2.1 LTS e integrados en la carrera y vistas de revisión.

## Comprobaciones

`npm run check` y `npm test` pasaron; 54 pruebas. Las nuevas pruebas decodifican el PNG real, comprueban hojas/transparencia en sus cuatro regiones, carga del atlas incorporado en ambos GLB, alfa MASK, UV finitos dentro de cada cuadrante, un solo lote de hojas por banco y reutilización/restauración de materiales/textura. También comprueban que el ensayo de oclusión no trata las hojas como rectángulos sólidos. Los demás casos mantienen la verificación de rig, equipo, cámara, economía y supervivencia.

El verificador de paisaje confirmó separación de 24 m para Maracaibo y 33.19 m para Orinoco, sin alterar el recorrido. Maracaibo: 27 lotes y 1 600 896 triángulos instanciados completos; visibles por selección de tramo: 719 170 / 1 000 614 / 682 986 a 0 / 450 / 900 m. Orinoco: 26 lotes y 456 136 triángulos; mantiene su vegetación anterior y recibe las rocas comunes revisadas.

Blender guardó la fuente y completó las exportaciones. El aviso de caché de miniaturas no impidió estos resultados. El exportador advirtió sobre el sampler usado para color/alfa de la misma imagen; ambos usos comparten atlas y UV. La inspección de los materiales exportados y el render real comprobaron su funcionamiento.

## Navegador

Se revisó «Orilla de cerca»: hojas recortadas por fuera del volumen, raíces, ventanas, puerta, escalera, tablones, techo y sombras. En composición se comprobaron los mismos recursos junto a Amara, red, agua y puente.

En escritorio (1280 × 720), se jugó Maracaibo con Amara, Coral y Red reutilizada. La captura registra aproximadamente 69 m / 00:04; se pausó a 77 m / 00:05, tres vidas, un plástico y 20 % de impulso. Se vieron follaje, rocas, costa y vistas principal/trasera. Se abandonó la prueba y el perfil conservó 0 monedas, 44 plásticos y 27 chatarras; se restauró Nico.

En vertical (390 × 844), se jugó con la red izquierda y se pausó a 94 m / 00:06, tres vidas y cero residuos. El paisaje, puente, red y controles quedaron dentro de pantalla. Se abandonó y se retiró el tamaño temporal. Las consultas de consola de estas carreras y de la escena piloto no mostraron errores ni advertencias.

Se revisaron también Maracaibo a 900 m y el paisaje del Orinoco en la vista estática. La pestaña habitual conserva 150 monedas, Nico, Coral, Costero y Red costera; se dejó Maracaibo elegido para probar el paisaje nuevo. Se cerraron las pestañas de prueba y quedaron las vistas de revisión.

## Evidencia y límites

- `preview-orilla-pintada-v5.jpg`: detalle real de las piezas de Blender y follaje pintado.
- `preview-maracaibo-follaje-v5.jpg`: carrera activa con el paisaje final.
- `preview-movil-follaje-v5.jpg`: carrera vertical, red izquierda, pausada.
- `preview-maracaibo-meta-v5.jpg`: composición estática a 900 m.

No se completó una carrera hasta meta en este pase. Los recuentos de paisaje no incluyen todos los dibujos ni miden GPU. No se acredita rendimiento sostenido ni equivalencia con un teléfono físico. Personajes, ropa, agua y composición general siguen en revisión artística.
