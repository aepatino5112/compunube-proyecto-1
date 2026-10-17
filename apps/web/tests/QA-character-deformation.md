# Revisión de deformaciones · pase 09

Revisión iniciada el 13 y completada el 14 de octubre de 2026. Parte de la captura de Luna que seguía mostrando uniones poco coherentes después del ajuste de encuadre.

## Diagnóstico y corrección

La revisión anterior se concentró en la pernera y fue insuficiente. La inspección adicional encontró inflación del brazo por escala uniforme de IK, planos de cierre atravesando las extremidades, capas de paneles separadas y un borde superior del chaleco que invertía el orden de sus anillos. La cintura y los extremos de los miembros también tenían pesos distintos de las piezas vecinas.

El [pase 09](../art/CHARACTER_DEFORMATION.md) describe las correcciones y los recursos medidos. Se generaron de nuevo los cuatro GLB y sus fuentes Blender. Las exportaciones finales terminaron con código 0 y `COMPUNUBE_CARTOON_SURFER_READY`, sin advertencias de mallas inválidas. Blender no pudo guardar miniaturas en su caché externa; esto no impidió guardar las fuentes ni los GLB.

## Evidencia visual

- [Luna antes, salto al 45 % desde atrás](../preview-deformacion-luna-antes.jpg).
- Después, salto al 45 % desde atrás: [Luna](../preview-deformacion-luna-salto-despues.jpg), [Nico](../preview-deformacion-nico-salto-despues.jpg), [Amara](../preview-deformacion-amara-salto-despues.jpg), [Samuel](../preview-deformacion-samuel-salto-despues.jpg).
- Después, recogida al 40 % lateral: [Luna](../preview-deformacion-luna-recogida-despues.jpg), [Nico](../preview-deformacion-nico-recogida-despues.jpg), [Amara](../preview-deformacion-amara-recogida-despues.jpg), [Samuel](../preview-deformacion-samuel-recogida-despues.jpg).
- Después, cambio de lado al 75 % de frente: [Luna](../preview-deformacion-luna-cambio-despues.jpg), [Nico](../preview-deformacion-nico-cambio-despues.jpg), [Amara](../preview-deformacion-amara-cambio-despues.jpg), [Samuel](../preview-deformacion-samuel-cambio-despues.jpg).

Las capturas corresponden al navegador real y a apariencias iniciales con red costera. El estudio reconstruye poses; no es una grabación continua de una carrera. Durante el diagnóstico se usó además el tono Profundo de Luna para distinguir piezas de piel de los bordes marfil. Esta elección se hizo únicamente en el estudio.

El juego se recargó con los recursos finales sin errores de consola. Conservó en Inicio a Amara con Coral, Costero, red costera y 150 monedas. No se iniciaron carreras ni transacciones durante esta revisión. El visor quedó en la pose inicial comparada: Luna, salto al 45 %, espalda.

## Comprobaciones

`npm run check` pasó. La suite final terminó con **65 pruebas aprobadas y 0 fallidas**. Las tres nuevas pruebas cargan los GLB reales:

- Comparan el grosor de los vértices del brazo con su contorno original, al llegar a ambos lados del mango y durante salto, recogida e impulso.
- Comprueban que las fronteras de paneles de los shorts comparten vértices y que permanecen coincidentes en poses de ambos lados.
- Comprueban la orientación exterior de las paredes del chaleco en reposo, excluyendo tubos diminutos de costura. El diagnóstico sobre los recursos `v8-review` encontró 29 caras invertidas en Nico, 16 en Luna, 20 en Amara y 23 en Samuel dentro de la región evaluada; en los recursos actuales encontró cero.

Las comprobaciones existentes de palmas, dedos, pies, tablas, redes, pausa, encuadre y economía siguen pasando. No se cambiaron recorrido, cámara de carrera, precios, recetas o recompensas.

## Límites

La revisión cubre las poses y apariencias indicadas. No acredita ausencia de cualquier intersección durante todos los gestos o combinaciones cosméticas. Se comparten los clips y no hay simulación de tela o cabello ni movimiento independiente de dedos. La geometría añadida requiere medir rendimiento sostenido en equipos reales; tampoco se valida aquí multijugador.
